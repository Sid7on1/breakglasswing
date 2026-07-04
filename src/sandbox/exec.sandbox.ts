import { execSync } from 'child_process';

// B3 — optional OS isolation for BashTool. On macOS we wrap commands in `sandbox-exec`
// (seatbelt) with a profile that allows reads/exec/network but restricts file WRITES to the
// workspace + temp dirs — so an agent command can't clobber files outside the project. Off
// by default (/governor sandbox on). Degrades gracefully: on non-macOS or when sandbox-exec
// is missing, commands run unsandboxed (with a one-time warning surfaced by the caller).

let enabled = false;
export function setSandboxEnabled(v: boolean): void { enabled = v; }
export function isSandboxEnabled(): boolean { return enabled; }

let availableCache: boolean | null = null;
/** True only on macOS with `sandbox-exec` present. Cached after first probe. */
export function sandboxAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  if (availableCache !== null) return availableCache;
  try {
    execSync('command -v sandbox-exec', { stdio: 'ignore' });
    availableCache = true;
  } catch {
    availableCache = false;
  }
  return availableCache;
}

/** Seatbelt profile: allow everything, then deny writes, then re-allow writes to cwd + temp. */
export function buildProfile(cwd: string): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    '(allow file-write*',
    `  (subpath ${JSON.stringify(cwd)})`,
    '  (subpath "/private/tmp")',
    '  (subpath "/private/var/folders")',
    '  (subpath "/tmp")',
    '  (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty"))',
  ].join('\n');
}

/**
 * If sandboxing is enabled and available, return the argv to run `command` under
 * `sandbox-exec` (for execFile, so no shell-quoting hazard). Returns null when sandboxing
 * does not apply, signalling the caller to run the command normally.
 */
export function sandboxArgv(command: string, cwd: string): string[] | null {
  if (!enabled || !sandboxAvailable()) return null;
  return ['-p', buildProfile(cwd), '/bin/sh', '-c', command];
}

// ---------------------------------------------------------------------------
// Sandbox FLOOR (BiMax v2) — mandatory isolation for autonomous episodes.
//
// Dream/self-play workers run model-chosen commands with nobody watching, so they get a
// floor that no toggle can lower: file writes confined to the episode worktree, network
// denied at the kernel, and a scrubbed child env (no API keys reachable from Bash).
// The floor is carried in the worker thread's own env copy (Worker({ env })), so it
// scopes to the episode without touching the parent session's settings.
// ---------------------------------------------------------------------------

export const FLOOR_ENV = 'BIMAX_SANDBOX_FLOOR';

/** The floor root for THIS thread (set for dream/autonomous workers), or null. */
export function floorRoot(): string | null {
  const v = process.env[FLOOR_ENV];
  return v && v.trim() ? v : null;
}

/** Seatbelt floor profile: no network at all; writes only inside the episode root + temp. */
export function buildFloorProfile(root: string): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    '(allow file-write*',
    `  (subpath ${JSON.stringify(root)})`,
    '  (subpath "/private/tmp")',
    '  (subpath "/private/var/folders")',
    '  (subpath "/tmp")',
    '  (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty"))',
  ].join('\n');
}

// Child processes of a floored episode never see the parent env (API keys, tokens):
// only what a build/test toolchain needs to function.
const FLOOR_ENV_ALLOWLIST = ['PATH', 'HOME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'USER', 'LOGNAME'];

export function floorChildEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of FLOOR_ENV_ALLOWLIST) {
    if (process.env[k] !== undefined) out[k] = process.env[k];
  }
  return out;
}

/**
 * When this thread has a floor but the OS can't enforce it (non-macOS or sandbox-exec
 * missing), autonomous Bash must NOT silently run with ambient authority — return the
 * reason to block it. `BIMAX_SANDBOX_FLOOR_SOFT=1` is the explicit opt-out (runs
 * unsandboxed but still with the scrubbed child env).
 */
export function floorBlockedReason(): string | null {
  if (!floorRoot()) return null;
  if (sandboxAvailable()) return null;
  if (process.env.BIMAX_SANDBOX_FLOOR_SOFT === '1') return null;
  return 'this is a sandboxed autonomous episode, but no OS sandbox is available on this platform ' +
    '(sandbox-exec not found). Bash is disabled for the episode; set BIMAX_SANDBOX_FLOOR_SOFT=1 to ' +
    'explicitly allow unsandboxed autonomous commands.';
}

/**
 * Argv to run `command` under the floor profile, or null when no floor applies (or it is
 * soft-bypassed / unenforceable — callers must consult floorBlockedReason() first).
 * The floor ignores the user-level `enabled` toggle: episodes cannot lower it.
 */
export function floorArgv(command: string): string[] | null {
  const root = floorRoot();
  if (!root || !sandboxAvailable()) return null;
  return ['-p', buildFloorProfile(root), '/bin/sh', '-c', command];
}

/** Test seam: override/reset the cached sandbox-exec availability probe. */
export function _setSandboxAvailableForTests(v: boolean | null): void {
  availableCache = v;
}
