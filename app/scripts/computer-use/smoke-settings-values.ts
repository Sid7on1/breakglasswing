import { BimaxComputerRuntime, DesktopResult } from '../../src/capabilities/mac/desktop.runtime';

function requireOk(result: DesktopResult): DesktopResult {
  if (!result.ok) throw new Error(result.error || result.summary);
  return result;
}

function matching(result: DesktopResult, pattern: RegExp): unknown[] {
  return (result.elements || []).filter((element: any) => pattern.test(JSON.stringify(element)));
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('System Settings value smoke is macOS-only');
  const runtime = new BimaxComputerRuntime();
  try {
    requireOk(await runtime.run({
      action: 'open',
      app: 'System Settings',
      bundleId: 'com.apple.systempreferences',
    }));
    requireOk(await runtime.run({ action: 'key', combo: 'escape' }));

    const baseline = requireOk(await runtime.run({ action: 'observe', maxElements: 1000 }));
    const soundCandidates = (baseline.elements || []).filter((element: any) =>
      String(element?.label || element?.value || '').trim() === 'Sound' && element?.frame,
    ) as any[];
    const sound = soundCandidates.find((element: any) =>
      !['AXWindow', 'AXOutline', 'AXGroup', 'AXScrollArea', 'AXToolbar'].includes(String(element?.role || '')),
    ) || soundCandidates[0];
    if (!sound) throw new Error('Sound navigation handle was not exposed');
    const frame = sound.frame as { x: number; y: number; w: number; h: number };
    requireOk(await runtime.run({ action: 'click', x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }));
    const soundPage = requireOk(await runtime.run({
      action: 'observe',
      query: 'Alert volume',
      maxElements: 1000,
    }));
    const alertSlider = (soundPage.elements || []).find((element: any) =>
      String(element?.role || '') === 'AXSlider'
        && /alert volume/i.test(String(element?.label || element?.context_label || ''))
        && (element?.element_token || element?.element_index != null),
    ) as any;
    if (!alertSlider) {
      const nearby = (soundPage.elements || []).filter((element: any) =>
        String(element?.role || '') === 'AXSlider'
          || (Number(element?.frame?.y) >= 240 && Number(element?.frame?.y) <= 380),
      );
      throw new Error(`Alert volume slider was not exposed with row context: ${JSON.stringify(nearby)}`);
    }
    const setAlertVolume = requireOk(await runtime.run({
      action: 'set_value',
      query: 'Alert volume',
      value: 'full',
    }));
    if (setAlertVolume.actionResult?.confidence !== 'proven'
      || setAlertVolume.actionResult.postcondition?.matched !== true
      || (setAlertVolume.details as any)?.appliedValue !== '1') {
      throw new Error(`Alert volume endpoint was not proven: ${JSON.stringify(setAlertVolume.actionResult)}`);
    }
    const verifiedSound = requireOk(await runtime.run({
      action: 'observe',
      query: 'Alert volume',
      maxElements: 1000,
    }));

    process.stdout.write(`${JSON.stringify({
      navigationCandidateCount: soundCandidates.length,
      alertSlider,
      endpoint: {
        summary: setAlertVolume.summary,
        details: setAlertVolume.details,
        progressCheck: setAlertVolume.progressCheck,
        actionResult: setAlertVolume.actionResult,
        screenshot: setAlertVolume.screenshot,
      },
      verifiedSlider: matching(verifiedSound, /alert volume/i),
    }, null, 2)}\n`);
  } finally {
    await runtime.dispose();
  }
}

main().catch(error => {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exitCode = 1;
});
