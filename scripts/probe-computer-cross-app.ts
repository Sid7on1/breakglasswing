/**
 * Cross-application perception probe.
 *
 * The receipt gate proves one app (TextEdit). This measures the perception layer across several
 * very different accessibility implementations, and exercises the one case the exact-window
 * preflight was actually built for: two windows of the SAME process, where proving the pid is not
 * enough.
 *
 * Safety contract: only TextEdit is ever typed into, and only in windows this script created and
 * discards. Every other application is observed read-only — no clicks, no keystrokes, no state
 * change. No application is ever quit.
 *
 * Usage:
 *   npx tsx scripts/probe-computer-cross-app.ts
 *   npx tsx scripts/probe-computer-cross-app.ts --apps TextEdit,Notes,Calculator
 *   npx tsx scripts/probe-computer-cross-app.ts --skip-multiwindow
 */
import { BimaxComputerRuntime, DesktopCommand, DesktopResult } from '../src/computer/desktop.runtime';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const DEFAULT_APPS = ['TextEdit', 'Notes', 'Calculator', 'Maps', 'WhatsApp'];

/** An absent query is what forces the ambiguity path; no real label can accidentally satisfy it. */
const ABSENT_QUERY = '__bimax_absent_visual_probe__';

interface AppProfile {
  app: string;
  ok: boolean;
  error?: string;
  pid?: number;
  windowId?: number;
  frameId?: string;
  scanned?: number;
  visible?: number;
  degraded?: boolean;
  roles?: Record<string, number>;
  observeMs?: number;
  axObserverActive?: boolean;
  axEpoch?: number;
  foveated?: unknown;
  /** Read-only resolver probes: does a plausible label resolve, and with what confidence/margin. */
  targeting?: Array<{ query: string; matched: boolean; confidence?: string; margin?: number; label?: string; role?: string }>;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireOk(result: DesktopResult, step: string): DesktopResult {
  if (!result.ok) throw new Error(`${step}: ${result.error || result.summary}`);
  return result;
}

function handleFor(element: any): Partial<DesktopCommand> {
  if (element?.element_token) return { elementToken: String(element.element_token) };
  if (element?.element_index != null) return { elementIndex: Number(element.element_index) };
  if (element?.label) return { query: String(element.label) };
  return {};
}

function editableIn(result: DesktopResult): any {
  return (result.elements as any[] || []).find(element =>
    ['AXTextArea', 'AXTextField'].includes(String(element?.role || '')));
}

function roleHistogram(result: DesktopResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const element of (result.elements as any[] || [])) {
    const role = String(element?.role || 'unknown');
    counts[role] = (counts[role] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8));
}

/** Retry once against a fresh frame when a real AX event legitimately superseded ours. */
async function actFresh(runtime: BimaxComputerRuntime, command: DesktopCommand, cwd: string): Promise<DesktopResult> {
  let result = await runtime.run(command, { cwd });
  if (!result.ok && /changed after (?:the )?screenshot|accessibility state changed/i.test(result.error || '')) {
    const observed = requireOk(await runtime.run({ action: 'observe', maxElements: 500 }, { cwd }), 'refresh after AX event');
    result = await runtime.run({ ...command, frameId: observed.frameId }, { cwd });
  }
  return result;
}

