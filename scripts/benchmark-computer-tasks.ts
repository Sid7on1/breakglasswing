/**
 * Task-completion benchmark — the denominator this project did not have.
 *
 * WHAT THIS MEASURES: whether the harness can carry a multi-step task to a proven end state when the
 * intent is unambiguous. The benchmark acts as a deterministic planner with perfect intent, so the
 * result is a CAPABILITY FLOOR: whatever fails here with a perfect planner cannot succeed with a
 * model driving. Every other number this repo reports — resolver latency, receipt scoring, suite
 * counts — measures machinery. This measures whether the machinery gets work done.
 *
 * WHAT THIS DOES NOT MEASURE: model reasoning, target selection from vague instructions, error
 * recovery under uncertainty, or anything about how an LLM behaves in the loop. A model-in-the-loop
 * evaluation is a separate, more expensive exercise and its numbers would be strictly lower.
 *
 * SCORING: each task is graded against ground truth read back independently — a fresh observation,
 * achieved window geometry, or on-device OCR — never against the harness's own actionResult. A
 * system that grades itself with its own confidence field proves nothing. Where OCR is available it
 * is recorded as a second, AX-independent opinion.
 *
 * SAFETY: every task runs in documents this benchmark creates and discards, or is read-only. It
 * never opens, edits, saves, or closes anything of the user's, and never quits an application.
 *
 * Usage:
 *   npx tsx scripts/benchmark-computer-tasks.ts
 *   npx tsx scripts/benchmark-computer-tasks.ts --only typing-exact,window-layout
 *   npx tsx scripts/benchmark-computer-tasks.ts --list
 */
import { BimaxComputerRuntime, DesktopResult } from '../src/computer/desktop.runtime';
import {
  actFresh, assertNotBlocked, countDocumentWindows, editableIn, handleFor,
  newDocument, observe, openEditor, requireOk, restoreWindowBaseline, sleep,
} from './lib/scratch-doc';

interface TaskContext {
  runtime: BimaxComputerRuntime;
  cwd: string;
  /** Documents this task created, discarded in reverse order regardless of outcome. */
  createdDocuments: number;
  /** Display size in points, measured once before any window was owned. */
  display: { w: number; h: number } | null;
  marker(): string;
}

interface Verdict {
  passed: boolean;
  detail: string;
  evidence?: Record<string, unknown>;
}

interface BenchTask {
  id: string;
  title: string;
  capability: string;
  /** Perform the task and return the verdict, graded on independently re-read ground truth. */
  run(ctx: TaskContext): Promise<Verdict>;
}

const argValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

/**
 * On-device OCR of the current window — the ground-truth oracle for text.
 *
 * It has to be OCR rather than the accessibility value: measured on this machine, an AXTextArea is
 * published WITHOUT a value field (checkboxes and pop-ups carry theirs), so there is no AX text to
 * read back. That is arguably the right call for privacy — receipts deliberately carry value length
 * rather than contents — but it means a text oracle must come from pixels. Which is the stronger
 * choice anyway: OCR shares no code path with the accessibility tree the harness targeted through.
 *
 * Passing an absent query is what forces the ambiguity path, so Vision runs on demand.
 */
async function ocrText(ctx: TaskContext): Promise<string[] | null> {
  const probe = await observe(ctx.runtime, ctx.cwd, '__bimax_absent_visual_probe__');
  // OCR results do not come back on `visualAnalysis` for an observation — that field belongs to the
  // direct visual_analysis verb. An observation merges recognised text into its element list as
  // role=VisualText entries marked source=on_device_vision.
  const texts = (probe.elements as any[] || [])
    .filter(element => String(element?.role) === 'VisualText')
    .map(element => String(element?.label || ''))
    .filter(Boolean);
  return texts.length ? texts : null; // no opinion beats a false negative
}

/** OCR splits lines, so a marker is matched against the joined text as well as each line. */
function ocrHas(texts: string[] | null, needle: string): boolean | null {
  if (!texts) return null;
  return texts.some(text => text.includes(needle)) || texts.join('').includes(needle);
}

