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
