import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils';

export const SafetyPolicy = {
  maxDailySpendUsd: parseFloat(process.env.MAX_DAILY_SPEND || '5.00'),
  allowedWorkspace: process.env.WORKSPACE_ROOT || process.cwd(),
  forbiddenExtensions: ['.env', '.pem', '.key', '.p12'],
  forbiddenPaths: ['/etc', '/system', '/var', '/root', '/.ssh', '/proc'],
  forbiddenRegex: [/id_rsa/i, /\.key$/i, /\.pem$/i, /\.env$/i, /password/i, /secret/i]
};

const POLICY_FILE = path.join(process.cwd(), '.breakglass_policy.json');

export function initPolicyEngine() {
  if (fs.existsSync(POLICY_FILE)) {
    loadPolicy();
  }

  // Watch for runtime changes (GOV-004)
  try {
    fs.watch(process.cwd(), (eventType, filename) => {
      if (filename === '.breakglass_policy.json') {
        // Debounce or just load directly
        setTimeout(loadPolicy, 100); 
      }
    });
  } catch (e) {
    // Ignore watch errors if platform doesn't support it
  }
}

function loadPolicy() {
  try {
    if (!fs.existsSync(POLICY_FILE)) return;
    const data = fs.readFileSync(POLICY_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    
    if (parsed.maxDailySpendUsd !== undefined) SafetyPolicy.maxDailySpendUsd = parsed.maxDailySpendUsd;
    if (parsed.allowedWorkspace !== undefined) SafetyPolicy.allowedWorkspace = parsed.allowedWorkspace;
    if (parsed.forbiddenExtensions) SafetyPolicy.forbiddenExtensions = parsed.forbiddenExtensions;
    if (parsed.forbiddenPaths) SafetyPolicy.forbiddenPaths = parsed.forbiddenPaths;
    
    if (parsed.forbiddenRegex) {
      SafetyPolicy.forbiddenRegex = parsed.forbiddenRegex.map((r: string) => new RegExp(r, 'i'));
    }
    
    Logger.info(`[PolicyEngine] Dynamically reloaded SafetyPolicy from disk.`);
  } catch (e: any) {
    Logger.warn(`[PolicyEngine] Failed to reload dynamic policy: ${e.message}`);
  }
}

// Auto-init on load
initPolicyEngine();
