import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createGitTool } from '../tools/implementations/git.tool';
import { setGitAutoCommitEnabled, gitAutoCommitHook } from '../tools/git.autocommit';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-git-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}
function lastLog(dir: string): string {
  try { return execFileSync('git', ['log', '--oneline', '-1'], { cwd: dir, encoding: 'utf-8' }).trim(); }
  catch { return ''; }
}

describe('GitTool (B1)', () => {
  let dir: string;
  beforeEach(() => { dir = initRepo(); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('commits with a message and reports status', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
    const tool = createGitTool(governor);

    const status = await tool.execute({ action: 'status' }, { cwd: dir });
    expect(status).toMatch(/untracked \?1|modified|On /);

    const res = await tool.execute({ action: 'commit', message: 'feat: add a.txt' }, { cwd: dir });
    expect(res).not.toMatch(/failed|Error/i);
    expect(lastLog(dir)).toContain('feat: add a.txt');
  });

  it('rejects commit without a message', async () => {
    const tool = createGitTool(governor);
    const res = await tool.execute({ action: 'commit', message: '  ' }, { cwd: dir });
    expect(res).toMatch(/requires a non-empty/);
  });

  it('errors politely outside a git repo', async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-norepo-'));
    const tool = createGitTool(governor);
    const res = await tool.execute({ action: 'status' }, { cwd: nonRepo });
    expect(res).toMatch(/not a git repository/);
    fs.rmSync(nonRepo, { recursive: true, force: true });
  });
});

describe('gitAutoCommitHook (B1)', () => {
  let dir: string;
  beforeEach(() => { dir = initRepo(); });
  afterEach(() => { setGitAutoCommitEnabled(false); fs.rmSync(dir, { recursive: true, force: true }); });

  it('commits after an edit when enabled', async () => {
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n');
    setGitAutoCommitEnabled(true);
    await gitAutoCommitHook('EditFileTool', { path: 'f.txt' }, 'Edited f.txt (1 replacement)', { cwd: dir });
    expect(lastLog(dir)).toContain('bimax auto: EditFileTool');
  });

  it('does nothing when disabled', async () => {
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n');
    setGitAutoCommitEnabled(false);
    await gitAutoCommitHook('EditFileTool', { path: 'f.txt' }, 'Edited f.txt', { cwd: dir });
    expect(lastLog(dir)).not.toContain('bimax auto');
  });

  it('skips when the edit result indicates failure', async () => {
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n');
    setGitAutoCommitEnabled(true);
    await gitAutoCommitHook('EditFileTool', { path: 'f.txt' }, 'Edit to f.txt rejected by user. No changes were made.', { cwd: dir });
    expect(lastLog(dir)).not.toContain('bimax auto');
  });
});
