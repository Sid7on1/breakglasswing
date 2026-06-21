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

/** Count non-overlapping occurrences of `needle` in `haystack`. (Was duplicated in edit/multiedit.) */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}
