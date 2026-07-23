/**
 * Manual native smoke for System Settings battery navigation. This intentionally obtains every
 * fact from fresh Computer Use observations; shell/system_profiler output is never consulted.
 */
import * as fs from 'fs';
import { BimaxComputerRuntime, DesktopResult } from '../src/computer/desktop.runtime';

function evidence(result: DesktopResult) {
  const screenshot = String(result.screenshot || '');
  return {
    summary: result.summary,
    width: result.width,
    height: result.height,
    screenshot,
    screenshotBytes: screenshot && fs.existsSync(screenshot) ? fs.statSync(screenshot).size : 0,
    frameHash: result.frameHash,
    labels: (result.elements || [])
      .map((element: any) => ({
        elementIndex: element?.element_index,
        elementToken: element?.element_token,
        label: element?.label,
        value: element?.value,
        description: element?.description,
        role: element?.role,
        frame: element?.frame,
      }))
      .filter((element: any) => /battery|health|capacity|cycle|normal|service|%/i.test(JSON.stringify(element))),
  };
}

async function requireOk(result: DesktopResult): Promise<DesktopResult> {
  if (!result.ok) throw new Error(result.error || result.summary);
  return result;
}

async function main() {
  const runtime = new BimaxComputerRuntime();
  try {
    await requireOk(await runtime.run({ action: 'status' }));
    const opened = await requireOk(await runtime.run({
      action: 'open', app: 'System Settings', bundleId: 'com.apple.systempreferences',
    }));
    if (!opened.screenshot) {
      throw new Error(`System Settings opened without fresh screenshot evidence: ${opened.visualEvidenceError || JSON.stringify(opened.details)}`);
    }

    // Dismiss a health sheet left by a prior run, then establish a deterministic General baseline
    // so this smoke necessarily exercises the same fresh element-handle navigation the model uses.
    await requireOk(await runtime.run({ action: 'key', combo: 'escape' }));
    await requireOk(await runtime.run({ action: 'observe', maxElements: 500 }));
    await requireOk(await runtime.run({ action: 'click', query: 'General' }));
    const current = await requireOk(await runtime.run({ action: 'observe', query: 'Battery Health', maxElements: 500 }));
    let batteryPage = current;
    let batteryNavigation: DesktopResult | null = null;
    const alreadyOnBatteryPage = (current.elements || []).some((element: any) =>
      /battery/i.test(String(element?.label || '')) && /battery level/i.test(String(element?.label || element?.value || '')),
    );
    if (!current.verification?.matched && !alreadyOnBatteryPage) {
      const battery = (current.elements || []).find((element: any) =>
        String(element?.label || element?.value || '').trim() === 'Battery' && element?.frame,
      ) as any;
      if (!battery?.element_token && battery?.element_index == null) {
        throw new Error('fresh System Settings observation did not expose a clickable Battery handle');
      }
      batteryNavigation = await requireOk(await runtime.run({
        action: 'click',
        ...(battery.element_token ? { elementToken: String(battery.element_token) } : { elementIndex: Number(battery.element_index) }),
      }));
      batteryPage = await requireOk(await runtime.run({ action: 'observe', query: 'Battery Health', maxElements: 500 }));
    }
    if (!batteryPage.screenshot) throw new Error('Battery click produced no fresh screenshot evidence');

    // System Settings does not expose the Battery Health row through AX on current macOS builds.
    // Click the visible info button from the fresh window screenshot in normalized image space.
    const healthClick = await requireOk(await runtime.run({
      action: 'click', x: 940, y: 137, normalized: true,
      debugImageOut: '.bimax/computer/battery-click-debug.png',
    }));
    const cursor = await requireOk(await runtime.run({ action: 'cursor' }));
    const windows = await requireOk(await runtime.run({ action: 'windows' }));
    const healthDetails = await requireOk(await runtime.run({ action: 'observe', maxElements: 500 }));

    console.log(JSON.stringify({
      opened: evidence(opened),
      batteryNavigation: batteryNavigation ? evidence(batteryNavigation) : null,
      batteryPage: evidence(batteryPage),
      healthClick: evidence(healthClick),
      cursor: { x: cursor.x, y: cursor.y, details: cursor.details },
      windows: windows.details,
      healthDetails: evidence(healthDetails),
    }, null, 2));
  } finally {
    await runtime.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
