/**
 * Phase 9 / V10 + V29B / S29-D — official simulator toolchain adapters.
 *
 * Bimax never downloads or repackages a simulator image itself. These plans contain only fixed
 * Xcode, xcrun, sdkmanager, avdmanager, emulator, adb, and build-tool invocations. Rendering the
 * plan is non-mutating; an approved transaction may execute it through the capability broker.
 */

export type SimulatorPlatform = 'ios' | 'android';
export type OfficialTool = 'xcodebuild' | 'xcrun' | 'sdkmanager' | 'avdmanager' | 'emulator' | 'adb' | 'gradlew';

export interface SimulatorCommand {
  tool: OfficialTool;
  args: string[];
  mutates: boolean;
  purpose: string;
}

export interface SimulatorPlan {
  platform: SimulatorPlatform;
  available: boolean;
  problems: string[];
  commands: SimulatorCommand[];
  downloadOwner: 'Xcode' | 'Android SDK Manager';
  estimatedMemoryMb: number;
  cleanup: SimulatorCommand[];
}

export interface IosSimulatorInput {
  xcodeInstalled: boolean;
  licenseAccepted: boolean;
  runtimeInstalled: boolean;
  platform: 'iOS' | 'watchOS' | 'tvOS' | 'visionOS';
  runtimeIdentifier: string;
  deviceTypeIdentifier: string;
  appScheme: string;
}

export interface AndroidSimulatorInput {
  sdkManagerInstalled: boolean;
  emulatorInstalled: boolean;
  apiLevel: number;
  avdName: string;
  hostArch: 'arm64' | 'x64';
  projectUsesGradleWrapper: boolean;
}

const APPLE_ID = /^com\.apple\.CoreSimulator\.[A-Za-z0-9._-]{1,160}$/;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,80}$/;

export function iosSimulatorPlan(input: IosSimulatorInput): SimulatorPlan {
  const problems: string[] = [];
  if (!input.xcodeInstalled) problems.push('Full Xcode is not installed.');
  if (!input.licenseAccepted) problems.push('Xcode license or first-launch setup is incomplete.');
  if (!APPLE_ID.test(input.runtimeIdentifier)) problems.push('The runtime identifier is invalid.');
  if (!APPLE_ID.test(input.deviceTypeIdentifier)) problems.push('The device type identifier is invalid.');
  if (!SAFE_NAME.test(input.appScheme)) problems.push('The Xcode scheme name is invalid.');
  const commands: SimulatorCommand[] = [];
  if (problems.length === 0 && !input.runtimeInstalled) {
    commands.push({
      tool: 'xcodebuild', args: ['-downloadPlatform', input.platform], mutates: true,
      purpose: `Ask Xcode to install its official ${input.platform} simulator runtime.`,
    });
  }
  if (problems.length === 0) {
    commands.push(
      { tool: 'xcrun', args: ['simctl', 'create', `BiMAX-${input.appScheme}`, input.deviceTypeIdentifier, input.runtimeIdentifier], mutates: true, purpose: 'Create a project-scoped simulator device.' },
      { tool: 'xcrun', args: ['simctl', 'boot', '$DEVICE_UDID'], mutates: true, purpose: 'Boot the exact created device.' },
      { tool: 'xcodebuild', args: ['-scheme', input.appScheme, '-destination', 'platform=iOS Simulator,id=$DEVICE_UDID', 'test'], mutates: false, purpose: 'Build and test against the selected simulator.' },
      { tool: 'xcrun', args: ['simctl', 'io', '$DEVICE_UDID', 'screenshot', '$SCREENSHOT_HANDLE'], mutates: false, purpose: 'Capture end-state evidence.' },
    );
  }
  return {
    platform: 'ios', available: problems.length === 0, problems, commands,
    downloadOwner: 'Xcode', estimatedMemoryMb: 3072,
    cleanup: [{ tool: 'xcrun', args: ['simctl', 'delete', '$DEVICE_UDID'], mutates: true, purpose: 'Remove only the device Bimax created.' }],
  };
}

