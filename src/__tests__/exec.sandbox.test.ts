import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildProfile, sandboxArgv, setSandboxEnabled, sandboxAvailable } from '../sandbox/exec.sandbox';
import { createBashTool } from '../tools/implementations/bash.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

afterEach(() => setSandboxEnabled(false));

describe('exec.sandbox (B3, pure)', () => {
  it('builds a profile allowing writes to cwd', () => {
    const p = buildProfile('/work/dir');
    expect(p).toContain('(deny file-write*)');
    expect(p).toContain('(subpath "/work/dir")');
  });

  it('sandboxArgv is null when disabled', () => {
    setSandboxEnabled(false);
    expect(sandboxArgv('ls', '/tmp')).toBeNull();
  });

  it('sandboxArgv is null on non-macOS even when enabled', () => {
    setSandboxEnabled(true);
    const argv = sandboxArgv('ls', '/tmp');
    if (process.platform !== 'darwin') {
      expect(argv).toBeNull();
    } else {
      expect(argv).toEqual(['-p', expect.any(String), '/bin/sh', '-c', 'ls']);
    }
  });
});

// The end-to-end isolation behaviour only exists on macOS with sandbox-exec.
const darwinIt = (process.platform === 'darwin' && sandboxAvailable()) ? it : it.skip;

describe('BashTool × sandbox (B3, darwin only)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-sbx-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  darwinIt('allows writes inside the workspace', async () => {
    setSandboxEnabled(true);
    const tool = createBashTool(governor);
    await tool.execute({ command: 'echo hi > inside.txt' }, { cwd: dir });
    expect(fs.existsSync(path.join(dir, 'inside.txt'))).toBe(true);
  });

  darwinIt('denies writes outside the workspace (home dir)', async () => {
    setSandboxEnabled(true);
    const target = path.join(os.homedir(), `.bgw_sbtest_${Date.now()}`);
    const tool = createBashTool(governor);
    await tool.execute({ command: `echo hi > "${target}"` }, { cwd: dir }).catch(() => { /* expected to fail */ });
    const leaked = fs.existsSync(target);
    if (leaked) fs.rmSync(target, { force: true });
    expect(leaked).toBe(false);
  });
});
