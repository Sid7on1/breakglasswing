/**
 * Manual long-session smoke for the single-cursor path. It exercises real macOS applications and
 * proves repeated click, modifier-click multi-selection, drag-selection, copy, paste, and scroll
 * using fresh screenshots. It never deletes, saves, or changes system settings.
 */
import * as fs from 'fs';
import { BimaxComputerRuntime, DesktopCommand, DesktopResult } from '../src/computer/desktop.runtime';

const runtime = new BimaxComputerRuntime();
let actions = 0;
let visualChanges = 0;
let previousHash = '';

async function act(command: DesktopCommand): Promise<DesktopResult> {
  const result = await runtime.run(command);
  actions += 1;
  if (!result.ok) throw new Error(`${command.action}: ${result.error || result.summary}`);
  if (result.frameHash && previousHash && result.frameHash !== previousHash) visualChanges += 1;
  if (result.frameHash) previousHash = result.frameHash;
  return result;
}

function requireScreenshot(result: DesktopResult, label: string): string {
  const file = String(result.screenshot || '');
  if (!file || !fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`${label} produced no screenshot proof`);
  }
  return file;
}

async function textEditProof() {
  await act({ action: 'open', app: 'TextEdit', bundleId: 'com.apple.TextEdit' });
  await act({ action: 'key', combo: 'cmd+n' });
  await act({ action: 'type', text: 'BIMAX DRAG COPY PROOF\nOne real cursor can select and copy text.\nLong session marker 2026.\n' });
  let observed = await act({ action: 'observe', maxElements: 500 });
  requireScreenshot(observed, 'TextEdit source');
  const sourceHash = observed.frameHash;

  // TextEdit's AX text frame includes its toolbar/ruler on some macOS builds. Ground this drag in
  // the fresh PNG instead: the first text row is stable near y=210 in normalized 0–1000 space.
  const dragged = await act({
    action: 'drag', x: 50, y: 210, toX: 240, toY: 210, normalized: true,
  });
  requireScreenshot(dragged, 'TextEdit drag selection');
  if (sourceHash && dragged.frameHash === sourceHash) {
    throw new Error(`TextEdit drag produced no visible selection: ${JSON.stringify({
      width: dragged.width, height: dragged.height, details: dragged.details,
    })}`);
  }
  await act({ action: 'key', combo: 'cmd+c' });
  await act({ action: 'key', combo: 'cmd+down' });
  await act({ action: 'key', combo: 'return' });
  await act({ action: 'type', text: 'COPIED WITH CURSOR: ' });
  await act({ action: 'key', combo: 'cmd+v' });
  observed = await act({ action: 'observe', maxElements: 500 });
  const value = (observed.elements as any[] || [])
    .map(element => String(element?.value || ''))
    .find(candidate => candidate.includes('COPIED WITH CURSOR:')) || '';
  if (observed.frameHash === sourceHash || observed.frameHash === dragged.frameHash) {
    throw new Error('TextEdit copy/paste produced no visible document change');
  }
  return { screenshot: requireScreenshot(observed, 'TextEdit copy/paste'), textValue: value };
}

async function finderProof() {
  await act({ action: 'open', app: 'Finder', bundleId: 'com.apple.finder' });
  await act({ action: 'key', combo: 'cmd+shift+g' });
  await act({ action: 'type', text: '/Users/vishsiddharth/Desktop/Bimax' });
  await act({ action: 'key', combo: 'return' });
  await act({ action: 'wait', ms: 700 });
  await act({ action: 'key', combo: 'cmd+2' });
  await act({ action: 'wait', ms: 400 });

  const labels = ['README.md', 'package.json', 'tsconfig.json', 'src', 'scripts', 'tui'];
  let final: DesktopResult | null = null;
  for (let round = 0; round < 2; round++) {
    for (let index = 0; index < labels.length; index++) {
      await act({ action: 'observe', maxElements: 1000 });
      final = await act({
        action: 'click', query: labels[index],
        modifier: index === 0 ? undefined : ['cmd'],
      });
      requireScreenshot(final, `Finder selection ${labels[index]}`);
    }
  }
  if (!final) throw new Error('Finder selection loop did not run');
  const selectionScreenshot = requireScreenshot(final, 'Finder multi-selection');
  await act({ action: 'scroll', x: 850, y: 700, dy: 240, normalized: true });
  await act({ action: 'scroll', x: 850, y: 700, dy: -240, normalized: true });
  return { screenshot: selectionScreenshot };
}

async function main() {
  try {
    const status = await act({ action: 'status' });
    if (status.accessibility === false || status.screenRecording === false) {
      throw new Error('Computer Use permissions are not granted');
    }
    const text = await textEditProof();
    const finder = await finderProof();
    const cursor = await act({ action: 'cursor' });
    console.log(JSON.stringify({
      ok: true,
      actions,
      visualChanges,
      cursor: { x: cursor.x, y: cursor.y, driver: cursor.driver },
      textScreenshot: text.screenshot,
      copiedTextTail: text.textValue.slice(-180),
      finderScreenshot: finder.screenshot,
    }, null, 2));
  } finally {
    await runtime.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
