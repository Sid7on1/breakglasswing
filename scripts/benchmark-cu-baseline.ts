/**
 * Phase 10 — the measurement baseline.
 *
 * The master plan's headline criterion is "at least 50% fewer model/tool turns on forms and menus"
 * (BIMAX_CU_MASTER_REFACTOR_PLAN_2026-07-31.md §24.2). It has never been measured, so every later
 * claim in the harvest plan has no denominator and none of them is falsifiable. This produces the
 * denominator: turns, tool calls, tokens and wall-clock per fixture task class, from ONE command.
 *
 * WHAT THIS MEASURES, precisely: a real model driving the real agent loop through the real
 * ComputerTool against BimaxCuFixture.app. `turns` is model round-trips — the number the criterion
 * is about — counted by src/telemetry/task.metrics.ts inside the loop, not by anything here.
 *
 * WHY NOT the existing benchmarks. `benchmark-computer-tasks.ts` drives the runtime from a
 * deterministic planner with perfect intent: it has ZERO model turns by construction and therefore
 * cannot produce this number at all. `benchmarks/autonomy --live` runs a model but on coding tasks
 * with no GUI. The autonomy suite's offline mode (`offline-trajectory-smoke`) replays recorded
 * trajectories and measures the HARNESS — its completion rate must never be quoted as a model
 * result, and it is not used here.
 *
 * GRADING is on independently re-read ground truth: after the loop ends, the fixture's own
 * accessibility state is observed afresh and compared against what the task asked for. The model's
 * claim of success is never the evidence, and neither is the tool's `ok` field — this repo has
 * three separate findings about exactly that mistake.
 *
 * FAILURES ARE PART OF THE BASELINE. A task the model cannot complete is recorded as failed with
 * its turn count intact. A baseline that silently dropped them would report the turns of only the
 * tasks that happened to work and read far better than the system is.
 *
 * SAFETY: every action targets BimaxCuFixture.app, whose controls are inert and mutate only their
 * own state. Nothing here opens, edits, or closes anything of the user's. The fixture is relaunched
 * between tasks so each one starts from an identical, known state.
 *
 * Usage:
 *   npx tsx scripts/benchmark-cu-baseline.ts                 # the full baseline
 *   npx tsx scripts/benchmark-cu-baseline.ts --only form-textfield
 *   npx tsx scripts/benchmark-cu-baseline.ts --repeats 3     # median over N runs per task
 *   npx tsx scripts/benchmark-cu-baseline.ts --list
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

import type { BimaxComputerRuntime, DesktopResult } from '../src/computer/desktop.runtime';
import type { TaskRun } from '../src/telemetry/task.metrics';
import { buildComputerUseModelPrompt } from '../src/cli/personas/computer.playbook';

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * The APPLICATION name (CFBundleName), which is what `open` resolves. "Bimax-Cu Fixture" is only
 * the window title — targeting by it fails with "No installed macOS app found", and measured that
 * way every task would fail for one uninteresting reason.
 */
// Measured: naming BOTH in a prompt is worse than naming one. An earlier revision said
// `BimaxCuFixture (window title "Bimax-Cu Fixture")` and the model reached for the parenthetical,
// so every run died on "No installed macOS app found for name 'Bimax-Cu Fixture'". The prompts
// name the resolvable identifier and nothing else — the task set measures turns, not whether a
// model can pick the right one of two names we handed it.
const FIXTURE_APP_NAME = 'BimaxCuFixture';
const FIXTURE_BUNDLE_ID = 'ai.bimax.cu.fixture';

/**
 * Installed under ~/Applications rather than a temp dir, because app resolution scans the standard
 * Applications roots (src/computer/installed.apps.ts) — Launch Services cannot see a bundle in
 * /var/folders, so `open` refuses it. ~/Applications needs no admin rights and no system directory
 * is touched.
 */
const FIXTURE_INSTALL_PATH = path.join(os.homedir(), 'Applications/BimaxCuFixture.app');

