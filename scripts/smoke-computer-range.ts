/**
 * Click-accuracy range: drive the computer-use runtime against a target that knows the truth.
 *
 *   scripts/build-target-range.sh                    # once → build/BimaxTargetRange.app
 *   tsx scripts/smoke-computer-range.ts              # live run (opens a window, moves the cursor)
 *   tsx scripts/smoke-computer-range.ts --selftest   # scorer only, no desktop
 *
 * What makes this different from the other live smokes: the fixture reports which element was
 * struck. Every pass/fail below is decided by the range's own hit log — never by the runtime's
 * confidence, never by pixels, never by "no error was returned". Those are the things being
 * measured, so they are not admissible as the measurement.
 *
 * Two coordinate spaces meet here and must never be mixed:
 *   - the MANIFEST speaks global screen points (top-left origin) — ground truth;
 *   - an OBSERVATION reports element frames in SCREENSHOT PIXELS of the target window, and
 *     `click {x,y}` reads coordinates in that same screenshot space.
 * The range publishes each surface's window rect precisely so this file can convert between them
 * with the runtime's own audited transform instead of eyeballing it.
 *
 * Phases:
 *   A  labeled           unique AX label → semantic click. The baseline case.
 *   B  unlabeled/coords  observe, convert the reported frame, click its centre. Scores whether the
 *                        geometry the runtime reports is where the element actually is.
 *   C  unlabeled/ordinal "the Nth button from the left" — the only handle an icon has when it has
 *                        no label at all. Ambiguous orderings are skipped, not guessed.
 *   E  sheet             a document-modal AXSheet, confirmed from the AX tree, then acted on.
 *   D  child window      a click that creates a new top-level window, then acting INSIDE it.
 *
 * E runs before D only because a modal sheet left open would block every later phase; each phase
 * also resets the range (SIGUSR1) so no phase inherits another's surfaces.
 *
 * Flags: --seed N (reproduce a failure exactly) --targets N --layout grid|row
 *        --keep (leave the range running for inspection)
 */
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BimaxComputerRuntime, DesktopCommand, DesktopResult } from '../src/computer/desktop.runtime';
import { globalToScreenshot, screenshotToGlobal } from '../src/computer/coordinates';
import {
  ClickScore, RangeEvent, RangeManifest, RangeRect, RangeTarget,
  ORDINAL_WORDS, newWindowIds, offsetStats, ordinalPhrase, parseEvents, scoreClick, targetAt, xOrdinals,
} from './lib/range';

const APP_PATH = path.resolve(__dirname, '..', 'build', 'BimaxTargetRange.app');
const APP_NAME = 'Bimax Target Range';

/** The runtime refuses input when the AX tree moved under the screenshot the click was planned
 *  from, and instructs the caller to observe again. That is a protocol requirement, not a targeting
 *  failure — the harness honours it, and counts how often it was needed. */
const STALE_FRAME = /observe again before input|accessibility state changed after the screenshot/i;

