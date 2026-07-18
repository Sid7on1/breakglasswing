import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  planProxyStartup, acquireProxyLock, readProxyLock, releaseProxyLock,
  isPortFree, findFreePort, unrefSidecarHandles,
} from '../memory/headroomProxy';

// The sidecar singleton must never let two engines race for :8788. These tests exercise the pure
// planner + the lockfile primitives directly — no Python venv, no real spawn — so the race logic is
// verified deterministically (the real spawn path needs a provisioned venv and is covered manually).

describe('headroom proxy — cross-process singleton', () => {
  let dir: string;
  let lock: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-hr-')); lock = path.join(dir, 'proxy.lock'); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('reuses a healthy sidecar recorded in the lockfile (spawns nothing)', async () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: 424242, port: 8788, startedAt: Date.now() }));
    const plan = await planProxyStartup({
      lockFile: lock, defaultPort: 8788,
      healthy: async () => true, portFree: async () => false, freePort: async () => 49999,
    });
    expect(plan).toEqual({ action: 'reuse', port: 8788 });
  });

  it('spawns on the default port when it is free and no live sidecar exists', async () => {
    const plan = await planProxyStartup({
      lockFile: lock, defaultPort: 8788,
      healthy: async () => false, portFree: async () => true, freePort: async () => 49999,
    });
    expect(plan).toEqual({ action: 'spawn', port: 8788 });
  });

  it('spawns on a DYNAMIC port when :8788 is already taken (no collision)', async () => {
    // Stale lock present (unhealthy) AND the default port is occupied by something else.
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, port: 8788, startedAt: 1 }));
    const plan = await planProxyStartup({
      lockFile: lock, defaultPort: 8788,
      healthy: async () => false, portFree: async () => false, freePort: async () => 49999,
    });
    expect(plan).toEqual({ action: 'spawn', port: 49999 });
  });

  it('defers to a user-provided external proxy', async () => {
    const plan = await planProxyStartup({
      lockFile: lock, defaultPort: 8788, externalUrl: 'http://10.0.0.5:9000',
      healthy: async () => false, portFree: async () => true, freePort: async () => 49999,
    });
    expect(plan.action).toBe('external');
  });

  it('lock acquire is atomic: the second claimant loses', () => {
    expect(acquireProxyLock(8788, lock)).toBe(true);
    expect(acquireProxyLock(8788, lock)).toBe(false); // already held
    const held = readProxyLock(lock);
    expect(held?.port).toBe(8788);
    expect(held?.pid).toBe(process.pid);
  });

  it('releaseProxyLock only removes a lock this process owns', () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: 111111, port: 8788, startedAt: Date.now() })); // someone else's
    releaseProxyLock(lock);
    expect(fs.existsSync(lock)).toBe(true); // not ours → left alone
    fs.rmSync(lock, { force: true });
    acquireProxyLock(8788, lock); // now ours
    releaseProxyLock(lock);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('findFreePort returns a bindable port, and isPortFree agrees it is free', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(await isPortFree(port)).toBe(true);
  });

  it('isPortFree reports false for a port currently in use', async () => {
    const net = require('net');
    const srv = net.createServer();
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const busy = srv.address().port;
    try {
      expect(await isPortFree(busy)).toBe(false);
    } finally {
      await new Promise<void>(r => srv.close(r));
    }
  });

  it('unrefs the sidecar and its stderr pipe so they cannot hold the parent open', () => {
    const unref = jest.fn();
    const stderrUnref = jest.fn();
    const child = { unref, stderr: { unref: stderrUnref } } as unknown as Parameters<typeof unrefSidecarHandles>[0];
    unrefSidecarHandles(child);
    expect(stderrUnref).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
  });
});