/**
 * The task classes the criterion names. `form` and `menu` are the two it is actually judged on;
 * `navigation` and `transaction` are carried because Phase 12 claims improvements on them too and
 * a baseline gathered later would not be comparable to this one.
 */
type TaskClass = 'form' | 'menu' | 'selection' | 'transaction';

interface BaselineTask {
  id: string;
  taskClass: TaskClass;
  /** Exactly what the model is asked to do. Unambiguous on purpose: this measures turns, not
   *  instruction-following under vagueness, and an ambiguous prompt would measure both at once. */
  prompt: string;
  /** Grade from a FRESH observation of the fixture. Never from the model's or the tool's claim. */
  grade(elements: any[], status: string): { passed: boolean; detail: string };
}

const el = (elements: any[], predicate: (e: any) => boolean): any => elements.find(predicate);
const roleOf = (e: any): string => String(e?.role || '');
const labelOf = (e: any): string => String(e?.label || '');
const valueOf = (e: any): string => String(e?.value ?? '');
/** AppKit reports a set toggle as "1"; accept the spellings a bridge might use, nothing looser. */
const isOn = (value: string): boolean => value === '1' || value.toLowerCase() === 'true';

const TASKS: BaselineTask[] = [
  {
    id: 'form-textfield',
    taskClass: 'form',
    prompt: `Open the macOS application named ${FIXTURE_APP_NAME} and set the single-line text field `
      + '(it currently reads "alpha beta gamma") to exactly: baseline-ok\n'
      + 'Do not change any other control. Stop as soon as the field holds that text.',
    grade: (elements) => {
      const field = el(elements, e => roleOf(e) === 'AXTextField' && valueOf(e) === 'baseline-ok');
      return field
        ? { passed: true, detail: `text field = ${JSON.stringify(valueOf(field))}` }
        : { passed: false, detail: 'no text field holds "baseline-ok"' };
    },
  },
  {
    id: 'form-checkbox',
    taskClass: 'form',
    prompt: `Open the macOS application named ${FIXTURE_APP_NAME} and tick the checkbox labelled `
      + '"Fixture Checkbox" so it becomes checked.\n'
      + 'Do not change any other control. Stop as soon as it is checked.',
    // Graded on END STATE, never on "a toggle happened". An earlier revision accepted
    // `last=toggle` from the status label as an alternative, and a run that toggled the box twice
    // — ending UNCHECKED, value=0, events=2 — was scored PASS. The task is to leave it checked;
    // an event counter cannot express that, and any "something happened" proxy admits the reverse
    // of what was asked.
    grade: (elements, status) => {
      const box = el(elements, e => roleOf(e) === 'AXCheckBox');
      const checked = !!box && isOn(valueOf(box));
      return { passed: checked, detail: `checkbox value=${box ? valueOf(box) : 'not found'} · status ${JSON.stringify(status)}` };
    },
  },
  {
    id: 'menu-popup',
    taskClass: 'menu',
    prompt: `Open the macOS application named ${FIXTURE_APP_NAME} and use the pop-up button (its choices are `
      + 'First, Second and Third) to select: Third\n'
      + 'Do not change any other control. Stop as soon as it shows Third.',
    grade: (elements) => {
      const popup = el(elements, e => roleOf(e) === 'AXPopUpButton');
      const value = popup ? valueOf(popup) || labelOf(popup) : '';
      return /third/i.test(value)
        ? { passed: true, detail: `popup = ${JSON.stringify(value)}` }
        : { passed: false, detail: `popup = ${JSON.stringify(value) || 'not found'}` };
    },
  },
  // The table-row task the benchmark spec lists ("select table row") is NOT here, and its absence
  // is a measured finding rather than an omission. The fixture's 40-row table contributes ZERO
  // elements to the observation payload — at maxElements 500 the window yields 18 elements and not
  // one of them is a row (see docs/BIMAX_CU_BASELINE_v1.1.0.md). With no row in the payload there
  // is no end state to read, and the only available signal is the fixture's "last=select" counter,
  // which cannot tell selecting Row 7 from selecting Row 1. Grading a baseline entry on that would
  // record a number that a wrong answer also earns. A radio group stands in for the selection
  // class: it is exposed with a readable value, and the fixture's own comment notes it exercises
  // the delivery ladder's fallthrough (it refuses AXSelected and answers AXPress).
  {
    id: 'select-radio',
    taskClass: 'selection',
    prompt: `Open the macOS application named ${FIXTURE_APP_NAME} and select the radio button `
      + 'labelled exactly: Two\n'
      + 'Do not change any other control. Stop as soon as it is selected.',
    grade: (elements, status) => {
      const two = el(elements, e => roleOf(e) === 'AXRadioButton' && /^two$/i.test(labelOf(e).trim()));
      const one = el(elements, e => roleOf(e) === 'AXRadioButton' && /^one$/i.test(labelOf(e).trim()));
      const passed = !!two && isOn(valueOf(two));
      return {
        passed,
        detail: `radio Two=${two ? valueOf(two) : 'not found'} One=${one ? valueOf(one) : '?'} · status ${JSON.stringify(status)}`,
      };
    },
  },
  {
    id: 'txn-two-fields',
    taskClass: 'transaction',
    prompt: `Open the macOS application named ${FIXTURE_APP_NAME} and do BOTH of these:\n`
      + '1. set the single-line text field to exactly: txn-ok\n'
      + '2. tick the checkbox labelled "Fixture Checkbox"\n'
      + 'Do not change any other control. Stop once both are done.',
    // Both halves graded on end state, for the same reason as form-checkbox: a transaction that
    // set the field and then toggled the box back off has not done what was asked.
    grade: (elements, status) => {
      const field = el(elements, e => roleOf(e) === 'AXTextField' && valueOf(e) === 'txn-ok');
      const box = el(elements, e => roleOf(e) === 'AXCheckBox');
      const checked = !!box && isOn(valueOf(box));
      return {
        passed: !!field && checked,
        detail: `field=${field ? 'ok' : 'missing'} checkbox=${box ? valueOf(box) : 'not found'} · status ${JSON.stringify(status)}`,
      };
    },
  },
];