/** Live geometry of the front window, read from the window list rather than from an action result. */
async function frontWindowBounds(ctx: TaskContext, windowId?: number): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const listed = await ctx.runtime.run({ action: 'windows', app: 'TextEdit' }, { cwd: ctx.cwd });
  const windows = ((listed.details as any)?.windows || []) as any[];
  const match = windowId
    ? windows.find(window => Number(window?.window_id) === windowId)
    : windows.filter(window => window?.is_on_screen !== false
      && Number(window?.bounds?.width || 0) > 100 && Number(window?.bounds?.height || 0) > 100)[0];
  const bounds = match?.bounds;
  if (!bounds) return null;
  const frame = {
    x: Number(bounds.x ?? bounds.left ?? 0), y: Number(bounds.y ?? bounds.top ?? 0),
    w: Number(bounds.width ?? bounds.w), h: Number(bounds.height ?? bounds.h),
  };
  return Object.values(frame).every(Number.isFinite) && frame.w > 0 ? frame : null;
}

/**
 * Display size in POINTS, captured once before any application is owned.
 *
 * This must happen first: once a target window is owned, `screenshot` is window-scoped, and it
 * returned the 603×505 document at 2× as a "1206×1010 display". That made the left-half check pass
 * for a completely bogus reason — 603 is about half of 1206, and nowhere near half of the real
 * 1470-point display. A benchmark whose oracle drifts with the thing it is measuring is worthless.
 */
async function measureDisplay(runtime: BimaxComputerRuntime, cwd: string): Promise<{ w: number; h: number } | null> {
  const shot = await runtime.run({ action: 'screenshot' }, { cwd });
  if (!shot.ok || !shot.width || !shot.height) return null;
  const scale = shot.screenWidth && shot.width ? Math.round(shot.width / shot.screenWidth) || 1 : 1;
  return { w: Math.round(shot.width / scale), h: Math.round(shot.height / scale) };
}

/** Type into the front document's editable field using a semantic handle, never coordinates. */
async function typeIntoDocument(ctx: TaskContext, observation: DesktopResult, text: string): Promise<DesktopResult> {
  const editable = editableIn(observation);
  if (!editable) throw new Error('the document exposed no editable field');
  return actFresh(ctx.runtime, ctx.cwd, {
    action: 'type', text, ...handleFor(editable), frameId: observation.frameId, deliveryMode: 'foreground',
  });
}

