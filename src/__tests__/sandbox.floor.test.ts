import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FLOOR_ENV, floorRoot, buildFloorProfile, floorChildEnv, floorArgv, floorBlockedReason,
  sandboxAvailable, _setSandboxAvailableForTests,
} from '../sandbox/exec.sandbox';
import { createBashTool } from '../tools/implementations/bash.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

const savedFloor = process.env[FLOOR_ENV];
const savedSoft = process.env.BIMAX_SANDBOX_FLOOR_SOFT;
afterEach(() => {
  if (savedFloor === undefined) delete process.env[FLOOR_ENV]; else process.env[FLOOR_ENV] = savedFloor;
  if (savedSoft === undefined) delete process.env.BIMAX_SANDBOX_FLOOR_SOFT; else process.env.BIMAX_SANDBOX_FLOOR_SOFT = savedSoft;
  _setSandboxAvailableForTests(null);
});

describe('sandbox floor (v2) — pure', () => {
  it('floor profile denies ALL network and confines writes to the episode root', () => {
    const p = buildFloorProfile('/work/episode');
    expect(p).toContain('(deny network*)');
    expect(p).toContain('(deny file-write*)');
    expect(p).toContain('(subpath "/work/episode")');
  });

  it('floorRoot reflects the thread env flag', () => {
    delete process.env[FLOOR_ENV];
    expect(floorRoot()).toBeNull();
    process.env[FLOOR_ENV] = '/work/episode';
    expect(floorRoot()).toBe('/work/episode');
  });

  it('floorChildEnv strips everything but the toolchain allowlist (no API keys reach children)', () => {
    process.env.BGW_FAKE_SECRET_KEY = 'sk-super-secret';
    try {
      const env = floorChildEnv();
      expect(env.BGW_FAKE_SECRET_KEY).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.HOME).toBe(process.env.HOME);
    } finally {
      delete process.env.BGW_FAKE_SECRET_KEY;
    }
  });

  it('floorArgv is null without a floor, argv with one (when the OS can enforce it)', () => {
    delete process.env[FLOOR_ENV];
    expect(floorArgv('ls')).toBeNull();
    process.env[FLOOR_ENV] = '/work/episode';
    _setSandboxAvailableForTests(true);
    const argv = floorArgv('ls');
    if (process.platform === 'darwin') {
      expect(argv).toEqual(['-p', expect.stringContaining('(deny network*)'), '/bin/sh', '-c', 'ls']);
    } else if (process.platform === 'linux') {
      expect(argv?.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
      expect(argv).toContain('--unshare-net');
      expect(argv?.slice(-3)).toEqual(['/bin/sh', '-c', 'ls']);
    } else {
      expect(argv).toBeNull();
    }
  });

  it('an unenforceable floor BLOCKS (never silently lowers), unless explicitly soft-bypassed', () => {
    process.env[FLOOR_ENV] = '/work/episode';
    _setSandboxAvailableForTests(false);
    expect(floorBlockedReason()).toMatch(/no OS sandbox/);
    expect(floorArgv('ls')).toBeNull();
    process.env.BIMAX_SANDBOX_FLOOR_SOFT = '1';
    expect(floorBlockedReason()).toBeNull();
    delete process.env.BIMAX_SANDBOX_FLOOR_SOFT;
    _setSandboxAvailableForTests(true);
    expect(floorBlockedReason()).toBeNull();
  });
});

describe('BashTool × floor — blocked when unenforceable', () => {
  it('refuses to run autonomous commands without an OS sandbox', async () => {
    process.env[FLOOR_ENV] = '/work/episode';
    _setSandboxAvailableForTests(false);
    await expect(
      createBashTool(governor).execute({ command: 'echo pwned' }, { cwd: process.cwd() }),
    ).rejects.toThrow(/no OS sandbox/);
  });
});

// End-to-end enforcement exists only on macOS with sandbox-exec present.
const darwinIt = (process.platform === 'darwin' && sandboxAvailable()) ? it : it.skip;

describe('BashTool × floor (darwin only, real kernel enforcement)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-floor-'));
    process.env[FLOOR_ENV] = fs.realpathSync(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  darwinIt('allows writes inside the episode root', async () => {
    await createBashTool(governor).execute({ command: 'echo hi > inside.txt' }, { cwd: dir });
    expect(fs.existsSync(path.join(dir, 'inside.txt'))).toBe(true);
  });

  darwinIt('denies writes outside the episode root even though no user toggle is on', async () => {
    const target = path.join(os.homedir(), `.bgw_floortest_${Date.now()}`);
    await createBashTool(governor)
      .execute({ command: `echo hi > "${target}"` }, { cwd: dir })
      .catch(() => { /* expected */ });
    const leaked = fs.existsSync(target);
    if (leaked) fs.rmSync(target, { force: true });
    expect(leaked).toBe(false);
  });

  darwinIt('denies network at the kernel', async () => {
    const res: any = await createBashTool(governor)
      .execute({ command: 'python3 -c "import socket; s=socket.socket(); s.settimeout(3); s.connect((\'1.1.1.1\', 53))" && echo CONNECTED' }, { cwd: dir })
      .catch((e: any) => String(e?.message || e));
    expect(String(res)).not.toContain('CONNECTED');
  });

  darwinIt('scrubs the child env — secrets in the worker env never reach commands', async () => {
    process.env.BGW_FAKE_SECRET_KEY = 'sk-super-secret';
    try {
      const res: any = await createBashTool(governor)
        .execute({ command: 'printenv BGW_FAKE_SECRET_KEY || echo NO_SECRET' }, { cwd: dir });
      expect(String(res)).toContain('NO_SECRET');
      expect(String(res)).not.toContain('sk-super-secret');
    } finally {
      delete process.env.BGW_FAKE_SECRET_KEY;
    }
  });
});
