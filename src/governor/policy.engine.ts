import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils';

export const SafetyPolicy = {
  maxDailySpendUsd: parseFloat(process.env.MAX_DAILY_SPEND || '5.00'),
  allowedWorkspace: process.env.WORKSPACE_ROOT || process.cwd(),
  forbiddenExtensions: ['.env', '.pem', '.key', '.p12'],
  forbiddenPaths: ['/etc', '/system', '/var', '/root', '/.ssh', '/proc'],
  // Path-based patterns — only match specific filename patterns, never broad words like "password"
  // or "secret" which would block legitimate code files (e.g. password_reset.ts, secret_key.ts).
  // Extension-based blocks (.env, .pem, .key) are already handled by forbiddenExtensions above.
  forbiddenRegex: [/id_rsa/i]
};

const POLICY_FILE = path.join(process.cwd(), '.breakglass/policy.json');

let policyWatcher: fs.FSWatcher | null = null;

export function initPolicyEngine() {
  if (fs.existsSync(POLICY_FILE)) {
    loadPolicy();
  }

  // Watch for runtime changes (GOV-004). Watch the .breakglass DIRECTORY, not cwd: fs.watch on a
  // directory is non-recursive, so watching cwd never reported changes to the nested
  // .breakglass/policy.json. Directory watches emit the bare basename ("policy.json").
  try {
    const policyDir = path.dirname(POLICY_FILE);
    if (fs.existsSync(policyDir)) {
      policyWatcher = fs.watch(policyDir, (_eventType, filename) => {
        if (filename === 'policy.json') {
          setTimeout(loadPolicy, 100); // small debounce — editors write in bursts
        }
      });
      // Don't let the watcher keep the process alive
      policyWatcher.unref();
    }
  } catch (e) {
    // Ignore watch errors if platform doesn't support it
  }
}

export function destroyPolicyEngine() {
  if (policyWatcher) {
    policyWatcher.close();
    policyWatcher = null;
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
