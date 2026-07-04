import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileClaims, pathsOverlap } from '../core/file.claims';

describe('file claims (v2 §3.10/§9.7) — cross-process path leases, the merge queue', () => {
  let dir: string;
  let claims: FileClaims;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-claims-'));
    claims = new FileClaims(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('pathsOverlap: concrete, glob-vs-concrete, glob-vs-glob (conservative)', () => {
    expect(pathsOverlap('src/a.ts', 'src/a.ts')).toBe(true);
    expect(pathsOverlap('src/a.ts', 'src/b.ts')).toBe(false);
    expect(pathsOverlap('src/*.ts', 'src/a.ts')).toBe(true);
    expect(pathsOverlap('src/**', 'src/deep/x.ts')).toBe(true);
    expect(pathsOverlap('site/**', 'src/a.ts')).toBe(false);
    expect(pathsOverlap('src/*.ts', 'src/**')).toBe(true);   // shared literal prefix → conservative yes
    expect(pathsOverlap('src/*.ts', 'docs/*.md')).toBe(false);
  });

  it('grants disjoint leases, refuses overlapping ones with the holder named', () => {
    const a = claims.acquire('swarm-node-a', ['src/auth/session.ts', 'src/auth/token.ts']);
    expect(a.granted).toBe(true);
    const b = claims.acquire('swarm-node-b', ['src/render/pager.ts']);
    expect(b.granted).toBe(true);
    const c = claims.acquire('heal-worker', ['src/auth/session.ts']);
    expect(c.granted).toBe(false);
    expect(c.conflicts).toEqual([{ path: 'src/auth/session.ts', holder: 'swarm-node-a' }]);
  });

  it('is re-entrant per agent and persists across instances (the cross-process story)', () => {
    claims.acquire('me', ['src/a.ts']);
    expect(claims.acquire('me', ['src/a.ts']).granted).toBe(true);          // same agent never self-blocks
    expect(new FileClaims(dir).acquire('other', ['src/a.ts']).granted).toBe(false); // a fresh process sees the lease
  });

  it('release frees the paths; TTL expiry frees them without a release', () => {
    const a = claims.acquire('me', ['src/a.ts'], { ttlMs: 50 });
    expect(a.granted).toBe(true);
    expect(claims.acquire('other', ['src/a.ts']).granted).toBe(false);
    claims.release('me');
    expect(claims.acquire('other', ['src/a.ts']).granted).toBe(true);
    claims.release('other');

    claims.acquire('short', ['src/b.ts'], { ttlMs: 1 });
    return new Promise<void>(resolve => setTimeout(() => {
      expect(claims.acquire('other', ['src/b.ts']).granted).toBe(true); // lease aged out — pruned
      resolve();
    }, 20));
  });

  it('a lease held by a DEAD process is pruned — a crashed holder never wedges the repo', () => {
    // Forge a claim from an impossible pid directly into the store.
    fs.mkdirSync(path.join(dir, '.bimax'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.bimax', 'claims.json'), JSON.stringify([
      { id: 'ghost-1', agent: 'ghost', pid: 999999999, paths: ['src/a.ts'], at: Date.now(), ttlMs: 600000 },
    ]), 'utf-8');
    expect(claims.acquire('me', ['src/a.ts']).granted).toBe(true);
  });

  it('awaitAcquire queues until the holder releases', async () => {
    claims.acquire('holder', ['src/a.ts']);
    setTimeout(() => claims.release('holder'), 120);
    const res = await claims.awaitAcquire('waiter', ['src/a.ts'], { timeoutMs: 3000, pollMs: 25 });
    expect(res.granted).toBe(true);
  });

  it('awaitAcquire gives up honestly at the timeout, naming the blocker', async () => {
    claims.acquire('holder', ['src/a.ts']);
    const res = await claims.awaitAcquire('waiter', ['src/a.ts'], { timeoutMs: 100, pollMs: 25 });
    expect(res.granted).toBe(false);
    expect(res.conflicts[0].holder).toBe('holder');
  });
});
