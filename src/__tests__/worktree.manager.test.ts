import { WorktreeManager } from '../evolution/worktree.manager';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

describe('WorktreeManager — lifecycle against a real temp git repo', () => {
  let repo: string;
  let mgr: WorktreeManager;
  let sentinel: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-wt-'));
    git(['init', '-q'], repo);
    git(['config', 'user.email', 'test@example.com'], repo);
    git(['config', 'user.name', 'Test'], repo);
    git(['config', 'commit.gpgsign', 'false'], repo);
    fs.writeFileSync(path.join(repo, 'README.md'), 'seed\n');
    git(['add', '-A'], repo);
    git(['commit', '-q', '-m', 'seed'], repo);
    mgr = new WorktreeManager(repo);
    // A file a shell-injection would create; it must never appear.
    sentinel = path.join(os.tmpdir(), `bgw-pwned-${process.pid}-${Date.now()}`);
    if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
  });

  afterEach(() => {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
    try { if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel); } catch { /* ignore */ }
  });

  it('creates a worktree, detects changes, commits, and removes it', async () => {
    const branch = 'swarm/abc/task-1';
    const { worktreePath } = await mgr.createWorktree(branch, 'HEAD');
    expect(fs.existsSync(worktreePath)).toBe(true);

    await expect(mgr.hasChanges(worktreePath)).resolves.toBe(false);
    fs.writeFileSync(path.join(worktreePath, 'hello.txt'), 'hi\n');
    await expect(mgr.hasChanges(worktreePath)).resolves.toBe(true);

    await mgr.commitChanges(worktreePath, 'feat: add hello');
    await expect(mgr.hasChanges(worktreePath)).resolves.toBe(false);
    expect(git(['log', '-1', '--pretty=%s'], worktreePath)).toBe('feat: add hello');

    await mgr.removeWorktree(branch, true);
    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(git(['branch', '--list', branch], repo)).toBe('');
  });

  it('does NOT execute shell metacharacters in a commit message (injection-safe)', async () => {
    const branch = 'swarm/abc/task-2';
    const { worktreePath } = await mgr.createWorktree(branch, 'HEAD');
    fs.writeFileSync(path.join(worktreePath, 'f.txt'), 'x\n');

    const evilMessage = `fix: $(touch ${sentinel}) "quoted" \`backtick\` && echo nope`;
    await mgr.commitChanges(worktreePath, evilMessage);

    // The message is stored literally and no embedded command ran.
    expect(git(['log', '-1', '--pretty=%s'], worktreePath)).toBe(evilMessage);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it('passes a branch name with shell metacharacters through literally', async () => {
    // ; & $ are valid in git ref names but would be split/expanded by a shell — the old
    // string-interpolated command would have created the wrong branch (just "inj/a").
    // execFile passes the whole name as one argv entry.
    const branch = 'inj/a;b&c$d';
    const { worktreePath } = await mgr.createWorktree(branch, 'HEAD');
    expect(fs.existsSync(worktreePath)).toBe(true);
    // The branch exists under its full literal name, proving no shell splitting occurred.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)).toBe(branch);
    await mgr.removeWorktree(branch, true);
    expect(git(['branch', '--list', branch], repo)).toBe('');
  });

  it('merges a worktree branch back into the main checkout', async () => {
    const branch = 'spec/abc/arm-1';
    const { worktreePath } = await mgr.createWorktree(branch, 'HEAD');
    fs.writeFileSync(path.join(worktreePath, 'merged.txt'), 'data\n');
    await mgr.commitChanges(worktreePath, 'add merged file');

    await mgr.mergeWorktree(branch);
    expect(fs.existsSync(path.join(repo, 'merged.txt'))).toBe(true);
  });
});
