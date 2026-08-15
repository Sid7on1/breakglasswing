export interface MacCapabilityConfig {
  computerPip: boolean;
  computerVisible: boolean;
  computerRecord: boolean;
  computerApprovals: 'always' | 'high-impact-only';
}

function enabled(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !/^(0|false|off|no)$/i.test(value);
}

/** Provider configuration is injected by Electron main, never by model arguments. */
export async function loadMacCapabilityConfig(): Promise<MacCapabilityConfig> {
  return {
    computerPip: enabled('BIMAX_COMPUTER_PIP', false),
    computerVisible: enabled('BIMAX_COMPUTER_VISIBLE', true),
    computerRecord: enabled('BIMAX_COMPUTER_RECORD', false),
    computerApprovals: process.env.BIMAX_COMPUTER_APPROVALS === 'high-impact-only'
      ? 'high-impact-only' : 'always',
  };
}

export const loadConfig = loadMacCapabilityConfig;
export function __resetConfigForTests(): void { /* environment-backed: no cache */ }