const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

// ─── fixture lifecycle ──────────────────────────────────────────────────────────────────────────

function buildFixture(): string {
  const out = execFileSync('bash', [path.join(REPO_ROOT, 'scripts/build-bimax-cu-fixture.sh'), FIXTURE_INSTALL_PATH], {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  return out.trim() || FIXTURE_INSTALL_PATH;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Kill EVERY fixture process, not just one we spawned.
 *
 * Measured: grading calls `open`, and when the spawned instance is not adopted Launch Services
 * starts its own — which no child handle tracks and nothing then kills. The next run's `open`
 * adopted that survivor instead of the fresh spawn, so tasks were graded against a fixture
 * carrying the PREVIOUS task's state: a "fresh" run reported `events=1 last=toggle` and an
 * already-checked checkbox. Ownership by process name is the only reliable sweep here.
 */
function killAllFixtures(): void {
  try {
    execFileSync('pkill', ['-f', 'BimaxCuFixture.app/Contents/MacOS/bimax-cu-fixture'], { stdio: 'ignore' });
  } catch { /* pkill exits non-zero when nothing matched, which is the normal case */ }
}

async function launchFixture(appPath: string): Promise<ChildProcess> {
  // Sweep first: a survivor from an earlier run would be adopted in preference to this one.
  killAllFixtures();
  await sleep(200);
  const binary = path.join(appPath, 'Contents/MacOS/bimax-cu-fixture');
  const child = spawn(binary, [], { stdio: 'ignore', detached: false });
  await sleep(1_200); // AppKit needs to publish its window before the AX tree is meaningful
  return child;
}

async function quitFixture(child: ChildProcess | null): Promise<void> {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await sleep(300);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  killAllFixtures();
}

// ─── measurement ────────────────────────────────────────────────────────────────────────────────

interface Measurement {
  task: string;
  taskClass: TaskClass;
  passed: boolean;
  detail: string;
  turns: number;
  toolCalls: number;
  /** Which tools actually ran. A turn count alone cannot distinguish "the model worked the problem
   *  and failed" from "the model never called an acting verb", and those are different findings. */
  toolCallsByName: Record<string, number>;
  promptTokens: number;
  wallClockMs: number;
  /**
   * The model actually in the work slot when this run ENDED. Recorded per run because the adapter
   * re-points that slot itself: `LlmAdapter.heal()` rewrites `userModel` when a provider fails, and
   * a suite that began on one model can finish on another. A turn count is meaningless without
   * knowing which model produced it, and the meta header alone cannot say.
   */
  model: string;
  backend?: string;
  /** Exact model-facing ComputerTool calls/results for diagnosis. Fixture-only; never a grader. */
  actionTrace?: Array<{ input: string; output: string }>;
  /** The model's own closing words, truncated. Recorded because this repo has a finding that a
   *  weak model can print bare tool arguments as prose — read the last message before concluding
   *  the model gave up. It is diagnostic only and never contributes to the verdict. */
  finalMessage?: string;
  error?: string;
  /**
   * Set when the run never became a measurement of anything. A provider outage mid-suite produced
   * runs with zero prompt tokens and zero tool calls in three seconds; recorded as ordinary
   * failures they read as "the model tried this task and could not do it", which is a claim about
   * the model that the data does not support. Invalid runs are reported separately and excluded
   * from every median — silently dropping them would hide an outage, and counting them would
   * invent a result.
   */
  invalid?: string;
}

/** A run in which the model never spoke, or which could not be graded, measures nothing. */
function invalidReason(
  run: TaskRun | undefined, transcript: string, elements: any[],
): string | undefined {
  if (!run) return 'no task run was recorded';
  if (run.promptTokens === 0 && run.toolCalls === 0) {
    const provider = /provider returned an error: ([^\n]{0,120})/i.exec(transcript);
    return `provider unavailable — no model call completed${provider ? ` (${provider[1].trim()})` : ''}`;
  }
  if (!isAccessibilityObservation(elements)) {
    return 'ungradeable — the AX tree was empty and grading saw only the OCR fallback';
  }
  return undefined;
}

/**
 * Read the fixture's state independently of anything the model or the tool reported.
 *
 * `open` first, always: the runtime refuses observe until it owns a window ("no application window
 * is owned yet"), and ownership is dropped at each turn boundary. On an already-running fixture
 * this adopts that exact process rather than launching a second one.
 */
async function readFixtureState(
  runtime: BimaxComputerRuntime, cwd: string,
): Promise<{ elements: any[]; status: string }> {
  const opened: DesktopResult = await runtime.run(
    { action: 'open', app: FIXTURE_APP_NAME, bundleId: FIXTURE_BUNDLE_ID } as any, { cwd },
  );
  if (!opened.ok) return { elements: [], status: `__grading_failed__ ${opened.error || ''}` };
  const observed: DesktopResult = await runtime.run(
    { action: 'observe', maxElements: 500 } as any, { cwd },
  );
  const elements = (observed.elements as any[]) || [];
  // The fixture's own status label ("presses=N events=M last=X") is an AX-independent report that
  // an actuation really happened — it is written by the control's action handler, not by us.
  const status = elements
    .map(e => String(e?.value ?? e?.label ?? ''))
    .find(text => /presses=\d+/.test(text)) || '';
  return { elements, status };
}

/**
 * True when the observation is the ACCESSIBILITY tree and not the vision fallback.
 *
 * When the AX tree comes back empty the runtime substitutes OCR, and those elements carry
 * `role: "VisualText"` with whatever the recogniser read off the pixels — observed here as
 * "Fixiure Cheekbox", "Fixture Buiton" and "esserO eventS-O la5t=Mne". Grading against that is
 * strictly worse than not grading: a checkbox has no readable value in OCR at all, so every task
 * would score FAIL regardless of what the model achieved, and the baseline would record the OCR
 * failure rate wearing the model's name.
 */
function isAccessibilityObservation(elements: any[]): boolean {
  return elements.some(e => roleOf(e).startsWith('AX'));
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('The Bimax-Cu baseline is macOS-only.');

  if (process.argv.includes('--list')) {
    for (const task of TASKS) console.log(`${task.id.padEnd(18)} ${task.taskClass}`);
    return;
  }

  // --self-test: prove the graders can FAIL. A grader that cannot distinguish a finished task from
  // an untouched one turns the whole baseline into noise, and this suite has already shipped one
  // that could not: it accepted the fixture's "a toggle happened" counter, so a run that toggled
  // the checkbox twice — ending unchecked — scored PASS. Against a freshly launched fixture every
  // task is by definition unfinished, so every grader must say so.
  if (process.argv.includes('--self-test')) {
    buildFixture();
    const { BimaxComputerRuntime: R } = await import('../src/computer/desktop.runtime');
    const runtime = new R();
    const fixture = await launchFixture(FIXTURE_INSTALL_PATH);
    try {
      const { elements, status } = await readFixtureState(runtime, REPO_ROOT);
      // Both halves matter. Graders that return false because grading saw NOTHING would sail
      // through a check that only asks "did anything pass?" — that exact vacuous pass happened
      // once, with every task reporting "not found" against the OCR fallback.
      if (!isAccessibilityObservation(elements)) {
        throw new Error(`self-test aborted: grading saw the OCR fallback, not the AX tree `
          + `(${elements.length} elements, roles: ${[...new Set(elements.map(roleOf))].join(',')}). `
          + 'Re-run once the fixture publishes an accessibility tree.');
      }
      if (!el(elements, e => roleOf(e) === 'AXCheckBox')) {
        throw new Error('self-test aborted: the fixture checkbox is absent from the observation.');
      }
      let bad = 0;
      for (const task of TASKS) {
        const verdict = task.grade(elements, status);
        if (verdict.passed) {
          bad++;
          console.log(`BROKEN  ${task.id} passed against an untouched fixture — ${verdict.detail}`);
        } else {
          console.log(`ok      ${task.id} correctly fails when nothing was done — ${verdict.detail}`);
        }
      }
      console.log(bad === 0 ? '\nself-test PASSED' : `\nself-test FAILED: ${bad} grader(s) cannot fail`);
      process.exitCode = bad === 0 ? 0 : 1;
    } finally {
      await quitFixture(fixture);
      await runtime.dispose?.();
    }
    return;
  }

  const only = (argValue('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
  const repeats = Math.max(1, Number(argValue('--repeats') || 1));
  const maxIterations = Math.max(1, Number(argValue('--max-iterations') || 24));
  const selected = only.length ? TASKS.filter(t => only.includes(t.id)) : TASKS;
  if (selected.length === 0) throw new Error(`No task matched --only ${only.join(',')}`);

  // Same environment order as CLI startup, so the baseline runs the configuration the user ships.
  const { loadGlobalEnv } = await import('../src/cli/env.loader');
  loadGlobalEnv();
  dotenv.config({ path: path.join(REPO_ROOT, '.env') });

  // Pin the work model for the whole suite through BGW_MODEL, BEFORE the first loadConfig().
  //
  // This is not a convenience. Measured: `LlmAdapter.heal()` re-points the work slot when a
  // provider fails, and because the model had come from the GLOBAL CONFIG scope that heal was
  // persisted — a benchmark run silently rewrote the user's saved model from
  // nvidia/nemotron-nano-12b-v2-vl to mistralai/mistral-nemotron, and every later run then
  // "started" on the rotated model. A measurement harness must not mutate the thing it measures.
  //
  // BGW_MODEL puts the value in the ENV scope, and config.ts refuses to persist runtime-origin
  // writes to env-scoped keys (the volatility guard). Healing can still re-point the slot in
  // memory for this process — which is why each run records the model it actually ended on — but
  // it can no longer follow the user home.
  const pinned = argValue('--model') || readConfiguredModel();
  if (pinned) process.env.BGW_MODEL = pinned;

  const [
    { AgentLoop }, { ToolRegistry }, { createComputerTool },
    { loadConfig }, { buildKeyPool }, { ApiKeyManager }, { LlmAdapter },
    { BimaxComputerRuntime: Runtime }, { taskMetrics }, { BiMaxPersona }, { cliEvents },
  ] = await Promise.all([
    import('../src/core/agent.loop'),
    import('../src/tools/tool.registry'),
    import('../src/tools/implementations/computer.tool'),
    import('../src/cli/config'),
    import('../src/cli/provider'),
    import('../src/credits/api.key.manager'),
    import('../src/core/llm.adapter'),
    import('../src/computer/desktop.runtime'),
    import('../src/telemetry/task.metrics'),
    import('../src/cli/personas/implementations'),
    import('../src/cli/events'),
  ]);

  const config = await loadConfig();
  const keyPool = buildKeyPool();
  if (keyPool.length === 0) {
    throw new Error('No API key found. A baseline of model turns requires a real model — configure '
      + 'NVIDIA_API_KEY (or another provider key) in ~/.breakglass/.env.');
  }
  const provider = new LlmAdapter(new ApiKeyManager(keyPool));
  provider.applyConfig({
    model: config.model, timeout: config.timeout, temperature: config.temperature,
    topP: config.topP, maxTokens: config.maxTokens, reasoningEffort: config.reasoningEffort,
    parallelToolCalls: config.parallelToolCalls, liteModel: config.liteModel,
  });

  console.log(`model            ${config.model}`);
  console.log(`tasks            ${selected.map(t => t.id).join(', ')} × ${repeats}`);

  const appPath = buildFixture();
  console.log(`fixture          ${appPath}\n`);

  const cwd = REPO_ROOT;
  const runtime = new Runtime();
  const measurements: Measurement[] = [];

  // An invalid run measured nothing — a provider outage or an empty AX tree — so re-running it
  // costs a sample and biases nothing. This is emphatically NOT retrying failures: a task the
  // model attempted and got wrong is kept exactly as it happened, because re-rolling those until
  // they pass is how a benchmark starts flattering itself.
  const MAX_RETRIES_PER_RUN = 2;

  for (const task of selected) {
    for (let attempt = 1; attempt <= repeats; attempt++) {
      for (let retry = 0; retry <= MAX_RETRIES_PER_RUN; retry++) {
      let fixture: ChildProcess | null = null;
      let error: string | undefined;
      try {
        // A fresh process per run: the fixture holds mutable state, and a task that started from
        // the previous task's leftovers would be measuring a different problem each time.
        fixture = await launchFixture(appPath);

        const registry = new ToolRegistry();
        const governor = { approveTaskExecution: async (): Promise<void> => {} } as any;
        registry.register(createComputerTool(governor, runtime as any));
        const persona = new BiMaxPersona(registry, provider as any);
        const loop = new AgentLoop(provider as any, registry, undefined, config.contextWindowTokens || 128_000);
        taskMetrics.reset();
        let transcript = '';
        const actionTrace: Array<{ input: string; output: string }> = [];
        const captureAction = (entry: any) => {
          if (entry?.toolName !== 'ComputerTool' || actionTrace.length >= 30) return;
          actionTrace.push({ input: String(entry.input || ''), output: String(entry.output || '').slice(0, 8_000) });
        };
        cliEvents.on('tool_call_result', captureAction);
        try {
          // Use the exact desktop prompt builder and specialized system-prompt/tool gates used by
          // AgentPersona.execute(), without invoking unrelated persona side effects (memory mining,
          // self-critic, or harness-lab work) that would contaminate this measurement process.
          for await (const chunk of loop.execute(
            [{ role: 'user', content: buildComputerUseModelPrompt(task.prompt, { model: config.model }) }],
            persona.getSystemPrompt({ computerUse: true, toolNames: ['ComputerTool'] }),
            {
              maxIterations,
              contextMode: 'smart',
              metricsLabel: task.taskClass,
              toolNames: ['ComputerTool'],
              skipRepoMap: true,
              requireTool: 'ComputerTool',
            },
            { cwd, sessionId: `baseline-${task.id}-${attempt}` },
          )) {
            transcript += String(chunk ?? '');
            if (transcript.length > 8_000) transcript = transcript.slice(-8_000);
          }
        } catch (e: any) {
          error = e?.message ?? String(e);
        } finally {
          cliEvents.off('tool_call_result', captureAction);
        }

        const run: TaskRun | undefined = taskMetrics.getRuns().slice(-1)[0];
        const { elements, status } = await readFixtureState(runtime, cwd);
        const verdict = task.grade(elements, status);

        measurements.push({
          task: task.id, taskClass: task.taskClass,
          passed: verdict.passed, detail: verdict.detail,
          turns: run?.turns ?? 0,
          toolCalls: run?.toolCalls ?? 0,
          toolCallsByName: run?.toolCallsByName ?? {},
          promptTokens: run?.promptTokens ?? 0,
          wallClockMs: run?.wallClockMs ?? 0,
          model: String((provider as any).userModel || (provider as any).defaultModel || config.model),
          ...(run?.computerBackend ? { backend: run.computerBackend } : {}),
          ...(actionTrace.length ? { actionTrace } : {}),
          ...(transcript.trim() ? { finalMessage: transcript.trim().slice(-600) } : {}),
          ...(error ? { error } : {}),
          ...(invalidReason(run, transcript, elements) ? { invalid: invalidReason(run, transcript, elements)! } : {}),
        });
        const last = measurements[measurements.length - 1];
        const willRetry = !!last.invalid && retry < MAX_RETRIES_PER_RUN;
        console.log(last.invalid
          ? `SKIP ${task.id.padEnd(18)} ${last.invalid}${willRetry ? ' — retrying (measured nothing)' : ''}`
          : `${verdict.passed ? 'PASS' : 'FAIL'} ${task.id.padEnd(18)} `
            + `turns=${String(last.turns).padStart(3)} tools=${String(last.toolCalls).padStart(3)} `
            + `tokens=${String(last.promptTokens).padStart(7)} ${(last.wallClockMs / 1000).toFixed(1)}s  ${verdict.detail}`);
        // Drop the discarded attempt and try once more; keeping it would double-count a
        // non-measurement in the "runs" column.
        if (willRetry) measurements.pop();
        if (!last.invalid) break;
      } finally {
        await quitFixture(fixture);
        await runtime.dispose?.();
      }
      }
    }
  }

  const report = buildReport(measurements, {
    model: config.model,
    commit: gitCommit(),
    macos: os.release(),
    arch: process.arch,
    startedAt: new Date().toISOString(),
  });

  const outDir = path.join(REPO_ROOT, 'benchmarks/cu-baseline');
  await fsp.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fsp.writeFile(path.join(outDir, `baseline-${stamp}.json`),
    `${JSON.stringify({ meta: report.meta, measurements }, null, 2)}\n`);
  console.log(`\n${report.markdown}`);
  console.log(`\nraw: benchmarks/cu-baseline/baseline-${stamp}.json`);
}

/**
 * The user's configured work model, read straight from the file rather than through loadConfig,
 * because it has to be known BEFORE the first loadConfig in order to be pinned into the env scope.
 */
function readConfiguredModel(): string {
  const file = path.join(process.env.BIMAX_BREAKGLASS_DIR || path.join(os.homedir(), '.breakglass'), 'config.json');
  try {
    const parsed = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
    return typeof parsed?.model === 'string' ? parsed.model : '';
  } catch { return ''; }
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch { return 'unknown'; }
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
};

export function buildReport(
  measurements: Measurement[], meta: Record<string, string>,
): { markdown: string; meta: Record<string, string> } {
  const valid = measurements.filter(m => !m.invalid);
  const invalid = measurements.filter(m => m.invalid);
  const classes = [...new Set(valid.map(m => m.taskClass))];
  const rows = classes.map(taskClass => {
    const group = valid.filter(m => m.taskClass === taskClass);
    const passed = group.filter(m => m.passed);
    return {
      taskClass,
      runs: group.length,
      completed: `${passed.length}/${group.length}`,
      // Medians over EVERY run, completed or not. Averaging only the successes would report the
      // turn cost of the tasks that happened to work, which is the flattering number, not the real
      // one — and the whole point of this file is to be the denominator nobody can flatter.
      medianTurns: median(group.map(m => m.turns)),
      medianToolCalls: median(group.map(m => m.toolCalls)),
      medianPromptTokens: median(group.map(m => m.promptTokens)),
      medianWallClockS: (median(group.map(m => m.wallClockMs)) / 1000).toFixed(1),
    };
  });

  const header = '| task class | runs | completed | median turns | median tool calls | median prompt tokens | median wall clock |';
  const divider = '|---|---|---|---|---|---|---|';
  const body = rows.map(r => `| ${r.taskClass} | ${r.runs} | ${r.completed} | ${r.medianTurns} | `
    + `${r.medianToolCalls} | ${r.medianPromptTokens} | ${r.medianWallClockS}s |`).join('\n');

  // Never let a partial suite masquerade as a baseline. If the provider dropped out, the table
  // that survives is a table of whichever tasks happened to run before it did.
  const note = invalid.length
    ? `\n\n**${invalid.length} of ${measurements.length} runs were DISCARDED, not measured** `
      + `(${[...new Set(invalid.map(m => m.invalid))].join('; ')}). `
      + 'They are excluded from every median above. A class showing no rows had no valid run at all.'
    : '';

  // A frozen baseline has to be attributable and repeated. These two conditions are what separate
  // "the number v1.1.0 produces" from "some numbers a degraded afternoon produced", and the report
  // says which one it is rather than leaving the reader to assume the stronger claim.
  const models = [...new Set(valid.map(m => m.model))];
  const thinnest = Math.min(...rows.map(r => r.runs));
  const disqualifiers = [
    models.length > 1
      ? `the work model changed mid-suite (${models.join(' → ')}), so these rows are not all the same system`
      : '',
    invalid.length > 0 ? `${invalid.length} run(s) were lost to provider outages` : '',
    rows.length === 0 || thinnest < 3 ? `at least one class has fewer than 3 valid runs (thinnest: ${rows.length ? thinnest : 0})` : '',
  ].filter(Boolean);
  const verdict = disqualifiers.length
    ? `\n\n> **PROVISIONAL — not a frozen baseline.** ${disqualifiers.join('; ')}. `
      + 'Re-run with `npm run benchmark:cu-baseline -- --repeats 3` on a healthy provider before '
      + 'quoting these as the v1.1.0 denominator.'
    : '\n\n> Frozen baseline: one model throughout, no discarded runs, at least 3 valid runs per class.';

  return {
    meta,
    markdown: [
      `model(s): ${models.join(', ') || meta.model} · commit: ${meta.commit} · ${meta.startedAt}`,
      '', header, divider, body,
    ].join('\n') + note + verdict,
  };
}

if (require.main === module) {
  main().catch(error => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
}
