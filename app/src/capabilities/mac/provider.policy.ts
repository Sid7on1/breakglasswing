export interface CapabilityGovernor {
  mode?: 'strict' | 'normal';
  approveTaskExecution(taskType: string, context: Record<string, unknown>): Promise<void>;
}

const SENSITIVE_APP = /(?:^|\b)(1password|bitwarden|lastpass|dashlane|keychain access|passwords?|ledger live|trezor suite|metamask)(?:\b|$)/i;
const SENSITIVE_SECURITY_SURFACE = /privacy\s*(?:&|and)\s*security|security\s*&\s*privacy|login items|filevault|screen recording|accessibility permissions?/i;
const SENSITIVE_FINANCIAL_TARGET = /(?:^|[.\s_-])(wallet|crypto wallet)(?:$|[.\s_-])/i;

/** Desktop-owned hard floor. Routine app names and ordinary web hosts deliberately stay allowed. */
export function isSensitiveMacTarget(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const target = value.trim();
  return !!target && (SENSITIVE_APP.test(target)
    || SENSITIVE_SECURITY_SURFACE.test(target)
    || SENSITIVE_FINANCIAL_TARGET.test(target));
}

function sensitiveContextTarget(context: Record<string, unknown>): string | null {
  for (const key of ['app', 'appName', 'bundleId', 'host', 'url']) {
    const value = context[key];
    if (isSensitiveMacTarget(value)) return String(value);
  }
  const target = context.target;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    for (const value of Object.values(target as Record<string, unknown>)) {
      if (isSensitiveMacTarget(value)) return String(value);
    }
  }
  return null;
}

export function assertProviderHostArchitecture(
  declared = process.env.BIMAX_HOST_ARCH,
  actual = process.arch,
): void {
  if (declared !== 'arm64' && declared !== 'x64') {
    throw new Error('Desktop capability provider refused: host architecture was not declared by Electron main');
  }
  if (declared !== actual) {
    throw new Error(`Desktop capability provider refused: ${declared} provider contract cannot run as ${actual}`);
  }
}

/**
 * Hard floor inside the Desktop provider. The generic engine governor is the user-visible outer
 * prompt; this inner authority proves the process was launched by Electron main, not standalone.
 */
export class DesktopCapabilityGovernor implements CapabilityGovernor {
  public readonly mode = 'normal' as const;

  public async approveTaskExecution(_taskType: string, context: Record<string, unknown>): Promise<void> {
    if (process.env.BIMAX_MAC_PROVIDER_AUTHORITY !== 'electron-main') {
      throw new Error('Desktop action refused: provider lacks Electron-main authority');
    }
    if (process.env.BIMAX_MAC_CONSENT_CHANNEL !== 'engine-governor') {
      throw new Error('Desktop action refused: provider lacks a user-consent channel');
    }
    const sensitive = sensitiveContextTarget(context);
    if (sensitive) throw new Error(`Desktop action refused: sensitive target ${sensitive}`);
  }
}
