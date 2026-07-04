import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildProfile, buildBwrapArgv, sandboxArgv, sandboxBin, setSandboxEnabled, sandboxAvailable, sandboxBackend } from '../sandbox/exec.sandbox';
import { createBashTool } from '../tools/implementations/bash.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

afterEach(() => setSandboxEnabled(false));

describe('exec.sandbox (B3, pure)', () => {
  it('builds a seatbelt profile allowing writes to cwd', () => {
    const p = buildProfile('/work/dir');
    expect(p).toContain('(deny file-write*)');
    expect(p).toContain('(subpath "/work/dir")');
  });

  it('buildBwrapArgv binds the FS read-only, rebinds cwd + temp writable, ends in sh -c', () => {
    const argv = buildBwrapArgv('/work/dir', false);
    expect(argv.slice(0, 3)).toEqual(['--ro-bind', '/', '/']); // whole FS read-only
    expect(argv).toContain('--die-with-parent');
    // cwd is re-bound read-write via --bind-try, so writes there succeed.
    const i = argv.indexOf('/work/dir');
    expect(argv[i - 1]).toBe('--bind-try');
    expect(argv[i + 1]).toBe('/work/dir');
    expect(argv).not.toContain('--unshare-net'); // network allowed in the regular profile
    expect(argv.slice(-2)).toEqual(['/bin/sh', '-c']);
  });

  it('buildBwrapArgv adds --unshare-net for the network-denying floor', () => {
    expect(buildBwrapArgv('/ep/root', true)).toContain('--unshare-net');
  });

  it('sandboxArgv is null when disabled', () => {
    setSandboxEnabled(false);
    expect(sandboxArgv('ls', '/tmp')).toBeNull();
  });

  it('sandboxArgv matches the platform backend when enabled', () => {
    setSandboxEnabled(true);
    const argv = sandboxArgv('ls', '/tmp');
    switch (sandboxBackend()) {
      case 'seatbelt':
        expect(argv).toEqual(['-p', expect.any(String), '/bin/sh', '-c', 'ls']);
        expect(sandboxBin()).toBe('sandbox-exec');
        break;
      case 'bwrap':
        expect(argv?.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
        expect(argv?.[argv.length - 1]).toBe('ls');
        expect(sandboxBin()).toBe('bwrap');
        break;
      default: // no backend installed on this platform
        expect(argv).toBeNull();
    }
  });
});

// The end-to-end isolation behaviour runs on any platform with an OS sandbox backend: macOS
// seatbelt, or Linux bwrap (installed in CI). Skips where no backend is present.
const sandboxedIt = sandboxAvailable() ? it : it.skip;

describe(`BashTool × sandbox (B3, ${sandboxBackend() ?? 'no'} backend)`, () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-sbx-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  sandboxedIt('allows writes inside the workspace', async () => {
    setSandboxEnabled(true);
    const tool = createBashTool(governor);
    await tool.execute({ command: 'echo hi > inside.txt' }, { cwd: dir });
    expect(fs.existsSync(path.join(dir, 'inside.txt'))).toBe(true);
  });

  sandboxedIt('denies writes outside the workspace (home dir)', async () => {
    setSandboxEnabled(true);
    const target = path.join(os.homedir(), `.bgw_sbtest_${Date.now()}`);
    const tool = createBashTool(governor);
    await tool.execute({ command: `echo hi > "${target}"` }, { cwd: dir }).catch(() => { /* expected to fail */ });
    const leaked = fs.existsSync(target);
    if (leaked) fs.rmSync(target, { force: true });
    expect(leaked).toBe(false);
  });
});