/** Close a TextEdit document this script created, discarding content if macOS asks. */
async function discardDocument(runtime: BimaxComputerRuntime, cwd: string, frameId?: string): Promise<void> {
  const closed = await actFresh(runtime, { action: 'key', combo: 'cmd+w', frameId, deliveryMode: 'foreground' }, cwd);
  await sleep(200);
  const state = closed.elements?.length ? closed : await runtime.run({ action: 'observe', maxElements: 500 }, { cwd });
  const discard = (state.elements as any[] || []).find(element =>
    element?.role === 'AXButton' && /^(?:don['’]t save|delete|discard)$/i.test(String(element?.label || '').trim()));
  if (discard) {
    await actFresh(runtime, { action: 'click', ...handleFor(discard), frameId: state.frameId, deliveryMode: 'foreground' }, cwd);
    await sleep(200);
  }
}

/** Read-only perception profile. Observation only — this never sends input to the app. */
async function profileApp(runtime: BimaxComputerRuntime, cwd: string, app: string): Promise<AppProfile> {
  const profile: AppProfile = { app, ok: false };
  try {
    const opened = await runtime.run({ action: 'open', app, deliveryMode: 'foreground' }, { cwd });
    if (!opened.ok) return { ...profile, error: `open failed: ${opened.error || opened.summary}` };
    await sleep(600); // let the app settle before judging its tree

    const started = Date.now();
    const observed = await runtime.run({ action: 'observe', maxElements: 500 }, { cwd });
    const observeMs = Date.now() - started;
    if (!observed.ok) return { ...profile, error: `observe failed: ${observed.error || observed.summary}`, observeMs };

    const perception = (observed.details as any)?.perception || {};
    profile.pid = observed.pid;
    profile.windowId = observed.windowId;
    profile.frameId = observed.frameId;
    profile.scanned = perception.scanned;
    profile.visible = perception.visible;
    profile.degraded = observed.degraded;
    profile.roles = roleHistogram(observed);
    profile.observeMs = observeMs;
    profile.axObserverActive = perception.accessibilityObserver?.active;
    profile.axEpoch = perception.accessibilityObserver?.epoch;

    // Force the ambiguity path so we can see whether Vision fires for THIS app's tree, and whether
    // it produces shape evidence (unlabeled icon controls) or only OCR text.
    const probe = await runtime.run({ action: 'observe', query: ABSENT_QUERY, maxElements: 500 }, { cwd });
    profile.foveated = (probe.details as any)?.perception?.foveated ?? { error: probe.error };

    // Resolver probes. `observe` with a query is read-only: it reports what WOULD be targeted.
    const candidates = (observed.elements as any[] || [])
      .filter(element => element?.label && ['AXButton', 'AXTextArea', 'AXTextField', 'AXCheckBox', 'AXPopUpButton'].includes(String(element.role)))
      .slice(0, 3);
    profile.targeting = [];
    for (const candidate of candidates) {
      const query = String(candidate.label);
      const resolved = await runtime.run({ action: 'observe', query, maxElements: 500 }, { cwd });
      profile.targeting.push({
        query,
        matched: resolved.verification?.matched === true,
        confidence: resolved.targeting?.confidence,
        margin: resolved.targeting?.margin,
        label: resolved.targeting?.label,
        role: resolved.targeting?.role,
      });
    }

    profile.ok = true;
    return profile;
  } catch (error) {
    return { ...profile, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The case the handoff calls critical: two windows, one process. A frame planned against window A
 * must not deliver input once window B of the same app is on top. A pid-only check passes here —
 * which is exactly why it was insufficient.
 */
async function multiWindowRefusal(runtime: BimaxComputerRuntime, cwd: string): Promise<Record<string, unknown>> {
  const evidence: Record<string, unknown> = {};
  let windowsCreated = 0;
  try {
    requireOk(await runtime.run({
      action: 'open', app: 'TextEdit', bundleId: 'com.apple.TextEdit', deliveryMode: 'foreground',
    }, { cwd }), 'open TextEdit');
    await sleep(250);

    const base = requireOk(await runtime.run({ action: 'observe', maxElements: 300 }, { cwd }), 'observe TextEdit');
    requireOk(await actFresh(runtime, { action: 'key', combo: 'cmd+n', frameId: base.frameId, deliveryMode: 'foreground' }, cwd), 'create window A');
    windowsCreated++;
    await sleep(400);

    const frameA = requireOk(await runtime.run({ action: 'observe', maxElements: 500 }, { cwd }), 'observe window A');
    const editorA = editableIn(frameA);
    if (!editorA) throw new Error('window A exposed no editable field');
    evidence.windowA = { windowId: frameA.windowId, frameId: frameA.frameId, pid: frameA.pid };

    // Second document of the SAME process, now frontmost.
    requireOk(await actFresh(runtime, { action: 'key', combo: 'cmd+n', frameId: frameA.frameId, deliveryMode: 'foreground' }, cwd), 'create window B');
    windowsCreated++;
    await sleep(500);

    const frameB = requireOk(await runtime.run({ action: 'observe', maxElements: 500 }, { cwd }), 'observe window B');
    evidence.windowB = { windowId: frameB.windowId, frameId: frameB.frameId, pid: frameB.pid };
    evidence.distinctWindows = frameA.windowId !== frameB.windowId;
    evidence.sameProcess = frameA.pid === frameB.pid;

    // THE ASSERTION: act on window A's stale handle while window B is frontmost.
    const stale = await runtime.run({
      action: 'type', text: 'BIMAX-SHOULD-NEVER-LAND', ...handleFor(editorA),
      frameId: frameA.frameId, deliveryMode: 'foreground',
    }, { cwd });
    evidence.staleAttempt = {
      refused: stale.ok === false,
      error: stale.error,
      receipt: stale.actionReceipt,
      summary: stale.ok ? stale.summary : undefined,
    };

    // The harness must still be usable afterwards: a fresh observation should target window B and
    // deliver a proven receipt. A refusal that bricks the loop would be its own failure.
    const marker = `BIMAX-XAPP-${Date.now()}`;
    const freshB = requireOk(await runtime.run({ action: 'observe', maxElements: 500 }, { cwd }), 're-observe window B');
    const editorB = editableIn(freshB);
    if (!editorB) throw new Error('window B exposed no editable field');
    const typed = await actFresh(runtime, {
      action: 'type', text: marker, ...handleFor(editorB), frameId: freshB.frameId, deliveryMode: 'foreground',
    }, cwd);
    const keyboardReceipt = (typed.details as any)?.keyboardReceipt;
    const before = Number(keyboardReceipt?.before?.valueLength);
    const after = Number(keyboardReceipt?.after?.valueLength);
    evidence.recoveredDelivery = {
      ok: typed.ok,
      error: typed.error,
      targetWindow: typed.actionReceipt?.target.windowId,
      windowMatched: typed.actionReceipt?.preflight.windowMatched,
      confidence: typed.actionResult?.confidence,
      exactValueLengthDelta: Number.isFinite(before) && Number.isFinite(after) ? after - before : null,
      expectedDelta: marker.length,
      sameElement: keyboardReceipt?.sameElement,
    };

    evidence.ok = evidence.distinctWindows === true
      && (evidence.staleAttempt as any).refused === true
      && (evidence.recoveredDelivery as any).ok === true
      && (evidence.recoveredDelivery as any).exactValueLengthDelta === marker.length;
    return evidence;
  } catch (error) {
    evidence.ok = false;
    evidence.error = error instanceof Error ? error.message : String(error);
    return evidence;
  } finally {
    for (let i = 0; i < windowsCreated; i++) {
      try {
        const fresh = await runtime.run({ action: 'observe', maxElements: 500 }, { cwd });
        if (!fresh.ok) break;
        await discardDocument(runtime, cwd, fresh.frameId);
      } catch { /* cleanup is best-effort; the reported failure stays the actionable one */ }
    }
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('cross-app probe is macOS-only');
  const runtime = new BimaxComputerRuntime();
  const cwd = process.cwd();
  const apps = (argValue('--apps') || DEFAULT_APPS.join(',')).split(',').map(name => name.trim()).filter(Boolean);
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() };

  try {
    const status = requireOk(await runtime.run({ action: 'status' }, { cwd }), 'status');
    if (status.accessibility !== true || status.screenRecording !== true) {
      throw new Error(`permissions are not ready (Accessibility=${status.accessibility}, ScreenRecording=${status.screenRecording})`);
    }
    report.permissions = { accessibility: true, screenRecording: true };

    const profiles: AppProfile[] = [];
    for (const app of apps) profiles.push(await profileApp(runtime, cwd, app));
    report.profiles = profiles;

    report.multiWindow = process.argv.includes('--skip-multiwindow')
      ? { skipped: true }
      : await multiWindowRefusal(runtime, cwd);

    const profilesOk = profiles.filter(profile => profile.ok).length;
    report.summary = {
      appsProbed: profiles.length,
      appsProfiled: profilesOk,
      shapeEvidenceSeen: profiles.some(profile => Number((profile.foveated as any)?.shapeRegions) > 0),
      multiWindowOk: (report.multiWindow as any)?.ok ?? null,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await runtime.dispose();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
