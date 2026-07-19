/**
 * Manual native smoke: prove Bimax Computer Use can target Calculator by pid/window, enter the
 * expression with native input, read the result from a fresh accessibility+pixel observation, and
 * cooperatively close the app. This is intentionally not part of headless CI.
 */
import { BimaxComputerRuntime } from '../src/computer/desktop.runtime';
import * as fs from 'fs';

async function main() {
  const runtime = new BimaxComputerRuntime();
  let opened = false;
  try {
    const status = await runtime.run({ action: 'status' });
    if (!status.ok) throw new Error(status.error || status.summary);

    const launch = await runtime.run({ action: 'open', app: 'Calculator', bundleId: 'com.apple.calculator' });
    if (!launch.ok) throw new Error(launch.error || launch.summary);
    opened = true;

    const before = await runtime.run({ action: 'observe', maxElements: 500 });
    if (!before.ok) throw new Error(before.error || before.summary);

    // Calculator preserves its prior tape across launches. Escape twice is the native all-clear
    // path and makes the smoke deterministic without querying or altering state out-of-band.
    for (let i = 0; i < 2; i++) {
      const cleared = await runtime.run({ action: 'key', combo: 'escape' });
      if (!cleared.ok) throw new Error(cleared.error || cleared.summary);
    }
    const typed = await runtime.run({ action: 'type', text: '1271*170+104' });
    if (!typed.ok) throw new Error(typed.error || typed.summary);
    // Exercise the visual path, not AX activation or a keyboard shortcut. Calculator has a fixed
    // keypad layout; this normalized point is the visible center of '=' in the newest screenshot.
    const entered = await runtime.run({ action: 'click', x: 852, y: 915, normalized: true });
    if (!entered.ok) throw new Error(entered.error || entered.summary);
    if (!entered.screenshot || !entered.frameHash) throw new Error('pixel click returned no fresh visual evidence');

    await new Promise(resolve => setTimeout(resolve, 350));
    const after = await runtime.run({ action: 'observe', maxElements: 500 });
    if (!after.ok) throw new Error(after.error || after.summary);

    const values = (after.elements || [])
      .map((element: any) => ({ label: element?.label, role: element?.role, value: element?.value }))
      .filter((element: any) => /\d/.test(String(element.value || element.label || '')));
    const displayed = values.find((element: any) =>
      String(element.value || element.label || '').replace(/[^0-9-]/g, '') === '216174');
    const screenshot = String(after.screenshot || '');
    const screenshotBytes = screenshot && fs.existsSync(screenshot) ? fs.statSync(screenshot).size : 0;
    if (!screenshotBytes) throw new Error('fresh Calculator observation produced no screenshot evidence');
    console.log(JSON.stringify({
      driver: after.driver, pid: after.pid, windowId: after.windowId,
      semantic: displayed || null, degraded: !!after.degraded, screenshot, screenshotBytes,
      pixelClick: { normalized: [852, 915], frameHash: entered.frameHash },
    }, null, 2));
  } finally {
    if (opened) {
      const closed = await runtime.run({ action: 'close' });
      if (!closed.ok) console.error(`cleanup: ${closed.error || closed.summary}`);
    }
    await runtime.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
