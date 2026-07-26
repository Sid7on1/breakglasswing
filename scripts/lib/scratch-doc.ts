/**
 * Disposable text-editing surface for live verification scripts.
 *
 * BENCHMARK SCAFFOLDING, not product code. The runtime stays app-agnostic; a live test still has to
 * type into something real, and a plain text editor is the cheapest surface present on every macOS
 * machine. Nothing here leaks into the harness.
 *
 * ── The rule this file exists to enforce ────────────────────────────────────────────────────────
 * A script that drives the real desktop must leave it clean and must PROVE it left it clean, using
 * evidence independent of the thing it just did.
 *
 * That rule was learned three times in one session, the last time expensively. Cleanup asked "is a
 * save sheet visible?" and treated "no" as success. When a dialog already held focus, cmd+w did
 * nothing, no NEW sheet appeared, and cleanup reported `closed: directly` having closed nothing.
 * Eight tasks each added documents on top of that, and the run ended with eleven unsaved documents
 * and a modal dialog stacked on the user's screen — while every cleanup step had reported success.
 *
 * So: closing a document is verified by COUNTING WINDOWS before and after. A count that did not
 * drop is a failed close, whatever the screen looks like.
 */
import { BimaxComputerRuntime, DesktopCommand, DesktopResult } from '../../src/computer/desktop.runtime';

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const EDITOR_APP = 'TextEdit';
export const EDITOR_BUNDLE_ID = 'com.apple.TextEdit';

