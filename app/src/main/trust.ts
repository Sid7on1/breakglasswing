import type { ComponentName, Resolution } from './runtime.paths';
import type { CodeSignatureReport } from './release.integrity';

/**
 * App-owned Trust diagnostics.
 *
 * `08_ACCEPTANCE_GATES.md` requires that "packaged app, not a dev shell, owns the permission and
 * focus experience", and V32's sample is explicit: "Trust Center shows the exact responsible signed
 * component, entitlement, macOS approval, last use and revocation instructions. Core Code operates
 * with all optional permissions denied."
 *
 * Two rules shape everything here:
 *
 *   1. **Reporting is read-only and never prompts.** The values come from non-prompting probes
 *      (`isTrustedAccessibilityClient(false)`, `getMediaAccessStatus`) and from the component
 *      resolution that already happened. Opening a diagnostics view must never be the thing that
 *      triggers a macOS permission dialog.
 *   2. **An unknown is never reported as fine.** A component we could not resolve is `missing`, a
 *      permission we could not read is `unavailable`. Neither is allowed to read as granted or
 *      healthy — the same discipline the section 28 gate states as "an evidence gap, dropped event
 *      or unavailable sensor cannot produce an unqualified safe verdict".
 *
 * Electron-free: every input is injected, so the packaged/denied/missing combinations are testable
 * without an Electron process or a permission change on the developer's machine.
 */

/**
 * The product's macOS support floor. Declared here as the single value the app reports, and kept in
 * step with `mac.minimumSystemVersion` in electron-builder.yml and `platforms:` in Package.swift —
 * a test asserts all three agree, so the number a user is shown cannot drift from the number the OS
 * and the native build actually enforce.
 */
export const MINIMUM_MACOS = '13.0';

export type PermissionDisposition = 'granted' | 'denied' | 'not-determined' | 'unavailable';

/** macOS permissions the Desktop app itself is the responsible process for. */
export interface PermissionReadings {
  /** AXIsProcessTrusted, via Electron's non-prompting isTrustedAccessibilityClient(false). */
  accessibility: PermissionDisposition;
  /** getMediaAccessStatus('screen'). */
  screenRecording: PermissionDisposition;
}

export interface ComponentReport {
  name: ComponentName;
  /** Human label used by any surface that renders this. */
  label: string;
  present: boolean;
  path?: string;
  source: Resolution['source'];
  /** Set when a packaged run refused an environment override for this component. */
  refusedOverride?: { variable: string; value: string };
  /** True only when the component is required for Computer Use, as opposed to for coding. */
  computerUseOnly: boolean;
  /** Exact executable digest for this run; absent means unreadable, never "verified". */
  sha256?: string;
  signature?: CodeSignatureReport;
}

export interface BuildFacts {
  packaged: boolean;
  appVersion: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  /** os.release() — the Darwin kernel version, not the marketing version. */
  osRelease: string;
  /** The product floor declared in electron-builder.yml and Package.swift. */
  minimumMacOS: string;
}

export interface TrustReport {
  generatedAt: string;
  build: BuildFacts;
  permissions: PermissionReadings;
  components: ComponentReport[];
  appIntegrity: { executableSha256?: string; signature: CodeSignatureReport };
  release: {
    qualification: 'development' | 'manual-alpha' | 'stable';
    warning: string | null;
    updatePermissionWarning: string;
  };
  /**
   * Whether ordinary coding works right now. This is deliberately NOT a function of any permission
   * — it is the product promise that "Core Code must work with zero Computer Use permissions", and
   * a test drives every permission to denied to prove it stays true.
   */
  coding: { available: boolean; requiresPermissions: string[] };
  /**
   * Whether Computer Use can run. Unlike coding, this genuinely depends on permissions and on the
   * native components resolving. Blockers are listed rather than collapsed into a boolean.
   */
  computerUse: { available: boolean; blockers: string[] };
  /** Facts this build cannot establish. Present so a gap is visible instead of implied.  */
  unknowns: string[];
}

const LABELS: Record<ComponentName, string> = {
  engine: 'Coding engine',
  macCapability: 'Mac capability provider',
  cuService: 'Computer Use service (XPC)',
  cuBridge: 'Computer Use bridge',
  desktopHelper: 'Desktop helper',
};

/** Only the engine is needed for coding; the rest exist for Mac control. */
const COMPUTER_USE_ONLY: Record<ComponentName, boolean> = {
  engine: false,
  macCapability: true,
  cuService: true,
  cuBridge: true,
  desktopHelper: true,
};

export function toComponentReport(name: ComponentName, resolution: Resolution): ComponentReport {
  return {
    name,
    label: LABELS[name],
    present: !!resolution.path,
    ...(resolution.path ? { path: resolution.path } : {}),
    source: resolution.source,
    ...(resolution.refusedOverride ? { refusedOverride: resolution.refusedOverride } : {}),
    computerUseOnly: COMPUTER_USE_ONLY[name],
  };
}