interface CaseRecord extends ClickScore {
  phase: string;
  how: string;
  runtimeOk: boolean;
  runtimeError?: string;
  /** Re-observations forced by a stale-frame refusal before this click was accepted. */
  retries: number;
  passed: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Self-test: the scorer, against fixtures, with no desktop involved.
// ---------------------------------------------------------------------------------------------

function selftest(): void {
  const failures: string[] = [];
  const check = (name: string, condition: boolean, detail?: unknown) => {
    if (!condition) failures.push(`${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  };

  const target = (id: string, x: number, y = 100): RangeTarget => ({
    id, kind: 'labeled', label: id, shape: 'square', surface: 'main',
    rect: { x, y, w: 40, h: 40 }, center: { x: x + 20, y: y + 20 },
  });
  const t1 = target('t1', 100);
  const hit = (id: string, x: number, y: number): RangeEvent =>
    ({ event: 'hit', id, kind: 'labeled', surface: 'main', label: id,
       point: { x, y }, rect: { x: 0, y: 0, w: 0, h: 0 }, offset: { dx: 0, dy: 0 }, t: 1 } as RangeEvent);

  // A torn trailing line is normal (the log is read while it is being written) and must not throw.
  const parsed = parseEvents('{"event":"ready","seed":"1","t":1}\n{"event":"hi');
  check('parseEvents keeps whole lines and drops torn ones', parsed.length === 1, parsed);

  check('exact id is a hit', scoreClick(t1, [hit('t1', 120, 120)], 0).outcome === 'hit');
  check('different id is wrong-target', scoreClick(t1, [hit('t2', 400, 120)], 0).outcome === 'wrong-target');
  check('background is a miss',
    scoreClick(t1, [{ event: 'miss', surface: 'main', point: { x: 5, y: 5 }, t: 1 } as RangeEvent], 0).outcome === 'background-miss');
  check('silence is no-event', scoreClick(t1, [], 0).outcome === 'no-event');

  // The sinceIndex guard: a hit that predates the click must never be harvested by it.
  check('events before the click are not counted', scoreClick(t1, [hit('t1', 120, 120)], 1).outcome === 'no-event');

  // Offset is measured from the INTENDED target's centre even when another target was struck —
  // that number is how far off the aim was, which is the diagnostic that matters.
  const wrong = scoreClick(t1, [hit('t2', 420, 120)], 0);
  check('wrong-target still reports offset', Math.round(wrong.offsetPx ?? 0) === 300, wrong);

  const stats = offsetStats([1, 2, 3, 4, 100]);
  check('offset stats', stats.p50 === 3 && stats.worst === 100 && stats.count === 5, stats);
  check('empty offset stats do not divide by zero', offsetStats([]).p50 === 0);

  check('new window ids are a set difference', JSON.stringify(newWindowIds([1, 2], [2, 1, 9])) === '[9]');
  check('no new window when ids are unchanged', newWindowIds([1, 2], [2, 1]).length === 0);

  // Ordinal phrasing: near-column-aligned targets must be flagged ambiguous (nobody can answer
  // "the second from the left" between two targets 10px apart) WITHOUT being renumbered away —
  // they still occupy their position, so everything to their right keeps its ordinal.
  const ordinals = xOrdinals([target('a', 10), target('b', 20), target('c', 300)]);
  check('ambiguous neighbours are flagged, not removed',
    ordinals.length === 3 && ordinals[0].ambiguous && ordinals[1].ambiguous && !ordinals[2].ambiguous,
    ordinals.map(o => [o.target.id, o.ambiguous]));
  check('an ambiguous target still occupies its ordinal',
    ordinals[2].target.id === 'c' && ordinals[2].ordinal === 2, ordinals[2].ordinal);
  check('clear x-ordering is numbered left to right',
    xOrdinals([target('a', 10), target('b', 200), target('c', 400)])
      .every((entry, index) => !entry.ambiguous && entry.ordinal === index));

  const manifest = { targets: [t1] } as RangeManifest;
  check('point inside a rect attributes to its target', targetAt(manifest, 110, 110)?.id === 't1');
  check('point outside every rect attributes to nothing', targetAt(manifest, 5, 5) === undefined);

  // The screenshot⇄global round trip is what lets an observed frame be compared against ground
  // truth at all. A silent scale error here would make every geometry verdict meaningless.
  const window: RangeRect = { x: 285, y: 81, w: 900, h: 672 };
  const image = { width: 1568, height: 1171 };
  const roundTrip = globalToScreenshot(
    screenshotToGlobal({ x: 400, y: 670 }, image, window)!, image, window,
  );
  check('screenshot→global→screenshot round-trips within a pixel',
    Math.abs((roundTrip?.x ?? 0) - 400) <= 1 && Math.abs((roundTrip?.y ?? 0) - 670) <= 1, roundTrip);
  check('the two spaces are genuinely different',
    Math.abs(screenshotToGlobal({ x: 400, y: 670 }, image, window)!.x - 400) > 50);

  if (failures.length) {
    console.error(`selftest FAILED (${failures.length}):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, selftest: 'range scorer', checks: 17 }, null, 2));
}

