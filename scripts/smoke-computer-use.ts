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

    // Calculator publishes the running expression AND its result together, in the window's value:
    // "1,271×170+104 — 216,174", padded with bidi marks. The old check stripped every non-digit from
    // that whole string ("1271170104216174") and demanded exact equality with the result, which can
    // never match — so this smoke printed `semantic: null` and PASSED, for however long it has been
    // wrong. Its own docstring says it reads the result from a fresh accessibility observation; that
    // claim was never actually asserted, only the presence of a screenshot was.
    const readable = (element: any) => String(element?.value ?? element?.label ?? '')
      .replace(/[‎‏]/g, '');
    const values = (after.elements || [])
      .map((element: any) => ({ label: element?.label, role: element?.role, value: element?.value }))
      .filter((element: any) => /\d/.test(readable(element)));
    // Accept the digits with or without the thousands separator, anywhere in the element's text.
    const displayed = values.find((element: any) => /216,?174/.test(readable(element)));
    const screenshot = String(after.screenshot || '');
    const screenshotBytes = screenshot && fs.existsSync(screenshot) ? fs.statSync(screenshot).size : 0;
    if (!screenshotBytes) throw new Error('fresh Calculator observation produced no screenshot evidence');
    // Assert the central claim. Without this the smoke reports a clean pass while the semantic read
    // — the entire point of the exercise — returns nothing.
    if (!displayed) {
      throw new Error('Calculator computed 1271*170+104 but no observed element carried the result 216,174; '
        + `semantic read failed over ${values.length} numeric element(s): `
        + JSON.stringify(values.slice(0, 8)));
    }
    console.log(JSON.stringify({
      driver: after.driver, pid: after.pid, windowId: after.windowId,
      semantic: displayed || null, degraded: !!after.degraded, screenshot, screenshotBytes,
      pixelClick: { normalized: [852, 915], frameHash: entered.frameHash },
    }, null, 2));
  } finally {
    if (opened) {
      // quit_app, not close: `close` is window-scoped (Cmd+W) by design, and an app whose main
      // window is not user-closable — Calculator is exactly that — survives it. Using close here
      // made every run of this smoke leave a live Calculator behind on the developer's desktop and
      // report a confusing "did not close after Cmd+W" failure. This script LAUNCHED the app, so
      // quitting it is the correct symmetric cleanup.
      const closed = await runtime.run({ action: 'quit_app' });
      if (!closed.ok) console.error(`cleanup: ${closed.error || closed.summary}`);
    }
    await runtime.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
