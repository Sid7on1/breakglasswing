import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  compareSemver,
  parseManifest,
  selectAnnouncements,
  readPackageVersion,
  updateCheckEnabled,
  manifestUrl,
  UpdateChecker,
  type UpdateManifest,
} from '../core/self.update';

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });

function tmpCache(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-upd-')), 'update-check.json');
}

describe('compareSemver', () => {
  it('orders numeric cores', () => {
    expect(compareSemver('1.1.0', '1.0.6')).toBe(1);
    expect(compareSemver('1.0.6', '1.1.0')).toBe(-1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });
  it('ranks a pre-release below its release', () => {
    expect(compareSemver('1.1.0-rc.1', '1.1.0')).toBe(-1);
    expect(compareSemver('1.1.0', '1.1.0-rc.1')).toBe(1);
    expect(compareSemver('1.1.0-rc.2', '1.1.0-rc.1')).toBe(1);
  });
  it('tolerates a v prefix, build metadata, and short versions', () => {
    expect(compareSemver('v1.2.0', '1.2.0')).toBe(0);
    expect(compareSemver('1.2.0+build.5', '1.2.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
  });
});

describe('parseManifest', () => {
  it('accepts our manifest shape', () => {
    const m = parseManifest({ latest: '1.2.0', downloadCmd: 'brew upgrade bimax', announcements: [
      { id: 'a1', level: 'warn', text: 'Deprecating X', minVersion: '1.0.0' },
    ] });
    expect(m?.latest).toBe('1.2.0');
    expect(m?.downloadCmd).toBe('brew upgrade bimax');
    expect(m?.announcements?.[0]).toMatchObject({ id: 'a1', level: 'warn' });
  });
  it('accepts the npm registry shape (version → latest)', () => {
    expect(parseManifest({ name: 'bimax', version: '1.3.0' })?.latest).toBe('1.3.0');
  });
  it('drops malformed announcements and defaults level to info', () => {
    const m = parseManifest({ latest: '1.0.0', announcements: [
      { id: 'ok', text: 'hi' },
      { id: 'no-text' },
      { text: 'no-id' },
      'garbage',
    ] });
    expect(m?.announcements).toEqual([{ id: 'ok', level: 'info', text: 'hi', minVersion: undefined, maxVersion: undefined }]);
  });
  it('returns null for junk', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({})).toBeNull();
    expect(parseManifest('nope')).toBeNull();
  });
});

describe('selectAnnouncements', () => {
  const manifest: UpdateManifest = {
    latest: '2.0.0',
    announcements: [
      { id: 'all', level: 'info', text: 'always' },
      { id: 'new-only', level: 'info', text: 'for >=1.5', minVersion: '1.5.0' },
      { id: 'old-only', level: 'warn', text: 'for <=1.0', maxVersion: '1.0.0' },
    ],
  };
  it('filters by version range', () => {
    const ids = selectAnnouncements(manifest, '1.0.6', []).map((a) => a.id);
    expect(ids).toEqual(['all']); // new-only excluded (1.0.6<1.5), old-only excluded (1.0.6>1.0)
  });
  it('includes range matches at the boundary', () => {
    expect(selectAnnouncements(manifest, '1.5.0', []).map((a) => a.id)).toEqual(['all', 'new-only']);
    expect(selectAnnouncements(manifest, '1.0.0', []).map((a) => a.id)).toEqual(['all', 'old-only']);
  });
  it('hides already-seen ids', () => {
    expect(selectAnnouncements(manifest, '1.5.0', ['all']).map((a) => a.id)).toEqual(['new-only']);
  });
  it('is empty for no manifest', () => {
    expect(selectAnnouncements(null, '1.0.0', [])).toEqual([]);
  });
});

describe('config', () => {
  it('update check is on unless opted out', () => {
    delete process.env.BIMAX_UPDATE_CHECK;
    expect(updateCheckEnabled()).toBe(true);
    process.env.BIMAX_UPDATE_CHECK = 'off';
    expect(updateCheckEnabled()).toBe(false);
    process.env.BIMAX_UPDATE_CHECK = '0';
    expect(updateCheckEnabled()).toBe(false);
  });
  it('manifest url defaults to the npm registry, overridable by env', () => {
    delete process.env.BIMAX_UPDATE_MANIFEST_URL;
    expect(manifestUrl()).toMatch(/registry\.npmjs\.org\/bimax/);
    process.env.BIMAX_UPDATE_MANIFEST_URL = 'https://example.com/m.json';
    expect(manifestUrl()).toBe('https://example.com/m.json');
  });
  it('reads the real package version', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('UpdateChecker', () => {
  const base = (over: Partial<ConstructorParameters<typeof UpdateChecker>[0]> = {}) =>
    new UpdateChecker({ currentVersion: '1.0.6', cachePath: tmpCache(), now: () => 1_000_000, ...over });

  it('flags an available update and writes the cache', async () => {
    const cachePath = tmpCache();
    const c = base({ cachePath, fetchManifest: async () => ({ latest: '1.2.0', downloadCmd: 'npm i -g bimax@latest' }) });
    const r = await c.check(true);
    expect(r.updateAvailable).toBe(true);
    expect(r.latest).toBe('1.2.0');
    expect(r.fromCache).toBe(false);
    expect(JSON.parse(fs.readFileSync(cachePath, 'utf8')).latest).toBe('1.2.0');
  });

  it('reports up-to-date when latest == current', async () => {
    const r = await base({ fetchManifest: async () => ({ latest: '1.0.6' }) }).check(true);
    expect(r.updateAvailable).toBe(false);
  });

  it('never downgrades on an older published latest', async () => {
    const r = await base({ fetchManifest: async () => ({ latest: '1.0.5' }) }).check(true);
    expect(r.updateAvailable).toBe(false);
  });

  it('fails open when the fetch returns null (offline)', async () => {
    const r = await base({ fetchManifest: async () => null }).check(true);
    expect(r.updateAvailable).toBe(false);
    expect(r.latest).toBeNull();
  });

  it('serves from cache within TTL without fetching', async () => {
    const cachePath = tmpCache();
    let fetches = 0;
    const mk = () => new UpdateChecker({
      currentVersion: '1.0.6', cachePath, now: () => 1_000_000, ttlMs: 60_000,
      fetchManifest: async () => { fetches++; return { latest: '1.2.0' }; },
    });
    await mk().check(false);      // fetch #1, writes cache at t=1_000_000
    const r2 = await mk().check(false); // within TTL → cache
    expect(fetches).toBe(1);
    expect(r2.fromCache).toBe(true);
    expect(r2.updateAvailable).toBe(true);
  });

  it('re-fetches after TTL expiry', async () => {
    const cachePath = tmpCache();
    let fetches = 0;
    const t0 = 1_700_000_000_000;
    await new UpdateChecker({ currentVersion: '1.0.6', cachePath, now: () => t0, ttlMs: 1000,
      fetchManifest: async () => { fetches++; return { latest: '1.1.0' }; } }).check(false);
    await new UpdateChecker({ currentVersion: '1.0.6', cachePath, now: () => t0 + 5000, ttlMs: 1000,
      fetchManifest: async () => { fetches++; return { latest: '1.2.0' }; } }).check(false);
    expect(fetches).toBe(2);
  });

  it('markSeen suppresses an announcement on the next check', async () => {
    const cachePath = tmpCache();
    const fetchManifest = async () => ({ latest: '1.2.0', announcements: [{ id: 'x', level: 'info' as const, text: 'hey' }] });
    const c1 = new UpdateChecker({ currentVersion: '1.0.6', cachePath, now: () => 1, fetchManifest });
    const first = await c1.check(true);
    expect(first.announcements.map((a) => a.id)).toEqual(['x']);
    c1.markSeen(['x']);
    const second = await new UpdateChecker({ currentVersion: '1.0.6', cachePath, now: () => 2, fetchManifest }).check(true);
    expect(second.announcements).toEqual([]);
  });

  it('does not throw on an unwritable cache path', async () => {
    const c = new UpdateChecker({ currentVersion: '1.0.6', cachePath: '/proc/nonexistent/dir/x.json', now: () => 1, fetchManifest: async () => ({ latest: '9.9.9' }) });
    const r = await c.check(true);
    expect(r.updateAvailable).toBe(true); // report still returned; cache write swallowed
  });
});