export function androidSimulatorPlan(input: AndroidSimulatorInput): SimulatorPlan {
  const problems: string[] = [];
  if (!input.sdkManagerInstalled) problems.push('Android SDK Manager is not installed.');
  if (!Number.isInteger(input.apiLevel) || input.apiLevel < 26 || input.apiLevel > 99) problems.push('The Android API level is invalid.');
  if (!SAFE_NAME.test(input.avdName)) problems.push('The AVD name is invalid.');
  if (!input.projectUsesGradleWrapper) problems.push('The project does not declare a Gradle wrapper.');
  const imageArch = input.hostArch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const image = `system-images;android-${input.apiLevel};google_apis;${imageArch}`;
  const commands: SimulatorCommand[] = [];
  if (problems.length === 0) {
    const missing = ['platform-tools', ...(input.emulatorInstalled ? [] : ['emulator']), image];
    commands.push(
      { tool: 'sdkmanager', args: missing, mutates: true, purpose: 'Install official Android SDK components selected in the approved preview.' },
      { tool: 'avdmanager', args: ['create', 'avd', '--name', input.avdName, '--package', image, '--force'], mutates: true, purpose: 'Create the named project AVD.' },
      { tool: 'emulator', args: ['-avd', input.avdName, '-no-snapshot-save', '-no-boot-anim'], mutates: true, purpose: 'Boot the exact AVD without changing a shared snapshot.' },
      { tool: 'adb', args: ['-s', '$SERIAL', 'wait-for-device'], mutates: false, purpose: 'Wait for the exact emulator serial.' },
      { tool: 'gradlew', args: ['connectedCheck'], mutates: false, purpose: 'Run the project-declared Android tests.' },
      { tool: 'adb', args: ['-s', '$SERIAL', 'exec-out', 'screencap', '-p'], mutates: false, purpose: 'Capture end-state evidence.' },
    );
  }
  return {
    platform: 'android', available: problems.length === 0, problems, commands,
    downloadOwner: 'Android SDK Manager', estimatedMemoryMb: 4096,
    cleanup: [{ tool: 'adb', args: ['-s', '$SERIAL', 'emu', 'kill'], mutates: true, purpose: 'Stop only the emulator Bimax launched.' }],
  };
}

export interface ResourceReservationInput {
  availableMemoryMb: number;
  simulatorMemoryMb: number;
  localModelMemoryMb: number;
  indexerMemoryMb: number;
  activeInteraction: boolean;
}

export interface ResourceReservation {
  allowed: boolean;
  reservedMemoryMb: number;
  headroomMb: number;
  backgroundConcurrency: number;
  reason: string;
}

/** S29-09: simulator + local model must not consume the machine's final responsive headroom. */
export function reserveSimulatorResources(input: ResourceReservationInput): ResourceReservation {
  const safetyHeadroom = Math.max(1536, Math.ceil(input.availableMemoryMb * 0.2));
  const demand = input.simulatorMemoryMb + input.localModelMemoryMb + input.indexerMemoryMb;
  const headroomMb = input.availableMemoryMb - demand;
  const allowed = headroomMb >= safetyHeadroom;
  return {
    allowed,
    reservedMemoryMb: allowed ? input.simulatorMemoryMb : 0,
    headroomMb,
    backgroundConcurrency: !allowed || input.activeInteraction ? 0 : headroomMb < safetyHeadroom * 2 ? 1 : 2,
    reason: allowed
      ? `Reserved ${input.simulatorMemoryMb} MB with ${headroomMb} MB remaining.`
      : `Needs ${safetyHeadroom} MB responsive headroom; the proposed workloads leave ${headroomMb} MB.`,
  };
}

export interface SimulatorStepResult { command: SimulatorCommand; ok: boolean; evidenceId: string | null; detail: string }
export interface SimulatorJourneyReceipt {
  platform: SimulatorPlatform;
  ok: boolean;
  steps: SimulatorStepResult[];
  cleanedUp: boolean;
  failedAt: number | null;
}

export async function runSimulatorJourney(
  plan: SimulatorPlan,
  approved: boolean,
  run: (command: SimulatorCommand) => Promise<{ ok: boolean; evidenceId?: string; detail: string }>,
): Promise<SimulatorJourneyReceipt> {
  if (!plan.available || !approved) return { platform: plan.platform, ok: false, steps: [], cleanedUp: false, failedAt: 0 };
  const steps: SimulatorStepResult[] = [];
  let failedAt: number | null = null;
  for (const command of plan.commands) {
    const result = await run(command);
    steps.push({ command, ok: result.ok, evidenceId: result.evidenceId ?? null, detail: result.detail });
    if (!result.ok || (!command.mutates && !result.evidenceId)) { failedAt = steps.length - 1; break; }
  }
  let cleanedUp = false;
  for (const command of plan.cleanup) cleanedUp = (await run(command)).ok || cleanedUp;
  return { platform: plan.platform, ok: failedAt === null && steps.length === plan.commands.length, steps, cleanedUp, failedAt };
}

