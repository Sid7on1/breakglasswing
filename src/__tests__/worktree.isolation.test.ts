import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWorktree, settleWorktree, validateWorktree, worktreeChangedPaths } from '../core/worktree.manager';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

describe('worktree isolation for sub-agents (core/worktree.manager)', () => {
  let repo: string;

  beforeEach(() => {
    // realpath: git resolves /var -> /private/var on macOS, so paths must be compared resolved.
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-wt-')));
    git(repo, 'init', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@bimax');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'init');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('creates a worktree on its own branch under .bimax/worktrees', () => {
    const wt = createWorktree(repo, 'subagent-abcd1234-rest-of-uuid');
    expect(wt).not.toBeNull();
    expect(wt!.path).toBe(path.join(repo, '.bimax', 'worktrees', 'abcd1234'));
    expect(wt!.branch).toBe('bimax/sub-abcd1234');
    expect(fs.existsSync(path.join(wt!.path, 'a.txt'))).toBe(true);
    // The worktree is checked out on its own branch, not the caller's.
    expect(git(wt!.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('bimax/sub-abcd1234');
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  it('settle removes worktree AND branch when the agent changed nothing', () => {
    const wt = createWorktree(repo, 'subagent-clean111');
    const res = settleWorktree(wt!);
    expect(res).toEqual({ removed: true, changed: false, note: '' });
    expect(fs.existsSync(wt!.path)).toBe(false);
    expect(git(repo, 'branch', '--list', 'bimax/sub-*')).toBe('');
  });

  it('settle keeps the worktree and reports it when the agent made edits', () => {
    const wt = createWorktree(repo, 'subagent-dirty222');
    fs.writeFileSync(path.join(wt!.path, 'b.txt'), 'sub-agent work\n');
    const res = settleWorktree(wt!);
    expect(res.removed).toBe(false);
    expect(res.changed).toBe(true);
    expect(res.note).toContain(wt!.path);
    expect(res.note).toContain(wt!.branch);
    // The work survives, and the parent checkout never saw the edit.
    expect(fs.existsSync(path.join(wt!.path, 'b.txt'))).toBe(true);
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(false);
  });

  it('settle keeps the worktree when the agent committed on its branch', () => {
    const wt = createWorktree(repo, 'subagent-commit33');
    fs.writeFileSync(path.join(wt!.path, 'c.txt'), 'committed work\n');
    git(wt!.path, 'add', '.');
    git(wt!.path, 'commit', '-m', 'sub-agent commit');
    const res = settleWorktree(wt!);
    expect(res.changed).toBe(true);
    expect(git(repo, 'branch', '--list', 'bimax/sub-*')).toContain('bimax/sub-commit33');
  });

  it('produces an engine-observed manifest of committed and uncommitted paths', () => {
    const wt = createWorktree(repo, 'subagent-manifest1');
    fs.mkdirSync(path.join(wt!.path, 'src'), { recursive: true });
    fs.writeFileSync(path.join(wt!.path, 'src', 'committed.ts'), 'export {};\n');
    git(wt!.path, 'add', '.');
    git(wt!.path, 'commit', '-m', 'committed path');
    fs.writeFileSync(path.join(wt!.path, 'uncommitted.txt'), 'dirty\n');
    expect(worktreeChangedPaths(wt!)).toEqual(['src/committed.ts', 'uncommitted.txt']);
  });

  it('validates the durable identity of a crash-recoverable worktree', () => {
    const wt = createWorktree(repo, 'subagent-recover1')!;
    expect(validateWorktree(wt)).toBe(true);
    expect(validateWorktree({ ...wt, branch: 'bimax/sub-wrong' })).toBe(false);
  });

  it('parallel worktrees are independent — edits never collide', () => {
    const a = createWorktree(repo, 'subagent-para0001');
    const b = createWorktree(repo, 'subagent-para0002');
    fs.writeFileSync(path.join(a!.path, 'a.txt'), 'agent A version\n');
    fs.writeFileSync(path.join(b!.path, 'a.txt'), 'agent B version\n');
    expect(fs.readFileSync(path.join(a!.path, 'a.txt'), 'utf-8')).toContain('agent A');
    expect(fs.readFileSync(path.join(b!.path, 'a.txt'), 'utf-8')).toContain('agent B');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8')).toBe('hello\n');
  });

  it('returns null (unisolated fallback) outside a git repo', () => {
    const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-norepo-'));
    try {
      expect(createWorktree(notRepo, 'subagent-x')).toBeNull();
    } finally {
      fs.rmSync(notRepo, { recursive: true, force: true });
    }
  });

  it('settle tolerates a worktree the agent already deleted', () => {
    const wt = createWorktree(repo, 'subagent-gone4444');
    fs.rmSync(wt!.path, { recursive: true, force: true });
    const res = settleWorktree(wt!);
    expect(res.removed).toBe(true);
    expect(res.changed).toBe(false);
  });
});
