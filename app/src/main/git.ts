import { execFile } from 'node:child_process';

/**
 * Electron-native git reader for the Review panel — status/diff/branches/log only, exactly like
 * competitor shells poll git from their main process. All WRITES (commit, checkout) go through
 * the engine's /git command instead, so the ledger and attribution pipeline see them.
 */

export interface GitFile {
  path: string;
  status: string;      // one letter: M A D R C ? (worktree state wins over index)
  staged: boolean;     // true when the index has changes for this path
  insertions: number;
  deletions: number;
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFile[];
}

function run(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(stdout);
    });
  });
}

async function numstat(cwd: string, staged: boolean): Promise<Map<string, { ins: number; del: number }>> {
  const map = new Map<string, { ins: number; del: number }>();
  try {
    const out = await run(cwd, staged ? ['diff', '--cached', '--numstat'] : ['diff', '--numstat']);
    for (const line of out.split('\n')) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const prev = map.get(m[3]) ?? { ins: 0, del: 0 };
      map.set(m[3], {
        ins: prev.ins + (m[1] === '-' ? 0 : Number(m[1])),
        del: prev.del + (m[2] === '-' ? 0 : Number(m[2])),
      });
    }
  } catch { /* not a repo / no HEAD yet */ }
  return map;
}

export async function gitStatus(cwd: string): Promise<GitStatusResult | null> {
  let out: string;
  try {
    out = await run(cwd, ['status', '--porcelain=v2', '--branch']);
  } catch {
    return null; // not a git repository
  }

  const res: GitStatusResult = { branch: '', ahead: 0, behind: 0, files: [] };
  const [unstagedCounts, stagedCounts] = await Promise.all([numstat(cwd, false), numstat(cwd, true)]);
  const counts = (p: string): { insertions: number; deletions: number } => {
    const a = unstagedCounts.get(p);
    const b = stagedCounts.get(p);
    return { insertions: (a?.ins ?? 0) + (b?.ins ?? 0), deletions: (a?.del ?? 0) + (b?.del ?? 0) };
  };

  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) { res.branch = line.slice(14).trim(); continue; }
    if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { res.ahead = Number(m[1]); res.behind = Number(m[2]); }
      continue;
    }
    // 1 = ordinary change, 2 = rename/copy ("newPath\toldPath"), ? = untracked
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ');
      const xy = parts[1]; // e.g. ".M", "M.", "MM", "R."
      const pathField = parts.slice(line.startsWith('2 ') ? 9 : 8).join(' ');
      const p = pathField.split('\t')[0];
      const worktree = xy[1] !== '.' ? xy[1] : '';
      const index = xy[0] !== '.' ? xy[0] : '';
      res.files.push({
        path: p,
        status: worktree || index || 'M',
        staged: index !== '',
        ...counts(p),
      });
    } else if (line.startsWith('? ')) {
      res.files.push({ path: line.slice(2), status: '?', staged: false, insertions: 0, deletions: 0 });
    }
  }
  res.files.sort((a, b) => a.path.localeCompare(b.path));
  return res;
}

/** Full pending change for one file (staged + unstaged vs HEAD); untracked diffs against /dev/null. */
export async function gitDiff(cwd: string, file: string, untracked: boolean): Promise<string> {
  try {
    if (untracked) {
      // --no-index exits 1 when files differ — that's the success path here.
      return await run(cwd, ['diff', '--no-index', '--', '/dev/null', file]);
    }
    return await run(cwd, ['diff', 'HEAD', '--', file]);
  } catch {
    try { return await run(cwd, ['diff', '--', file]); } catch { return ''; }
  }
}

export async function gitBranches(cwd: string): Promise<{ current: string; all: string[] }> {
  try {
    const [cur, list] = await Promise.all([
      run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      run(cwd, ['branch', '--format=%(refname:short)']),
    ]);
    return { current: cur.trim(), all: list.split('\n').map((s) => s.trim()).filter(Boolean) };
  } catch {
    return { current: '', all: [] };
  }
}

export async function gitLog(cwd: string, n: number): Promise<{ hash: string; subject: string; when: string }[]> {
  try {
    const out = await run(cwd, ['log', `-${Math.max(1, Math.min(n, 100))}`, '--format=%h%x09%s%x09%cr']);
    return out.split('\n').filter(Boolean).map((line) => {
      const [hash, subject, when] = line.split('\t');
      return { hash, subject: subject ?? '', when: when ?? '' };
    });
  } catch {
    return [];
  }
}
