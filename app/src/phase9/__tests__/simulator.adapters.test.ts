import { androidSimulatorPlan, iosSimulatorPlan, reserveSimulatorResources, runSimulatorJourney } from '../simulator.adapters';

describe('Phase 9 official simulator adapters (S29-D)', () => {
  test('Xcode owns iOS runtime installation and the journey binds one created device', () => {
    const plan = iosSimulatorPlan({
      xcodeInstalled: true, licenseAccepted: true, runtimeInstalled: false, platform: 'iOS',
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-18-0',
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16', appScheme: 'Demo',
    });
    expect(plan.downloadOwner).toBe('Xcode');
    expect(plan.commands[0]).toEqual(expect.objectContaining({ tool: 'xcodebuild', args: ['-downloadPlatform', 'iOS'] }));
    expect(JSON.stringify(plan)).not.toMatch(/https?:\/\//);
  });

  test('Android selects the official host architecture image', () => {
    const arm = androidSimulatorPlan({ sdkManagerInstalled: true, emulatorInstalled: true, apiLevel: 35, avdName: 'bimax-demo', hostArch: 'arm64', projectUsesGradleWrapper: true });
    const intel = androidSimulatorPlan({ sdkManagerInstalled: true, emulatorInstalled: true, apiLevel: 35, avdName: 'bimax-demo', hostArch: 'x64', projectUsesGradleWrapper: true });
    expect(JSON.stringify(arm.commands)).toContain('arm64-v8a');
    expect(JSON.stringify(intel.commands)).toContain('x86_64');
  });

  test('memory reservation refuses a simulator/model combination that would collapse headroom', () => {
    expect(reserveSimulatorResources({ availableMemoryMb: 8000, simulatorMemoryMb: 4000, localModelMemoryMb: 3500, indexerMemoryMb: 1000, activeInteraction: false }).allowed).toBe(false);
    expect(reserveSimulatorResources({ availableMemoryMb: 16000, simulatorMemoryMb: 3000, localModelMemoryMb: 2000, indexerMemoryMb: 1000, activeInteraction: true }).backgroundConcurrency).toBe(0);
  });

  test('a missing evidence id fails the journey and cleanup still runs', async () => {
    const plan = androidSimulatorPlan({ sdkManagerInstalled: true, emulatorInstalled: true, apiLevel: 35, avdName: 'bimax-demo', hostArch: 'arm64', projectUsesGradleWrapper: true });
    let cleanup = 0;
    const receipt = await runSimulatorJourney(plan, true, async (command) => {
      if (command.purpose.startsWith('Stop')) { cleanup += 1; return { ok: true, detail: 'stopped' }; }
      return { ok: true, detail: 'ran', ...(command.mutates ? {} : { evidenceId: command.tool === 'gradlew' ? undefined : 'evidence' }) };
    });
    expect(receipt.ok).toBe(false);
    expect(cleanup).toBe(1);
  });
});

