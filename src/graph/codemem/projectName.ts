// Replicates codebase-memory-mcp's project-name slug (src/pipeline/fqn.c
// `cbm_project_name_from_path`). The engine names each project by slugging the
// repo's absolute path, and every query tool requires that exact name — so we
// compute it the same way to target the right project DB. We still confirm the
// name against list_projects at runtime; this is the deterministic first guess.
//
// Algorithm (kept byte-for-byte in step with the C):
//   1. every char outside [A-Za-z0-9._-] -> '-'
//   2. collapse runs of '-' and runs of '.'
//   3. trim leading '-' and '.'
//   4. trim trailing '-'
//   5. empty result -> "root"

export function projectNameFromPath(absPath: string): string {
  if (!absPath) return 'root';

  // Map unsafe chars to '-'. (On POSIX the separator '/' is unsafe and becomes '-',
  // matching the C after its path-separator normalization.)
  let s = '';
  for (const ch of absPath) {
    s += /[A-Za-z0-9._-]/.test(ch) ? ch : '-';
  }

  // Collapse consecutive '-' and consecutive '.'.
  let collapsed = '';
  let prev = '';
  for (const ch of s) {
    if ((ch === '-' && prev === '-') || (ch === '.' && prev === '.')) continue;
    collapsed += ch;
    prev = ch;
  }

  // Trim leading '-'/'.' then trailing '-'.
  collapsed = collapsed.replace(/^[-.]+/, '').replace(/-+$/, '');
  return collapsed === '' ? 'root' : collapsed;
}
