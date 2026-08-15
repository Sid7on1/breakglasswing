/**
 * Manual macOS regression for the exact failure that motivated the physical-input path:
 * System Settings ignores the sidecar's synthetic background click even though its overlay cursor
 * animates. This smoke deliberately runs with the legacy bad preferences in the environment, then
 * proves Bimax still uses the native cursor, changes General → Accessibility, and restores General.
 */
import { BimaxComputerRuntime } from '../../src/capabilities/mac/desktop.runtime';

async function clickAndVerify(runtime: BimaxComputerRuntime, label: string, previousHash?: string) {
  const clicked = await runtime.run({ action: 'click', query: label });
  if (!clicked.ok) throw new Error(clicked.error || clicked.summary);
  const details = clicked.details as any;
  if (details?.path !== 'native-global-cgevent') throw new Error(`${label}: did not use physical native input`);
  if (details?.inputVerified !== true) throw new Error(`${label}: native cursor landing was not verified`);
  if (!clicked.frameHash) throw new Error(`${label}: click returned no fresh screenshot`);
  if (previousHash && clicked.frameHash === previousHash) throw new Error(`${label}: screen was pixel-identical after the click`);
  const observed = await runtime.run({ action: 'observe', query: label, maxElements: 300 });
  if (!observed.ok) throw new Error(observed.error || observed.summary);
  if (!observed.verification?.matched) throw new Error(`${label}: native text did not confirm the destination after the physical click`);
  return { clicked, observed };
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('System Settings smoke is macOS-only');
  const runtime = new BimaxComputerRuntime();
  try {
    const launched = await runtime.run({ action: 'open', app: 'System Settings', bundleId: 'com.apple.systempreferences' });
    if (!launched.ok) throw new Error(launched.error || launched.summary);
    const initial = await runtime.run({ action: 'observe', query: 'General', maxElements: 300 });
    if (!initial.ok || !initial.frameHash) throw new Error(initial.error || 'initial System Settings observation failed');

    const accessibility = await clickAndVerify(runtime, 'Accessibility', initial.frameHash);
    const restored = await clickAndVerify(runtime, 'General', accessibility.observed.frameHash);

    console.log(JSON.stringify({
      driver: restored.observed.driver,
      pid: restored.observed.pid,
      windowId: restored.observed.windowId,
      physicalInput: true,
      accessibilityScreenshot: accessibility.observed.screenshot,
      restoredScreenshot: restored.observed.screenshot,
    }, null, 2));
  } finally {
    // Preserve the user's app/session; only dispose Bimax's sidecar connection.
    await runtime.dispose();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