const DISCARD_LABEL = /^(?:don['’]t save|delete|discard)$/i;
const EDITABLE_ROLES = ['AXTextArea', 'AXTextField'];

export function requireOk(result: DesktopResult, step: string): DesktopResult {
  if (!result.ok) throw new Error(`${step}: ${result.error || result.summary}`);
  return result;
}

/** Prefer the most stable handle the observation offered: token, then index, then label. */
export function handleFor(element: any): Partial<DesktopCommand> {
  if (element?.element_token) return { elementToken: String(element.element_token) };
  if (element?.element_index != null) return { elementIndex: Number(element.element_index) };
  if (element?.label) return { query: String(element.label) };
  return {};
}

export function editableIn(result: DesktopResult): any {
  return (result.elements as any[] || []).find(element => EDITABLE_ROLES.includes(String(element?.role || '')));
}

export function discardButtonIn(result: DesktopResult): any {
  return (result.elements as any[] || []).find(element =>
    element?.role === 'AXButton' && DISCARD_LABEL.test(String(element?.label || '').trim()));
}

export function sheetPresent(result: DesktopResult): boolean {
  return (result.elements as any[] || []).some(element => String(element?.role) === 'AXSheet')
    || !!discardButtonIn(result);
}

/** Retry once against a fresh frame when a real AX event legitimately superseded ours. */
export async function actFresh(
  runtime: BimaxComputerRuntime, cwd: string, command: DesktopCommand,
): Promise<DesktopResult> {
  let result = await runtime.run(command, { cwd });
  if (!result.ok && /changed after (?:the )?screenshot|accessibility state changed|stale frame/i.test(result.error || '')) {
    const observed = await runtime.run({ action: 'observe', maxElements: 500 }, { cwd });
    if (observed.ok) result = await runtime.run({ ...command, frameId: observed.frameId }, { cwd });
  }
  return result;
}

export async function observe(runtime: BimaxComputerRuntime, cwd: string, query?: string): Promise<DesktopResult> {
  return runtime.run({ action: 'observe', maxElements: 500, ...(query ? { query } : {}) }, { cwd });
}

export async function openEditor(runtime: BimaxComputerRuntime, cwd: string): Promise<DesktopResult> {
  const opened = requireOk(await runtime.run({
    action: 'open', app: EDITOR_APP, bundleId: EDITOR_BUNDLE_ID, deliveryMode: 'foreground',
  }, { cwd }), 'open editor');
  await sleep(250);
  return opened;
}

/** Document windows currently on screen — the ground truth every cleanup claim is checked against. */
export async function countDocumentWindows(runtime: BimaxComputerRuntime, cwd: string): Promise<number> {
  const listed = await runtime.run({ action: 'windows', app: EDITOR_APP }, { cwd });
  const windows = ((listed.details as any)?.windows || []) as any[];
  return windows.filter(window => window?.is_on_screen !== false
    && Number(window?.bounds?.width || 0) > 200 && Number(window?.bounds?.height || 0) > 200).length;
}

/** Refuse to proceed while a modal dialog owns the application. */
export async function assertNotBlocked(runtime: BimaxComputerRuntime, cwd: string, when = 'starting'): Promise<void> {
  const state = await observe(runtime, cwd);
  if (state.ok && sheetPresent(state)) {
    throw new Error(`${EDITOR_APP} is blocked by a modal dialog (${when}). Dismiss it and re-run — `
      + 'every task would otherwise fail for that one reason and the results would mean nothing.');
  }
}

/** Empty the front document so it can close without ever raising a save sheet. */
export async function clearFrontDocument(runtime: BimaxComputerRuntime, cwd: string): Promise<void> {
  const before = await observe(runtime, cwd);
  if (!before.ok) return;
  const editable = editableIn(before);
  if (!editable) return;
  await actFresh(runtime, cwd, {
    action: 'click', ...handleFor(editable), frameId: before.frameId, deliveryMode: 'foreground',
  });
  const focused = await observe(runtime, cwd);
  if (!focused.ok) return;
  await actFresh(runtime, cwd, { action: 'key', combo: 'cmd+a', frameId: focused.frameId, deliveryMode: 'foreground' });
  await sleep(120);
  const selected = await observe(runtime, cwd);
  if (!selected.ok) return;
  await actFresh(runtime, cwd, { action: 'key', combo: 'delete', frameId: selected.frameId, deliveryMode: 'foreground' });
  await sleep(200);
}

export interface CloseOutcome {
  closed: boolean;
  windowsBefore: number;
  windowsAfter: number;
  via: string;
  manualCleanupRequired: boolean;
}

/**
 * Close the front document, verified by the window count dropping. An empty untitled document
 * closes silently, so the document is cleared first and the save-sheet paths below are a fallback
 * that should rarely run.
 */
export async function closeFrontDocument(runtime: BimaxComputerRuntime, cwd: string): Promise<CloseOutcome> {
  const windowsBefore = await countDocumentWindows(runtime, cwd);
  const settle = async (via: string): Promise<CloseOutcome | null> => {
    await sleep(500);
    const windowsAfter = await countDocumentWindows(runtime, cwd);
    return windowsAfter < windowsBefore
      ? { closed: true, windowsBefore, windowsAfter, via, manualCleanupRequired: false }
      : null;
  };

  await clearFrontDocument(runtime, cwd);
  const start = await observe(runtime, cwd);
  if (start.ok) {
    await actFresh(runtime, cwd, { action: 'key', combo: 'cmd+w', frameId: start.frameId, deliveryMode: 'foreground' });
  }
  const quiet = await settle('cleared then cmd+w');
  if (quiet) return quiet;

  // A sheet appeared anyway. cmd+Delete is the standard "Don't Save" accelerator and needs no click
  // geometry, which is the part that has been unreliable against an animating sheet.
  const sheeted = await observe(runtime, cwd);
  if (sheeted.ok && sheetPresent(sheeted)) {
    await actFresh(runtime, cwd, { action: 'key', combo: 'cmd+delete', frameId: sheeted.frameId, deliveryMode: 'foreground' });
    const viaKey = await settle('cmd+delete');
    if (viaKey) return viaKey;

    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await observe(runtime, cwd);
      const button = fresh.ok ? discardButtonIn(fresh) : null;
      if (!button) break;
      await actFresh(runtime, cwd, {
        action: 'click', ...handleFor(button), frameId: fresh.frameId, deliveryMode: 'foreground',
      });
      const viaClick = await settle(`discard button (attempt ${attempt + 1})`);
      if (viaClick) return viaClick;
    }

    // Escape is Cancel: it unblocks the app but LEAVES THE DOCUMENT OPEN. Not a clean exit, and
    // reporting it as one is precisely how eleven documents accumulated unnoticed.
    const stuck = await observe(runtime, cwd);
    if (stuck.ok) {
      await runtime.run({ action: 'key', combo: 'escape', frameId: stuck.frameId, deliveryMode: 'foreground' }, { cwd });
      await sleep(400);
    }
  }

  const windowsAfter = await countDocumentWindows(runtime, cwd);
  return {
    closed: windowsAfter < windowsBefore,
    windowsBefore, windowsAfter,
    via: 'failed — document left open',
    manualCleanupRequired: windowsAfter >= windowsBefore,
  };
}

/** Create a fresh document and confirm a window actually appeared. */
export async function newDocument(runtime: BimaxComputerRuntime, cwd: string): Promise<DesktopResult> {
  const before = requireOk(await observe(runtime, cwd), 'observe before new document');
  const countBefore = await countDocumentWindows(runtime, cwd);
  requireOk(await actFresh(runtime, cwd, {
    action: 'key', combo: 'cmd+n', frameId: before.frameId, deliveryMode: 'foreground',
  }), 'create document');
  await sleep(450);
  const countAfter = await countDocumentWindows(runtime, cwd);
  if (countAfter <= countBefore) {
    throw new Error(`cmd+n did not produce a new window (${countBefore} → ${countAfter}); the application is probably blocked`);
  }
  return requireOk(await observe(runtime, cwd), 'observe new document');
}

/**
 * Bring the editor back to a known number of open documents. Returns a failure the moment a close
 * stops making progress, so a caller can abort the whole run instead of piling up more state.
 */
export async function restoreWindowBaseline(
  runtime: BimaxComputerRuntime, cwd: string, baseline: number,
): Promise<{ ok: boolean; count: number; steps: CloseOutcome[] }> {
  const steps: CloseOutcome[] = [];
  let count = await countDocumentWindows(runtime, cwd);
  while (count > baseline && steps.length < 8) {
    const outcome = await closeFrontDocument(runtime, cwd);
    steps.push(outcome);
    if (!outcome.closed) return { ok: false, count: outcome.windowsAfter, steps };
    count = outcome.windowsAfter;
  }
  return { ok: count <= baseline, count, steps };
}
