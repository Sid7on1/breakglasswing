import { execSync } from 'child_process';

/**
 * True if `cwd` is inside a git work tree. Unlike getGitStatus, this works on a freshly
 * `git init`-ed repo with no commits yet (unborn HEAD), so it's the right repo-existence
 * check for the GitTool / auto-commit.
 */
export function isGitRepo(cwd: string): boolean {
  try {
    return execSync('git rev-parse --is-inside-work-tree', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim() === 'true';
  } catch {
    return false;
  }
}

export interface GitStatus {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  unstaged: string[];
  ahead: number;
  behind: number;
}

export function getGitStatus(cwd: string): GitStatus | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
    const statusOut = execSync('git status --porcelain', { cwd, encoding: 'utf-8' });
    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const unstaged: string[] = [];
    for (const line of statusOut.split('\n').filter(Boolean)) {
      const staged = line[0];
      const file = line.slice(3);
      if (staged === 'M') modified.push(file);
      else if (staged === 'A') added.push(file);
      else if (staged === 'D') deleted.push(file);
      else if (line[1] !== ' ') unstaged.push(file);
    }
    // Ahead/behind only exist when the branch has an upstream; a local-only repo has none,
    // so isolate this lookup — its failure must not void the whole status.
    let ahead = 0, behind = 0;
    try {
      const branchOut = execSync('git rev-list --left-right --count HEAD...@{upstream}', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (branchOut.includes('\t')) [ahead, behind] = branchOut.split('\t').map(Number);
    } catch { /* no upstream — leave ahead/behind at 0 */ }
    return { branch, modified, added, deleted, unstaged, ahead, behind };
  } catch { return null; }
}

export function gitLog(cwd: string, count = 10): string {
  try {
    return execSync(`git log --oneline -${count}`, { cwd, encoding: 'utf-8' });
  } catch { return '(not a git repo)'; }
}

export function gitDiff(cwd: string, file?: string): string {
  try {
    const arg = file ? ` -- "${file}"` : '';
    return execSync(`git diff${arg}`, { cwd, encoding: 'utf-8' });
  } catch { return '(diff failed)'; }
}
