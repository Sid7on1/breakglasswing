import * as path from 'path';
import * as os from 'os';

/**
 * Resolve a user/model-supplied path against the working dir, expanding a leading `~`.
 * Was copy-pasted (verbatim) in five tool files — keep the one definition here.
 */
export function resolvePath(p: string, cwd: string): string {
  if (!p) return cwd;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(p[1] === '/' ? 2 : 1));
  return path.resolve(cwd, p);
}

/**
 * Multi-repo workspace edit scoping: returns a refusal reason when `fullPath` lands inside a
 * repo registered READ-ONLY in the workspace manifest, else null. Purely additive — paths
 * outside any registered repo are always allowed (single-repo behavior unchanged). One helper
 * so every write-capable tool applies the identical rule.
 */
export function workspaceWriteBlock(fullPath: string): string | null {
  try {
    // Lazy require: path.util must stay dependency-light and usable before container boot.
    const { tryGetWorkspace } = require('../core/workspace.manager') as typeof import('../core/workspace.manager');
    const check = tryGetWorkspace()?.checkWrite(fullPath);
    return check && !check.allowed ? (check.reason || 'blocked by workspace scope') : null;
  } catch { return null; }
}

/** Count non-overlapping occurrences of `needle` in `haystack`. (Was duplicated in edit/multiedit.) */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}
