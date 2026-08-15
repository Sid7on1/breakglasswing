/**
 * Comprehensive live smoke for EVERY ComputerTool action, driven through the exact
 * BimaxComputerRuntime the model uses. Self-contained: builds its own disposable file-browser fixture in
 * the system temp directory, moves the REAL mouse/keyboard, verifies effects from screenshots and
 * the filesystem, and prints a per-action JSON report.
 *
 * Every public action is accounted for. Safe actions are exercised live against a disposable file
 * browser fixture. Actions that would inspect/overwrite the user's clipboard, edit arbitrary app
 * state, record the screen, or terminate an app are explicitly reported as contract-tested only.
 *
 * Usage: tsx scripts/smoke-computer-all.ts   (npm run test:computer:all)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  BimaxComputerRuntime,
  DesktopCommand,
  DesktopResult,
  PUBLIC_DESKTOP_ACTIONS,
  PublicDesktopAction,
} from '../../src/capabilities/mac/desktop.runtime';

type Report = { action: string; ok: boolean; required: boolean; note: string };
const report: Report[] = [];
const coveredActions = new Set<PublicDesktopAction>();
const execFileAsync = promisify(execFile);

const COMPOUND_ACTIONS: Readonly<Record<string, readonly PublicDesktopAction[]>> = {
  'key+type (Go to Folder)': ['key', 'type'],
  'click (single)': ['click'],
  'click (double → open folder)': ['click'],
  'click (right → full-display menu evidence)': ['click'],
  'click (cmd modifier)': ['click'],
  'drag (filesystem-verified)': ['drag'],
  'mouse_down + mouse_up': ['mouse_down', 'mouse_up'],
  'record_start/record_stop': ['record_start', 'record_stop'],
  'copy/paste/clipboard': ['copy', 'paste', 'clipboard'],
};

function markCovered(label: string): void {
  const compound = COMPOUND_ACTIONS[label];
  if (compound) {
    compound.forEach(action => coveredActions.add(action));
    return;
  }
  if ((PUBLIC_DESKTOP_ACTIONS as readonly string[]).includes(label)) {
    coveredActions.add(label as PublicDesktopAction);
    return;
  }
  throw new Error(`smoke report label has no public-action mapping: ${label}`);
}

function ok(result: DesktopResult): DesktopResult {
  if (!result.ok) throw new Error(result.error || result.summary);
  return result;
}

function physical(result: DesktopResult): void {
  if ((result.details as any)?.path !== 'native-global-cgevent') {
    throw new Error('action did not use the visible native cursor');
  }
}

function elementPoint(result: DesktopResult, label: string): { x: number; y: number } {
  const element = (result.elements || []).find((candidate: any) =>
    String(candidate?.label || candidate?.value || '').trim() === label && candidate?.frame,
  ) as any;
  if (!element?.frame) {
    const labels = (result.elements || []).map((candidate: any) => candidate?.label).filter(Boolean).slice(0, 30);
    throw new Error(`no visible frame for ${label}; visible labels: ${labels.join(', ')}`);
  }
  return {
    x: Math.round(Number(element.frame.x) + Number(element.frame.w) / 2),
    y: Math.round(Number(element.frame.y) + Number(element.frame.h) / 2),
  };
}

async function step(action: string, required: boolean, run: () => Promise<string>): Promise<boolean> {
  markCovered(action);
  try {
    const note = await run();
    report.push({ action, ok: true, required, note });
    return true;
  } catch (error) {
    report.push({ action, ok: false, required, note: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function skip(action: string, reason: string): void {
  markCovered(action);
  report.push({ action, ok: true, required: false, note: `SKIPPED — ${reason}` });
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('computer-use smoke is macOS-only');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-smoke-all-'));
  for (const dir of ['DoubleClickFolder', 'DropTarget']) fs.mkdirSync(path.join(fixture, dir));
  for (const file of ['alpha-drag.txt', 'primary.txt', 'second.txt', 'hover-target.txt']) {
    fs.writeFileSync(path.join(fixture, file), `bimax smoke ${file}\n`);
  }

  const runtime = new BimaxComputerRuntime();
  let pid = 0;
  let fixtureApp = '';
  let fixtureWindowId = 0;

  // A physical action can be safely retried only when the runtime explicitly refused it before
  // delivery. Refreshing focus + observation handles ordinary AX invalidation and another app
  // briefly taking focus, while never replaying an action that may already have reached the OS.
  const runFresh = async (command: DesktopCommand): Promise<DesktopResult> => {
    let result = await runtime.run(command);
    if (result.ok) return result;
    const message = `${result.error || ''} ${result.summary || ''}`;
    const refusedBeforeDelivery = /accessibility state changed|fresh screenshot[^.]*required|is on top of|not (?:the )?frontmost/i.test(message)
      && (result.actionReceipt as any)?.commit?.delivered !== true
      && result.actionResult?.delivered !== true;
    if (!refusedBeforeDelivery || !pid) return result;
    const focused = await runtime.run({ action: 'focus', pid });
    if (!focused.ok) return result;
    const observed = await runtime.run({ action: 'observe', maxElements: 600 });
    if (!observed.ok) return result;
    result = await runtime.run(command);
    return result;
  };

  try {
    await step('status', true, async () => {
      const st = ok(await runtime.run({ action: 'status' }));
      return st.summary;
    });
    await step('request_access', true, async () => ok(await runtime.run({ action: 'request_access' })).summary);
    await step('desktop', true, async () => {
      const desktop = ok(await runtime.run({ action: 'desktop' }));
      return desktop.summary;
    });
    await step('open', true, async () => {
      // Let Launch Services choose the installed handler for a folder, then discover its live name.
      // This keeps the smoke adapter app-agnostic as well as the product runtime itself.
      const before = ok(await runtime.run({ action: 'frontmost' })).app || '';
      await execFileAsync('/usr/bin/open', [fixture]);
      for (let attempt = 0; attempt < 30; attempt++) {
        const current = ok(await runtime.run({ action: 'frontmost' })).app || '';
        if (current && (!before || current.toLocaleLowerCase() !== before.toLocaleLowerCase())) {
          fixtureApp = current;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      fixtureApp ||= ok(await runtime.run({ action: 'frontmost' })).app || before;
      if (!fixtureApp) throw new Error('could not discover the application handling the fixture folder');
      const running = ok(await runtime.run({ action: 'apps' }));
      const appEntries = Array.isArray((running.details as any)?.apps) ? (running.details as any).apps : [];
      const handler = appEntries.find((entry: any) => String(entry?.name || '').toLocaleLowerCase() === fixtureApp.toLocaleLowerCase());
      const handlerPid = Number(handler?.pid || handler?.process_id || 0);
      if (!handlerPid) throw new Error(`could not resolve the live process for ${fixtureApp}`);
      const fixtureName = path.basename(fixture);
      let visibleTitles: string[] = [];
      for (let attempt = 0; attempt < 30 && !fixtureWindowId; attempt++) {
        const listed = ok(await runtime.run({ action: 'windows', pid: handlerPid }));
        const windows = Array.isArray((listed.details as any)?.windows) ? (listed.details as any).windows : [];
        visibleTitles = windows.map((window: any) => String(window?.title || window?.name || '')).filter(Boolean);
        const fixtureWindow = windows.find((window: any) =>
          String(window?.title || window?.name || '').toLocaleLowerCase().includes(fixtureName.toLocaleLowerCase()));
        fixtureWindowId = Number(fixtureWindow?.window_id || 0);
        if (!fixtureWindowId) await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!fixtureWindowId) {
        throw new Error(`the folder handler exposed no window titled ${fixtureName}; visible titles: ${visibleTitles.join(', ')}`);
      }
      const opened = ok(await runtime.run({ action: 'open', app: fixtureApp, windowId: fixtureWindowId }));
      pid = opened.pid || 0;
      fixtureWindowId = opened.windowId || fixtureWindowId;
      if (!opened.screenshot) throw new Error('open produced no screenshot evidence');
      return `${fixtureApp} pid ${pid}, window ${opened.windowId}, fresh screenshot`;
    });
    await step('focus', true, async () => {
      const focused = ok(await runtime.run({ action: 'focus', pid }));
      fixtureWindowId = focused.windowId || fixtureWindowId;
      if (!focused.screenshot) throw new Error('focus produced no fresh screenshot evidence');
      return `focused the registered fixture process ${pid}`;
    });
    await step('apps', true, async () => {
      const apps = ok(await runtime.run({ action: 'apps' }));
      const found = JSON.stringify(apps.details || '').toLocaleLowerCase().includes(fixtureApp.toLocaleLowerCase());
      if (!found) throw new Error(`running apps did not list the discovered fixture handler ${fixtureApp}`);
      return `apps listed; ${fixtureApp} present`;
    });
    await step('windows', true, async () => {
      const windows = ok(await runtime.run({ action: 'windows', pid }));
      return `windows enumerated for pid ${pid}`;
    });
    await step('arrange', true, async () => {
      const before = ok(await runtime.run({ action: 'windows', pid }));
      const windows = Array.isArray((before.details as any)?.windows) ? (before.details as any).windows : [];
      const original = windows.find((window: any) => Number(window?.window_id) === fixtureWindowId)?.bounds;
      if (!original) throw new Error('no restorable window bounds were available');
      const centered = ok(await runFresh({ action: 'arrange', layout: 'center' }));
      fixtureWindowId = centered.windowId || fixtureWindowId;
      const restored = ok(await runFresh({
        action: 'arrange',
        bounds: { x: original.x, y: original.y, w: original.width, h: original.height },
      }));
      fixtureWindowId = restored.windowId || fixtureWindowId;
      return 'window arrangement changed and original bounds were restored';
    });
    await step('key+type (Go to Folder)', true, async () => {
      ok(await runFresh({ action: 'key', combo: 'cmd+shift+g' }));
      ok(await runtime.run({ action: 'observe', maxElements: 600 }));
      ok(await runFresh({ action: 'type', text: fixture }));
      ok(await runtime.run({ action: 'observe', maxElements: 600 }));
      ok(await runFresh({ action: 'key', combo: 'enter' }));
      const screen = ok(await runtime.run({ action: 'observe', query: 'DoubleClickFolder', maxElements: 600 }));
      if (!screen.verification?.matched) throw new Error('fixture did not appear after Go to Folder');
      return 'navigated to disposable fixture via cmd+shift+g / type / enter';
    });
    await step('observe', true, async () => {
      const screen = ok(await runtime.run({ action: 'observe', query: 'primary.txt', maxElements: 600 }));
      if (!screen.verification?.matched || !screen.screenshot) throw new Error('observe missing verification or screenshot');
      return `verification matched; ${screen.width}x${screen.height} PNG + ${screen.elements?.length || 0} elements`;
    });
    await step('screenshot', true, async () => {
      const shot = ok(await runtime.run({ action: 'screenshot' }));
      if (!shot.screenshot || !fs.existsSync(shot.screenshot)) throw new Error('no screenshot file on disk');
      return `window PNG at ${shot.screenshot}`;
    });
    await step('frontmost', true, async () => {
      const front = ok(await runtime.run({ action: 'frontmost' }));
      if ((front.app || '').toLocaleLowerCase() !== fixtureApp.toLocaleLowerCase()) {
        throw new Error(`frontmost is ${front.app}, not the fixture handler ${fixtureApp}`);
      }
      return `frontmost app: ${front.app}`;
    });
    await step('cursor', true, async () => {
      const cursor = ok(await runtime.run({ action: 'cursor' }));
      if (cursor.x == null || cursor.y == null) throw new Error('cursor position unavailable');
      return `cursor at ${cursor.x},${cursor.y}`;
    });
    await step('move', true, async () => {
      const windows = ok(await runtime.run({ action: 'windows', pid }));
      const bounds = (Array.isArray((windows.details as any)?.windows) ? (windows.details as any).windows : [])
        .map((w: any) => w?.bounds).find((b: any) => Number(b?.width) > 200);
      if (!bounds) throw new Error('no window bounds to aim at');
      const cx = Math.round(Number(bounds.x || 0) + Number(bounds.width) / 2);
      const cy = Math.round(Number(bounds.y || 0) + Number(bounds.height) / 2);
      ok(await runtime.run({ action: 'move', x: cx, y: cy }));
      const cursor = ok(await runtime.run({ action: 'cursor' }));
      if (Math.hypot(Number(cursor.x) - cx, Number(cursor.y) - cy) > 4) {
        throw new Error(`move landed at ${cursor.x},${cursor.y}, wanted ${cx},${cy}`);
      }
      return `real cursor moved to window centre ${cx},${cy} (verified)`;
    });
    await step('click (single)', true, async () => {
      await runtime.run({ action: 'observe', query: 'primary.txt', maxElements: 600 });
      const clicked = ok(await runtime.run({ action: 'click', query: 'primary.txt' }));
      physical(clicked);
      return 'physical left click on primary.txt';
    });
    await step('click (double → open folder)', true, async () => {
      await runtime.run({ action: 'observe', query: 'DoubleClickFolder', maxElements: 600 });
      const doubled = ok(await runtime.run({ action: 'click', query: 'DoubleClickFolder', count: 2 }));
      physical(doubled);
      // A delivered double-click is not proof that Finder opened the folder. Pressing Back after a
      // no-op navigates out of the disposable fixture (usually to Desktop), poisoning every later
      // coordinate test while producing a dozen misleading failures. Prove we actually left the
      // parent before changing navigation history.
      const entered = ok(await runtime.run({ action: 'observe', query: 'primary.txt', maxElements: 2000 }));
      if (entered.verification?.matched) {
        throw new Error('double-click was delivered but DoubleClickFolder did not open; leaving the fixture unchanged');
      }
      ok(await runtime.run({ action: 'key', combo: 'cmd+[' }));
      const back = ok(await runtime.run({ action: 'observe', query: 'primary.txt', maxElements: 600 }));
      if (!back.verification?.matched) throw new Error('cmd+[ did not return to fixture folder');
      return 'double-click opened the folder; cmd+[ returned';
    });
    await step('click (right → full-display menu evidence)', true, async () => {
      await runtime.run({ action: 'observe', query: 'primary.txt', maxElements: 600 });
      const context = ok(await runtime.run({ action: 'click', query: 'primary.txt', button: 'right' }));
      physical(context);
      if (!context.screenshot || !fs.existsSync(context.screenshot)) throw new Error('no display capture after right-click');
      if (!/FULL DISPLAY/i.test(String(context.completionGuidance || ''))) {
        throw new Error('right-click evidence is not the full-display observation');
      }
      ok(await runtime.run({ action: 'key', combo: 'escape' }));
      const after = ok(await runtime.run({ action: 'observe', query: 'primary.txt', maxElements: 600 }));
      if (!after.verification?.matched) throw new Error('file missing after menu dismissal');
      return `context menu captured in full-display image ${context.width}x${context.height}; Escape dismissed`;
    });
    await step('click (cmd modifier)', true, async () => {
      await runtime.run({ action: 'observe', query: 'second.txt', maxElements: 600 });
      const selected = ok(await runtime.run({ action: 'click', query: 'second.txt', modifier: ['cmd'] }));
      physical(selected);
      return 'physical cmd+click on second.txt';
    });
    await step('hover', true, async () => {
      const screen = ok(await runtime.run({ action: 'observe', query: 'hover-target.txt', maxElements: 2000 }));
      const p = elementPoint(screen, 'hover-target.txt');
      const hovered = ok(await runtime.run({ action: 'hover', x: p.x, y: p.y, frameId: screen.frameId, ms: 300 }));
      return `hovered 300ms over hover-target.txt at ${p.x},${p.y}`;
    });
    await step('hold', true, async () => {
      const screen = ok(await runtime.run({ action: 'observe', query: 'hover-target.txt', maxElements: 2000 }));
      const p = elementPoint(screen, 'hover-target.txt');
      ok(await runtime.run({ action: 'hold', x: p.x, y: p.y, frameId: screen.frameId, ms: 300 }));
      return `held button 300ms on hover-target.txt`;
    });
    await step('mouse_down + mouse_up', true, async () => {
      const screen = ok(await runtime.run({ action: 'observe', query: 'second.txt', maxElements: 2000 }));
      const p = elementPoint(screen, 'second.txt');
      const pressed = ok(await runtime.run({ action: 'mouse_down', x: p.x, y: p.y, frameId: screen.frameId }));
      ok(await runtime.run({ action: 'mouse_up', x: p.x, y: p.y, frameId: pressed.frameId }));
      return 'staged press/release pair delivered on second.txt';
    });
    await step('drag (filesystem-verified)', true, async () => {
      const screen = ok(await runtime.run({ action: 'observe', query: 'alpha-drag.txt', maxElements: 2000 }));
      const from = elementPoint(screen, 'alpha-drag.txt');
      const to = elementPoint(screen, 'DropTarget');
      const dragged = ok(await runtime.run({
        action: 'drag', x: from.x, y: from.y, toX: to.x, toY: to.y, frameId: screen.frameId,
      }));
      physical(dragged);
      await new Promise(resolve => setTimeout(resolve, 400));
      const moved = fs.existsSync(path.join(fixture, 'DropTarget', 'alpha-drag.txt'))
        && !fs.existsSync(path.join(fixture, 'alpha-drag.txt'));
      if (!moved) throw new Error('drag delivered but alpha-drag.txt did not move into DropTarget');
      return 'alpha-drag.txt physically dragged into DropTarget (verified on disk)';
    });
    await step('scroll', true, async () => {
      const screen = ok(await runtime.run({ action: 'observe', maxElements: 600 }));
      const scrolled = ok(await runtime.run({
        action: 'scroll',
        x: Math.round((screen.width || 800) * 0.6), y: Math.round((screen.height || 600) * 0.6),
        frameId: screen.frameId,
        dy: 300,
      }));
      return 'scroll delivered with fresh post-action frame';
    });
    await step('wait', true, async () => {
      const waited = ok(await runtime.run({ action: 'wait', ms: 200 }));
      return 'waited 200ms and captured settling evidence';
    });
    await step('record_status', true, async () => ok(await runtime.run({ action: 'record_status' })).summary);
    skip('set_value', 'changes app state; schema forwarding and runtime behavior are covered by unit tests');
    skip('copy/paste/clipboard', 'would inspect or overwrite the user clipboard; covered by unit tests');
    skip('record_start/record_stop', 'captures the screen and requires explicit user approval; covered by unit tests');
    skip('quit_app', 'could discard unsaved work in a running app; covered by unit tests');
    await step('close', true, async () => {
      const closed = ok(await runtime.run({ action: 'close' }));
      return closed.summary;
    });
  } finally {
    await runtime.dispose();
    fs.rmSync(fixture, { recursive: true, force: true });
  }

  const missingActions = PUBLIC_DESKTOP_ACTIONS.filter(action => !coveredActions.has(action));
  if (missingActions.length) {
    report.push({
      action: 'public-action coverage',
      ok: false,
      required: true,
      note: `unaccounted public actions: ${missingActions.join(', ')}`,
    });
  }
  const failedRequired = report.filter(r => r.required && !r.ok);
  console.log(JSON.stringify({
    fixture,
    publicActions: PUBLIC_DESKTOP_ACTIONS.length,
    accountedActions: coveredActions.size,
    results: report,
    failedRequired: failedRequired.length,
  }, null, 2));
  if (failedRequired.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