// ---------------------------------------------------------------------------------------------
// Live run
// ---------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Range {
  private process?: ChildProcess;
  readonly logPath: string;
  readonly manifestPath: string;

  constructor(directory: string, readonly seed: number, private readonly layout: string) {
    this.logPath = path.join(directory, 'range.log');
    this.manifestPath = path.join(directory, 'range.manifest.json');
  }

  async start(targets: number): Promise<void> {
    if (!fs.existsSync(APP_PATH)) {
      throw new Error(`${APP_PATH} is missing — run scripts/build-target-range.sh first`);
    }
    this.process = spawn(
      path.join(APP_PATH, 'Contents', 'MacOS', 'BimaxTargetRange'),
      ['--seed', String(this.seed), '--targets', String(targets), '--layout', this.layout,
       '--log', this.logPath, '--manifest', this.manifestPath],
      { stdio: 'ignore' },
    );
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(this.manifestPath) && this.events().some(e => e.event === 'ready')) return;
      await sleep(150);
    }
    throw new Error('range did not report ready within 15s');
  }

  events(): RangeEvent[] {
    try {
      return parseEvents(fs.readFileSync(this.logPath, 'utf8'));
    } catch {
      return [];
    }
  }

  /** Re-read ground truth. Rewritten whenever a surface opens or closes, so it must be re-read
   *  after any action that could change the surface set. */
  manifest(): RangeManifest {
    return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')) as RangeManifest;
  }

  /** Close every spawned surface, so the next phase starts from the opening layout. */
  async reset(): Promise<boolean> {
    if (!this.process?.pid) return false;
    const before = this.events().length;
    this.process.kill('SIGUSR1');
    for (let poll = 0; poll < 20; poll++) {
      if (this.events().slice(before).some(e => e.event === 'reset')) return true;
      await sleep(100);
    }
    return false;
  }

  stop(): void {
    this.process?.kill('SIGTERM');
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  if (process.platform !== 'darwin') throw new Error('the target range is macOS-only');

  const flag = (name: string, fallback: number) => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? Number(argv[index + 1]) : fallback;
  };
  // A random default seed by design: a fixed layout every run is a layout the runtime can be
  // accidentally tuned to. The seed is printed in the report so any failure is reproducible.
  const seed = flag('--seed', Math.floor(Math.random() * 1_000_000));
  const targetCount = flag('--targets', 14);
  const keep = argv.includes('--keep');
  // grid exercises general precision; row is the layout in which every ordinal is answerable.
  const layoutIndex = argv.indexOf('--layout');
  const layout = layoutIndex >= 0 && argv[layoutIndex + 1] === 'row' ? 'row' : 'grid';

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-range-'));
  const range = new Range(directory, seed, layout);
  const runtime = new BimaxComputerRuntime();
  const cases: CaseRecord[] = [];
  const phases: Record<string, { passed: number; total: number; notes: string[] }> = {};

  const phase = (name: string) => (phases[name] ||= { passed: 0, total: 0, notes: [] });
  const record = (entry: CaseRecord) => {
    cases.push(entry);
    const bucket = phase(entry.phase);
    bucket.total += 1;
    if (entry.passed) bucket.passed += 1;
  };
  const note = (name: string, text: string) => phase(name).notes.push(text);

  const observe = (): Promise<DesktopResult> => runtime.run({ action: 'observe', maxElements: 600 });

  /**
   * Close the range's spawned surfaces and let the AX tree settle before the next phase.
   *
   * Tearing down a window destroys AX elements, and the runtime's epoch gate correctly refuses
   * input planned against a tree that has since changed. Without the settle, the first click of the
   * next phase is refused for a reason belonging to the previous phase — which is how a clean
   * fixture manufactures its own false failures.
   */
  const resetRange = async (): Promise<void> => {
    await range.reset();
    await sleep(700);
    await observe();
    await sleep(300);
    await observe();
  };

  /**
   * Issue one click and score it against the range's hit log.
   *
   * A stale-frame refusal is retried after re-observing, up to `MAX_RETRIES`, because that is the
   * protocol the runtime documents in the refusal itself. The retry count is reported rather than
   * hidden: a runtime that needs a retry on every click is degraded even when it eventually hits.
   */
  const MAX_RETRIES = 2;
  const attempt = async (
    phaseName: string, how: string, expected: RangeTarget, command: DesktopCommand,
  ): Promise<CaseRecord> => {
    let result: DesktopResult = { ok: false } as DesktopResult;
    let before = 0;
    let retries = 0;

    for (let round = 0; round <= MAX_RETRIES; round++) {
      // Observe first: semantic clicks resolve against the newest observation, and a coordinate
      // click wants a current frame so a stale-frame refusal is not mistaken for a targeting miss.
      await observe();
      before = range.events().length;
      try {
        result = await runtime.run(command);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) } as DesktopResult;
      }
      if (result.ok !== false || !STALE_FRAME.test(String(result.error || ''))) break;
      retries += 1;
      await sleep(400);
    }

    // The range writes its hit synchronously in mouseDown, but the click returns as soon as the
    // event is posted; give AppKit a beat to dispatch it before declaring silence.
    for (let poll = 0; poll < 20 && range.events().length === before; poll++) await sleep(100);

    const score = scoreClick(expected, range.events(), before);
    const entry: CaseRecord = {
      ...score, phase: phaseName, how, retries,
      runtimeOk: result.ok !== false,
      runtimeError: result.ok === false ? (result.error || result.summary) : undefined,
      passed: score.outcome === 'hit',
    };
    record(entry);
    return entry;
  };

  /** Observed AXButtons, paired with the ground-truth target their reported frame actually covers.
   *  The pairing is done in global points via the runtime's own transform — an element the
   *  observation places outside every known target is itself a finding, not a skip. */
  const pairObserved = (
    observation: DesktopResult, manifest: RangeManifest, surface: string,
  ): Array<{ element: any; expected?: RangeTarget; screenshotPoint: { x: number; y: number } }> => {
    const window = manifest.surfaces?.[surface];
    const image = { width: Number(observation.width) || 0, height: Number(observation.height) || 0 };
    return ((observation.elements || []) as any[])
      .filter(element => element?.frame && element?.role === 'AXButton')
      .map(element => {
        const screenshotPoint = {
          x: Math.round(element.frame.x + element.frame.w / 2),
          y: Math.round(element.frame.y + element.frame.h / 2),
        };
        const global = window ? screenshotToGlobal(screenshotPoint, image, window) : null;
        return {
          element,
          screenshotPoint,
          expected: global ? targetAt(manifest, global.x, global.y, surface) : undefined,
        };
      });
  };

  try {
    await range.start(targetCount);
    const opened = await runtime.run({ action: 'open', app: APP_NAME });
    if (!opened.ok) throw new Error(`could not open the range: ${opened.error || opened.summary}`);
    await sleep(600);

    const manifest = range.manifest();
    const mainTargets = manifest.targets.filter(t => t.surface === 'main');

    // -- Phase A: labeled targets, resolved by their AX label -----------------------------------
    for (const target of mainTargets.filter(t => t.kind === 'labeled')) {
      await attempt('A-labeled', `click query="${target.label}"`, target,
        { action: 'click', query: target.label! });
    }

    // -- Phase B: unlabeled targets, clicked at the coordinates the runtime itself reported ------
    // The honest test of the observation pipeline: take the frame the runtime says an element
    // occupies, click its centre, and let the range say whether that was the element.
    const observation = await observe();
    const paired = pairObserved(observation, manifest, 'main');
    const knownLabels = new Set(mainTargets.map(t => t.label).filter(Boolean) as string[]);
    // An unlabeled element is one the range gave no label. The runtime synthesises a positional
    // descriptor for those ("unlabeled Button top-center #1"), so absence from the ground-truth
    // label set — not an empty string — is what identifies them.
    const unlabeled = paired.filter(pair => !knownLabels.has(String(pair.element.label || '').trim()));
    note('B-unlabeled-coords',
      `observation reported ${paired.length} AXButtons, ${unlabeled.length} of them unlabeled; `
      + `manifest has ${mainTargets.filter(t => t.kind === 'unlabeled').length} unlabeled targets`);

    for (const pair of unlabeled) {
      if (!pair.expected) {
        record({
          phase: 'B-unlabeled-coords', outcome: 'no-event', expectedId: '(unmapped)', retries: 0,
          how: `observed frame for "${pair.element.label}" covers no known target`,
          runtimeOk: true, passed: false,
          note: 'the observation and the app disagree about where this element is',
        });
        continue;
      }
      await attempt('B-unlabeled-coords',
        `click x=${pair.screenshotPoint.x} y=${pair.screenshotPoint.y} (reported frame centre)`,
        pair.expected, { action: 'click', ...pair.screenshotPoint });
    }

    // -- Phase C: unlabeled targets, reached by ordinal phrasing ---------------------------------
    // The ordinal is the target's position among ALL the window's enabled buttons ordered by centre
    // x — that is precisely how the resolver's spatialOrder ranks them, and how a reader looking at
    // the screen would count. Every target the range places is an AXButton, so the two agree.
    const ordering = xOrdinals(mainTargets);
    const unambiguousUnlabeled = ordering.filter(entry => !entry.ambiguous && entry.target.kind === 'unlabeled');
    const ordinalQueries: Array<{ target: RangeTarget; query: string }> = unambiguousUnlabeled
      .filter(entry => entry.ordinal < ORDINAL_WORDS.length)
      .slice(0, 3)
      .map(entry => ({ target: entry.target, query: `${ordinalPhrase(entry.ordinal)} button from the left` }));

    // "last" is well posed in ANY layout, including the grid, as long as the rightmost target is
    // clear of its neighbour — so it keeps this phase from silently testing nothing.
    const rightmost = ordering[ordering.length - 1];
    if (rightmost && !rightmost.ambiguous) {
      ordinalQueries.push({ target: rightmost.target, query: 'last button from the left' });
    }
    if (ordinalQueries.length === 0) {
      note('C-unlabeled-ordinal',
        `no unambiguously orderable target in this ${manifest.layout} layout — `
        + 'skipped (run with --layout row to make every ordinal answerable)');
    }
    for (const { target, query } of ordinalQueries) {
      await attempt('C-unlabeled-ordinal', `click query="${query}"`, target, { action: 'click', query });
    }

    // -- Phase E: a document-modal sheet ---------------------------------------------------------
    await resetRange();
    const sheetSpawner = mainTargets.find(t => t.kind === 'sheet');
    if (!sheetSpawner) {
      note('E-sheet', 'layout contained no sheet spawner — skipped');
    } else {
      const spawned = await attempt('E-sheet', `click query="${sheetSpawner.label}"`, sheetSpawner,
        { action: 'click', query: sheetSpawner.label! });
      if (spawned.passed) {
        await sleep(900);
        const reported = range.events().some(e => e.event === 'sheet-open' && e.id === sheetSpawner.id);
        // Modality must be confirmed from the AX tree. A sheet inferred from window geometry is the
        // failure mode that blocks every subsequent click and reads as "inaccurate clicks".
        const sheetObservation = await observe();
        const axSheet = ((sheetObservation.elements || []) as any[])
          .some(element => String(element?.role || '').includes('Sheet'));
        const sheetTargets = range.manifest().targets.filter(t => t.surface === sheetSpawner.id);
        const reachable = ((sheetObservation.elements || []) as any[])
          .some(element => String(element?.label || '') === 'Accept');
        record({
          phase: 'E-sheet', how: 'the sheet becomes observable after it opens',
          outcome: reachable ? 'hit' : 'no-event', expectedId: sheetSpawner.id, retries: 0,
          runtimeOk: sheetObservation.ok !== false, passed: reported && reachable,
          note: `range reported open=${reported}; AXSheet role observed=${axSheet}; `
            + `"Accept" reachable=${reachable}`,
        });
        const accept = sheetTargets.find(t => t.label === 'Accept');
        if (accept && reachable) {
          await attempt('E-sheet', 'click "Accept" inside the sheet', accept,
            { action: 'click', query: 'Accept' });
        } else if (accept) {
          note('E-sheet', 'skipped clicking inside the sheet: its contents never became observable');
        }
      }
    }

    // -- Phase D: a click that creates a new top-level window, and acting inside it ---------------
    await resetRange();
    const spawner = mainTargets.find(t => t.kind === 'child');
    if (!spawner) {
      note('D-child-window', 'layout contained no child-window spawner — skipped');
    } else {
      const windowsBefore = await runtime.run({ action: 'windows' });
      const idsBefore = (((windowsBefore.details as any)?.windows || []) as any[]).map(w => Number(w.window_id));
      const spawned = await attempt('D-child-window', `click query="${spawner.label}"`, spawner,
        { action: 'click', query: spawner.label! });

      if (spawned.passed) {
        await sleep(1000);
        const openedChild = range.events().some(e => e.event === 'child-window-open' && e.id === spawner.id);
        const windowsAfter = await runtime.run({ action: 'windows' });
        const idsAfter = (((windowsAfter.details as any)?.windows || []) as any[]).map(w => Number(w.window_id));
        const created = newWindowIds(idsBefore, idsAfter);
        record({
          phase: 'D-child-window', how: 'a new top-level window becomes visible to the runtime',
          outcome: created.length > 0 ? 'hit' : 'no-event', expectedId: spawner.id, retries: 0,
          runtimeOk: windowsAfter.ok !== false, passed: openedChild && created.length > 0,
          note: `range reported open=${openedChild}; new window ids=${JSON.stringify(created)}`,
        });

        // The child's targets did not exist when the run started, so reaching them requires the
        // runtime to have re-observed and retargeted rather than replayed the parent's frame.
        // `focus` is given an explicit shot at the new window id before this is called a failure.
        const childId = created[created.length - 1];
        if (childId) await runtime.run({ action: 'focus', app: APP_NAME, windowId: childId });
        const childObservation = await observe();
        const confirmLabel = `Confirm ${spawner.id}`;
        const reachable = ((childObservation.elements || []) as any[])
          .some(element => String(element?.label || '') === confirmLabel);
        record({
          phase: 'D-child-window', how: 'the child window\'s contents become observable',
          outcome: reachable ? 'hit' : 'no-event', expectedId: `${spawner.id}-confirm`, retries: 0,
          runtimeOk: childObservation.ok !== false, passed: reachable,
          note: reachable ? undefined
            : `after focus{windowId:${childId}} the observation still reports `
              + `${(childObservation.elements || []).length} elements at `
              + `${childObservation.width}x${childObservation.height} and "${confirmLabel}" is absent`,
        });

        const afterOpen = range.manifest();
        const confirm = afterOpen.targets.find(t => t.id === `${spawner.id}-confirm`);
        const dot = afterOpen.targets.find(t => t.id === `${spawner.id}-dot`);
        if (reachable && confirm) {
          await attempt('D-child-window', `click query="${confirm.label}" inside the child window`,
            confirm, { action: 'click', query: confirm.label! });
          const childPaired = pairObserved(await observe(), afterOpen, spawner.id);
          const dotPair = childPaired.find(pair => pair.expected?.id === dot?.id);
          if (dotPair) {
            await attempt('D-child-window', 'click the child window\'s unlabeled target by coordinates',
              dotPair.expected!, { action: 'click', ...dotPair.screenshotPoint });
          }
        } else if (confirm) {
          note('D-child-window',
            'skipped acting inside the child window: its contents never became observable');
        }
      }
    }

    // -- Report ------------------------------------------------------------------------------------
    await range.reset();
    const misses = range.events().filter(e => e.event === 'miss').length;
    const offsets = cases.filter(c => c.outcome === 'hit' && c.offsetPx !== undefined).map(c => c.offsetPx!);
    const failed = cases.filter(c => !c.passed);
    const report = {
      ok: failed.length === 0,
      seed,
      layout,
      reproduce: `tsx scripts/smoke-computer-range.ts --seed ${seed} --targets ${targetCount} --layout ${layout}`,
      summary: {
        attempted: cases.length,
        passed: cases.length - failed.length,
        wrongTarget: cases.filter(c => c.outcome === 'wrong-target').length,
        backgroundMisses: misses,
        noEvent: cases.filter(c => c.outcome === 'no-event').length,
        staleFrameRetries: cases.reduce((sum, c) => sum + c.retries, 0),
      },
      // Distance from the struck point to the target's true centre, over successful hits. A rising
      // p95 on a still-green run is the early warning that precision is decaying.
      precisionPx: offsetStats(offsets),
      phases: Object.fromEntries(Object.entries(phases).map(([name, value]) =>
        [name, { passed: value.passed, total: value.total, ...(value.notes.length ? { notes: value.notes } : {}) }])),
      failures: failed.map(c => ({
        phase: c.phase, how: c.how, expected: c.expectedId, actual: c.actualId ?? null,
        outcome: c.outcome, point: c.point, retries: c.retries,
        runtimeError: c.runtimeError, note: c.note,
      })),
      artifacts: { log: range.logPath, manifest: range.manifestPath },
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await runtime.dispose();
    if (!keep) range.stop();
    else console.error(`--keep: range still running; artifacts in ${directory}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