const TASKS: BenchTask[] = [
  {
    id: 'typing-exact',
    title: 'Type a unique string into a new document and prove the exact content',
    capability: 'typing',
    async run(ctx) {
      const marker = ctx.marker();
      const document = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      const typed = await typeIntoDocument(ctx, document, marker);
      const seen = ocrHas(await ocrText(ctx), marker);
      return {
        passed: seen === true,
        detail: seen === true ? 'the typed string is visible on screen'
          : seen === null ? 'OCR produced no text, so the result cannot be graded' : 'the typed string is not on screen',
        evidence: { harnessClaimed: typed.actionResult?.confidence, harnessDelivered: typed.ok },
      };
    },
  },
  {
    id: 'typing-replace',
    title: 'Replace a document’s entire contents (type, select all, retype)',
    capability: 'typing',
    async run(ctx) {
      const first = ctx.marker(), second = ctx.marker();
      const document = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      await typeIntoDocument(ctx, document, first);
      const mid = requireOk(await observe(ctx.runtime, ctx.cwd), 'observe before select all');
      await actFresh(ctx.runtime, ctx.cwd, { action: 'key', combo: 'cmd+a', frameId: mid.frameId, deliveryMode: 'foreground' });
      await sleep(200);
      const selected = requireOk(await observe(ctx.runtime, ctx.cwd), 'observe after select all');
      await typeIntoDocument(ctx, selected, second);
      const texts = await ocrText(ctx);
      const hasSecond = ocrHas(texts, second);
      const hasFirst = ocrHas(texts, first);
      return {
        passed: hasSecond === true && hasFirst === false,
        detail: texts === null ? 'OCR produced no text, so the result cannot be graded'
          : hasSecond !== true ? 'the replacement text is not on screen'
            : hasFirst ? 'the original text is still on screen — it was not replaced'
              : 'contents fully replaced',
        evidence: { hasSecond, hasFirst },
      };
    },
  },
  {
    id: 'multi-window-isolation',
    title: 'Two documents of one process each receive their own text',
    capability: 'multi-window',
    async run(ctx) {
      const markerA = ctx.marker(), markerB = ctx.marker();
      const docA = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      const windowA = docA.windowId;
      await typeIntoDocument(ctx, docA, markerA);

      const docB = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      const windowB = docB.windowId;
      await typeIntoDocument(ctx, docB, markerB);

      // Window B is frontmost, so OCR of the current window sees B's content only. The failure
      // this catches is cross-contamination: B showing A's text, or A's text never landing at all.
      const texts = await ocrText(ctx);
      const bHasOwn = ocrHas(texts, markerB);
      const bLeakedA = ocrHas(texts, markerA);
      return {
        passed: windowA !== windowB && bHasOwn === true && bLeakedA === false,
        detail: windowA === windowB ? 'both documents reported the same window id — no isolation to test'
          : texts === null ? 'OCR produced no text, so the result cannot be graded'
            : bLeakedA ? 'the second window shows the first window’s text'
              : bHasOwn ? 'each document received only its own text' : 'the second window does not show its own text',
        evidence: { windowA, windowB, bHasOwn, bLeakedA },
      };
    },
  },
  {
    id: 'stale-frame-recovery',
    title: 'Refuse a stale-frame action, then still complete the task',
    capability: 'recovery',
    async run(ctx) {
      const marker = ctx.marker();
      const docA = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      const editableA = editableIn(docA);
      const docB = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;

      // Act on window A's handle while window B is frontmost — must be refused.
      const stale = await ctx.runtime.run({
        action: 'type', text: 'BIMAX-SHOULD-NEVER-LAND', ...handleFor(editableA),
        frameId: docA.frameId, deliveryMode: 'foreground',
      }, { cwd: ctx.cwd });
      const refused = stale.ok === false;

      // The loop must remain usable after a refusal. A guard that bricks the agent is its own bug.
      const fresh = requireOk(await observe(ctx.runtime, ctx.cwd), 're-observe after refusal');
      await typeIntoDocument(ctx, fresh, marker);
      const texts = await ocrText(ctx);
      const recovered = ocrHas(texts, marker);
      const leaked = ocrHas(texts, 'BIMAX-SHOULD-NEVER-LAND');
      return {
        passed: refused && recovered === true && leaked === false,
        detail: !refused ? 'the stale-frame action was NOT refused'
          : leaked ? 'the refused text reached the screen anyway'
            : recovered === true ? 'refused the stale action and completed after re-observing'
              : 'refused correctly but could not complete afterwards',
        evidence: { refused, refusalReason: stale.error, recovered, leaked },
      };
    },
  },
  {
    id: 'absence-verification',
    title: 'Prove a string is absent from the window',
    capability: 'absence',
    async run(ctx) {
      const absent = `BIMAX-ABSENT-${Date.now()}`;
      const document = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      const probed = requireOk(await ctx.runtime.run({
        action: 'observe', query: absent, maxElements: 2000, frameId: document.frameId,
      }, { cwd: ctx.cwd }), 'exhaustive absence scan');
      const matched = probed.verification?.matched;
      return {
        passed: matched === false,
        detail: matched === false ? 'absence proven by exhaustive scan' : `verification reported matched=${matched}`,
        evidence: { verification: probed.verification },
      };
    },
  },
  {
    id: 'clipboard-roundtrip',
    title: 'Copy from one document and paste into another',
    capability: 'clipboard',
    async run(ctx) {
      const marker = ctx.marker();
      const source = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      await typeIntoDocument(ctx, source, marker);
      const filled = requireOk(await observe(ctx.runtime, ctx.cwd), 'observe source');
      await actFresh(ctx.runtime, ctx.cwd, { action: 'key', combo: 'cmd+a', frameId: filled.frameId, deliveryMode: 'foreground' });
      await sleep(150);
      const selected = requireOk(await observe(ctx.runtime, ctx.cwd), 'observe selection');
      await actFresh(ctx.runtime, ctx.cwd, { action: 'copy', frameId: selected.frameId, deliveryMode: 'foreground' });
      await sleep(250);

      const destination = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      const editable = editableIn(destination);
      if (editable) {
        await actFresh(ctx.runtime, ctx.cwd, {
          action: 'click', ...handleFor(editable), frameId: destination.frameId, deliveryMode: 'foreground',
        });
      }
      const ready = requireOk(await observe(ctx.runtime, ctx.cwd), 'observe destination');
      await actFresh(ctx.runtime, ctx.cwd, { action: 'paste', frameId: ready.frameId, deliveryMode: 'foreground' });
      await sleep(300);
      const pasted = ocrHas(await ocrText(ctx), marker);
      return {
        passed: pasted === true,
        detail: pasted === true ? 'clipboard round-tripped between documents'
          : pasted === null ? 'OCR produced no text, so the result cannot be graded'
            : 'the copied text did not appear in the destination document',
      };
    },
  },
  {
    id: 'window-layout',
    title: 'Place a window on the left half and report achieved geometry',
    capability: 'window',
    async run(ctx) {
      const document = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      const screen = ctx.display;
      const arranged = await actFresh(ctx.runtime, ctx.cwd, {
        action: 'arrange', layout: 'left', frameId: document.frameId, deliveryMode: 'foreground',
      });
      await sleep(500);
      // Graded on the window list, not on what the arrange call reported about itself.
      const achieved = await frontWindowBounds(ctx, document.windowId);
      if (!screen || !achieved) {
        return { passed: false, detail: 'could not read display or window geometry', evidence: { screen, achieved, error: arranged.error } };
      }
      // Applications enforce minimum sizes and the visible area excludes the menu bar and Dock, so
      // exact equality is the wrong bar. What must hold: flush to the left edge, below the menu bar,
      // and about half the display wide.
      // ±12% of half the display. A 40–60% band was the first attempt and it was too generous to
      // mean anything: a window left at its natural 603pt on a 1470pt display counted as "half".
      const half = screen.w / 2;
      const onLeft = achieved.x <= 20;
      const belowMenuBar = achieved.y >= 20;
      const roughlyHalf = Math.abs(achieved.w - half) <= half * 0.12;
      return {
        passed: onLeft && belowMenuBar && roughlyHalf,
        detail: `achieved ${achieved.w}×${achieved.h} at ${achieved.x},${achieved.y} on a ${screen.w}×${screen.h} display`,
        evidence: { onLeft, belowMenuBar, roughlyHalf, harnessReported: arranged.windowFrame },
      };
    },
  },
  {
    id: 'window-restore',
    title: 'Restore a window to its previous bounds after arranging it',
    capability: 'window',
    async run(ctx) {
      const document = await newDocument(ctx.runtime, ctx.cwd);
      ctx.createdDocuments++;
      const original = await frontWindowBounds(ctx, document.windowId);
      await actFresh(ctx.runtime, ctx.cwd, {
        action: 'arrange', layout: 'right', frameId: document.frameId, deliveryMode: 'foreground',
      });
      await sleep(500);
      const moved = await frontWindowBounds(ctx, document.windowId);
      await actFresh(ctx.runtime, ctx.cwd, { action: 'arrange', layout: 'restore', deliveryMode: 'foreground' });
      await sleep(500);
      const now = await frontWindowBounds(ctx, document.windowId);
      if (!original || !now) return { passed: false, detail: 'window geometry unavailable', evidence: { original, moved, now } };
      const actuallyMoved = !!moved && (Math.abs(moved.x - original.x) > 20 || Math.abs(moved.w - original.w) > 20);
      const restored = Math.abs(now.x - original.x) <= 8 && Math.abs(now.y - original.y) <= 8
        && Math.abs(now.w - original.w) <= 8 && Math.abs(now.h - original.h) <= 8;
      return {
        passed: actuallyMoved && restored,
        detail: !actuallyMoved ? 'the window never moved, so restore proves nothing'
          : restored ? 'window returned to its original rectangle'
            : `expected ~${original.w}×${original.h} at ${original.x},${original.y}, got ${now.w}×${now.h} at ${now.x},${now.y}`,
        evidence: { original, moved, now },
      };
    },
  },
];

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('the task benchmark is macOS-only');
  if (process.argv.includes('--list')) {
    process.stdout.write(`${JSON.stringify(TASKS.map(t => ({ id: t.id, capability: t.capability, title: t.title })), null, 2)}\n`);
    return;
  }
  const only = (argValue('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
  const selected = only.length ? TASKS.filter(task => only.includes(task.id)) : TASKS;
  if (!selected.length) throw new Error(`no tasks matched --only ${only.join(',')}`);

  const runtime = new BimaxComputerRuntime();
  const cwd = process.cwd();
  const results: Array<Record<string, unknown>> = [];
  let sequence = 0;
  let aborted = false;

  try {
    const status = requireOk(await runtime.run({ action: 'status' }, { cwd }), 'status');
    if (status.accessibility !== true || status.screenRecording !== true) {
      throw new Error(`permissions are not ready (Accessibility=${status.accessibility}, ScreenRecording=${status.screenRecording})`);
    }
    // Measure the display BEFORE owning a window: screenshot becomes window-scoped afterwards.
    const display = await measureDisplay(runtime, cwd);
    await openEditor(runtime, cwd);
    await assertNotBlocked(runtime, cwd);
    // Whatever is already open is the user's; the benchmark returns to exactly this count.
    const baseline = await countDocumentWindows(runtime, cwd);

    for (const task of selected) {
      const ctx: TaskContext = {
        runtime, cwd, createdDocuments: 0, display,
        marker: () => `BIMAX-T${String(++sequence).padStart(2, '0')}-${Date.now().toString(36).toUpperCase()}`,
      };
      const started = Date.now();
      let verdict: Verdict;
      try {
        // A dialog inherited from the previous task makes every later result meaningless, so the
        // precondition is checked per task rather than once at startup.
        await assertNotBlocked(runtime, cwd, `before ${task.id}`);
        verdict = await task.run(ctx);
      } catch (error) {
        verdict = { passed: false, detail: `threw: ${error instanceof Error ? error.message : String(error)}` };
      }
      const durationMs = Date.now() - started;

      // Return to the baseline window count. Verified by counting, never by whether a sheet happens
      // to be visible — that check reported success while eleven documents piled up behind it.
      const cleanup = await restoreWindowBaseline(runtime, cwd, baseline);

      results.push({
        id: task.id, capability: task.capability, title: task.title,
        passed: verdict.passed, detail: verdict.detail, evidence: verdict.evidence,
        durationMs, documentsCreated: ctx.createdDocuments,
        cleanup: { ok: cleanup.ok, windowsNow: cleanup.count, baseline, steps: cleanup.steps },
      });
      process.stderr.write(`${verdict.passed ? 'PASS' : 'FAIL'}  ${task.id}  (${durationMs} ms)  ${verdict.detail}\n`);
      if (!cleanup.ok) {
        process.stderr.write(`  ABORT: cleanup could not return to ${baseline} document window(s) `
          + `(now ${cleanup.count}). Stopping before this compounds; clear TextEdit and re-run.\n`);
        aborted = true;
        break;
      }
    }

    const passed = results.filter(entry => entry.passed).length;
    const byCapability: Record<string, { passed: number; total: number }> = {};
    for (const entry of results) {
      const key = String(entry.capability);
      byCapability[key] ||= { passed: 0, total: 0 };
      byCapability[key].total++;
      if (entry.passed) byCapability[key].passed++;
    }
    const durations = results.map(entry => Number(entry.durationMs)).sort((a, b) => a - b);
    process.stdout.write(`${JSON.stringify({
      ok: !aborted && passed === results.length && results.length === selected.length,
      aborted,
      baselineWindows: baseline,
      measures: 'harness task completion with a deterministic planner — a capability floor, not model performance',
      scoredAgainst: 'ground truth re-read independently (fresh observation, achieved geometry, OCR), never the harness actionResult',
      passed, attempted: results.length, selected: selected.length,
      passRate: results.length ? Number((passed / results.length).toFixed(3)) : 0,
      byCapability,
      durationMs: { p50: durations[Math.floor(durations.length * 0.5)] ?? null, worst: durations[durations.length - 1] ?? null },
      results,
    }, null, 2)}\n`);
    if (aborted || passed !== results.length) process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