export interface TrustReportInput {
  now: () => Date;
  build: BuildFacts;
  permissions: PermissionReadings;
  components: Array<{ name: ComponentName; resolution: Resolution }>;
  integrity: {
    app: { sha256?: string; signature: CodeSignatureReport };
    components: Partial<Record<ComponentName, { sha256?: string; signature: CodeSignatureReport }>>;
  };
  /**
   * Whether this run established the app-owned user takeover authority (main/takeover.ts).
   *
   * `08_ACCEPTANCE_GATES.md` requires that pause/takeover prevents all agent input until explicit
   * resume. If the broker did not start there is nothing for the user to press, so the provider
   * fails closed on every mutation — and this report has to SAY so. Claiming Computer Use is
   * available while the control that stops it does not exist is precisely the "unknown reported as
   * fine" this gate forbids.
   */
  userTakeover: { available: boolean; detail?: string };
  /**
   * The native service's signing/approval gate. Manual-alpha builds may become usable only after
   * the user approves one exact intact ad-hoc seal; an environment override is never represented
   * here and therefore can never make the Trust Center report Ready.
   */
  nativeServiceTrust?: { ready: boolean; detail?: string };
}

/**
 * Assemble the report. Pure: same inputs, same output, no probing of its own.
 */
export function buildTrustReport(input: TrustReportInput): TrustReport {
  const components = input.components.map(({ name, resolution }) => ({
    ...toComponentReport(name, resolution),
    ...input.integrity.components[name],
  }));
  const byName = new Map(components.map((c) => [c.name, c]));

  const blockers: string[] = [];
  if (input.permissions.accessibility !== 'granted') {
    blockers.push('Accessibility permission is not granted');
  }
  if (input.permissions.screenRecording !== 'granted') {
    blockers.push('Screen Recording permission is not granted');
  }
  for (const name of ['macCapability', 'cuService', 'cuBridge', 'desktopHelper'] as const) {
    const component = byName.get(name);
    if (!component?.present) blockers.push(`${LABELS[name]} is not available`);
  }
  if (!input.userTakeover.available) {
    blockers.push(
      input.userTakeover.detail
      || 'Bimax could not set up the control you would use to take over, so it will not act on your Mac',
    );
  }
  if (input.nativeServiceTrust && !input.nativeServiceTrust.ready) {
    blockers.push(
      input.nativeServiceTrust.detail
      || 'The Computer Use service has not been trusted for this build',
    );
  }

  const unknowns: string[] = [];
  for (const [key, value] of Object.entries(input.permissions)) {
    if (value === 'unavailable') unknowns.push(`${key} permission state could not be read`);
  }
  if (!input.build.packaged) {
    // app.getVersion() falls back to Electron's version outside a packaged app, and a dev shell is
    // not the responsible process macOS records a grant against. Say so rather than imply the
    // numbers mean what they mean in a shipped build.
    unknowns.push('running unpackaged: build identity and permission ownership are not authoritative');
  }
  if (input.integrity.app.signature.kind === 'unknown') unknowns.push('app code signature state could not be established');
  if (input.integrity.app.signature.notarization === 'unknown') unknowns.push('app notarization state could not be established');

  const stable = input.build.packaged
    && input.integrity.app.signature.kind === 'developer-id'
    && input.integrity.app.signature.hardenedRuntime === true
    && input.integrity.app.signature.gatekeeper === 'accepted'
    && input.integrity.app.signature.notarization === 'accepted';
  const qualification = !input.build.packaged ? 'development' : stable ? 'stable' : 'manual-alpha';

  return {
    generatedAt: input.now().toISOString(),
    build: input.build,
    appIntegrity: {
      ...(input.integrity.app.sha256 ? { executableSha256: input.integrity.app.sha256 } : {}),
      signature: input.integrity.app.signature,
    },
    release: {
      qualification,
      warning: qualification === 'manual-alpha'
        ? 'Manual alpha: this build is not established as Developer ID signed and notarized. Verify its exact SHA-256 before opening it.'
        : null,
      updatePermissionWarning: 'After replacing Bimax.app, macOS may ask you to grant Screen Recording or Accessibility again. Re-check Trust Center before Control Mac work.',
    },
    permissions: input.permissions,
    components,
    coding: {
      // Invariant, by product design. Never derive this from `blockers`.
      available: !!byName.get('engine')?.present,
      requiresPermissions: [],
    },
    computerUse: { available: blockers.length === 0, blockers },
    unknowns,
  };
}

/**
 * Normalize Electron's `getMediaAccessStatus` result. Anything unrecognized becomes `unavailable`
 * rather than being optimistically treated as granted.
 */
export function toDisposition(raw: unknown): PermissionDisposition {
  switch (raw) {
    case 'granted': return 'granted';
    case 'denied':
    case 'restricted': return 'denied';
    case 'not-determined': return 'not-determined';
    case true: return 'granted';
    case false: return 'denied';
    default: return 'unavailable';
  }
}
