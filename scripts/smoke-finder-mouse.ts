/**
 * Manual macOS mouse regression: exercise Finder through the same visible native-cursor runtime
 * used by ComputerTool. The caller provides a disposable fixture containing DoubleClickFolder,
 * control-unselected.txt, alpha-drag.txt, DropTarget, red/green/blue-select.txt, and MultiTarget.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BimaxComputerRuntime, DesktopResult } from '../src/computer/desktop.runtime';

const fixture = process.argv[2];
if (!fixture) throw new Error('usage: tsx scripts/smoke-finder-mouse.ts /absolute/disposable-fixture');

function ok(result: DesktopResult): DesktopResult {
  if (!result.ok) throw new Error(result.error || result.summary);
  return result;
}

function point(result: DesktopResult, label: string): { x: number; y: number } {
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

function physical(result: DesktopResult, action: string): void {
  if ((result.details as any)?.path !== 'native-global-cgevent') {
    throw new Error(`${action} did not use the visible native cursor`);
  }
}

async function observe(runtime: BimaxComputerRuntime, query?: string) {
  return ok(await runtime.run({ action: 'observe', query, maxElements: 600 }));
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Finder mouse smoke is macOS-only');
  if (!path.isAbsolute(fixture) || !fs.statSync(fixture).isDirectory()) throw new Error('fixture must be an existing absolute directory');
  const runtime = new BimaxComputerRuntime();
  const checks: Record<string, unknown> = {};
  try {
    ok(await runtime.run({ action: 'status' }));
    ok(await runtime.run({ action: 'open', app: 'Finder' }));
    ok(await runtime.run({ action: 'key', combo: 'cmd+shift+g' }));
    ok(await runtime.run({ action: 'type', text: fixture }));
    ok(await runtime.run({ action: 'key', combo: 'enter' }));
    let screen = await observe(runtime, 'DoubleClickFolder');
    checks.navigation = { matched: screen.verification?.matched, screenshot: screen.screenshot };
    if (!screen.verification?.matched) throw new Error('fixture contents did not appear after Go to Folder');

    const doubled = ok(await runtime.run({ action: 'click', query: 'DoubleClickFolder', count: 2 }));
    physical(doubled, 'double-click');
    screen = await observe(runtime, 'DoubleClickFolder');
    // The destination window title is also "DoubleClickFolder"; only the old icon remaining would
    // mean the double-click failed.
    const openedFolder = !(screen.elements || []).some((candidate: any) =>
      candidate?.role === 'AXImage'
      && String(candidate?.label || candidate?.value || '').trim() === 'DoubleClickFolder');
    if (!openedFolder) throw new Error('DoubleClickFolder was still visible after double-click');
    checks.doubleClick = { physical: true, opened: true, screenshot: screen.screenshot };

    ok(await runtime.run({ action: 'key', combo: 'cmd+[' }));
    screen = await observe(runtime, 'control-unselected.txt');
    if (!screen.verification?.matched) throw new Error('Back did not return to the fixture folder');
    const context = ok(await runtime.run({ action: 'click', query: 'control-unselected.txt', button: 'right' }));
    physical(context, 'right-click');
    // Finder's transient context menu is intentionally absent from the sidecar's stable window AX
    // list. Its atomic post-click PNG + changed frame is therefore the evidence for appearance;
    // Escape must then produce another changed frame while the original file remains present.
    const menuVisible = !!context.screenshot && context.progressCheck?.frameChanged === true;
    if (!menuVisible) throw new Error('right-click delivered but no Finder context menu was observed');
    ok(await runtime.run({ action: 'key', combo: 'escape' }));
    screen = await observe(runtime, 'control-unselected.txt');
    const dismissed = screen.verification?.matched === true && screen.frameHash !== context.frameHash;
    if (!dismissed) throw new Error('Escape did not visibly dismiss the Finder context menu');
    checks.rightClick = { physical: true, menuVisible: true, dismissed: true, screenshot: context.screenshot };

    const beforeDrag = await observe(runtime);
    const from = point(beforeDrag, 'alpha-drag.txt');
    const to = point(beforeDrag, 'DropTarget');
    const dragged = ok(await runtime.run({ action: 'drag', x: from.x, y: from.y, toX: to.x, toY: to.y }));
    physical(dragged, 'drag');
    const singleMoved = fs.existsSync(path.join(fixture, 'DropTarget', 'alpha-drag.txt'))
      && !fs.existsSync(path.join(fixture, 'alpha-drag.txt'));
    if (!singleMoved) throw new Error('native drag completed but alpha-drag.txt did not move into DropTarget');
    checks.dragDrop = { physical: true, moved: true, screenshot: dragged.screenshot };

    for (const label of ['red-select.txt', 'green-select.txt', 'blue-select.txt']) {
      await observe(runtime, label);
      const selected = ok(await runtime.run({ action: 'click', query: label, modifier: ['cmd'] }));
      physical(selected, `cmd-click ${label}`);
    }
    screen = await observe(runtime);
    const groupFrom = point(screen, 'blue-select.txt');
    const groupTo = point(screen, 'MultiTarget');
    const groupDrag = ok(await runtime.run({ action: 'drag', x: groupFrom.x, y: groupFrom.y, toX: groupTo.x, toY: groupTo.y }));
    physical(groupDrag, 'multi-select drag');
    const selectedNames = ['red-select.txt', 'green-select.txt', 'blue-select.txt'];
    const groupMoved = selectedNames.every(name => fs.existsSync(path.join(fixture, 'MultiTarget', name)))
      && fs.existsSync(path.join(fixture, 'control-unselected.txt'));
    if (!groupMoved) throw new Error('Cmd multi-select drag did not move exactly the three selected files');
    checks.multiSelectDrag = { physical: true, movedThree: true, unselectedPreserved: true, screenshot: groupDrag.screenshot };

    screen = await observe(runtime);
    const scrollPoint = { x: Math.round((screen.width || 800) * 0.7), y: Math.round((screen.height || 600) * 0.7) };
    const scrolled = ok(await runtime.run({ action: 'scroll', ...scrollPoint, dy: 500 }));
    physical(scrolled, 'scroll');
    checks.scroll = { physical: true, freshFrame: !!scrolled.screenshot, screenshot: scrolled.screenshot };

    console.log(JSON.stringify({ fixture, checks }, null, 2));
  } finally {
    await runtime.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
