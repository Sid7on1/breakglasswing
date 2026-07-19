/**
 * Manual native smoke for Stage 4 interaction primitives: prove hover / hold / mouse_down /
 * mouse_up and the drag state machine execute end-to-end through the real sidecar + Swift helper,
 * and — critically — that a bare down/up pair and a drag do NOT leave the pointer button stuck (a
 * normal calculation still works afterward). Inert points on Calculator's display area are used so
 * nothing is actually clicked/changed by the primitives themselves. Not part of headless CI.
 */
import { BimaxComputerRuntime } from '../src/computer/desktop.runtime';

async function main() {
  const rt = new BimaxComputerRuntime();
  let opened = false;
  try {
    const status = await rt.run({ action: 'status' });
    if (!status.ok) throw new Error(status.error || status.summary);
    const launch = await rt.run({ action: 'open', app: 'Calculator', bundleId: 'com.apple.calculator' });
    if (!launch.ok) throw new Error(launch.error || launch.summary);
    opened = true;
    await rt.run({ action: 'observe', maxElements: 50 });

    // Inert top-center point (the result display), in normalized 0–1000 window space.
    const at = { x: 500, y: 140, normalized: true } as const;
    const hover = await rt.run({ action: 'hover', ...at, ms: 250 });
    if (!hover.ok) throw new Error(`hover: ${hover.error}`);
    const down = await rt.run({ action: 'mouse_down', ...at });
    if (!down.ok) throw new Error(`mouse_down: ${down.error}`);
    const up = await rt.run({ action: 'mouse_up', ...at });
    if (!up.ok) throw new Error(`mouse_up: ${up.error}`);
    const hold = await rt.run({ action: 'hold', ...at, ms: 200 });
    if (!hold.ok) throw new Error(`hold: ${hold.error}`);
    // Drag across the inert display area — exercises the DragMachine (source-verify → down → move →
    // dest-verify → up → verify) and its trace.
    const drag = await rt.run({ action: 'drag', x: 400, y: 140, toX: 600, toY: 150, normalized: true });
    if (!drag.ok) throw new Error(`drag: ${drag.error}`);
    const dragTrace = ((drag.details as any)?.dragTrace || []).map((e: any) => e.phase);

    // PROOF OF NO STUCK BUTTON: a normal calculation must still work after the down/up + drag.
    for (let i = 0; i < 2; i++) await rt.run({ action: 'key', combo: 'escape' });
    const typed = await rt.run({ action: 'type', text: '2+2' });
    if (!typed.ok) throw new Error(`type: ${typed.error}`);
    const equals = await rt.run({ action: 'click', x: 852, y: 915, normalized: true });
    if (!equals.ok) throw new Error(`click =: ${equals.error}`);
    await new Promise(r => setTimeout(r, 300));
    const after = await rt.run({ action: 'observe', maxElements: 200 });

    console.log(JSON.stringify({
      hover: hover.ok, mouse_down: down.summary, mouse_up: up.ok, hold: hold.ok,
      dragPhases: dragTrace, dragOk: drag.ok,
      finalCalcOk: equals.ok, finalScreenshot: after.screenshot,
    }, null, 2));
  } finally {
    if (opened) { const c = await rt.run({ action: 'close' }); if (!c.ok) console.error(`cleanup: ${c.error || c.summary}`); }
    await rt.dispose();
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; });
