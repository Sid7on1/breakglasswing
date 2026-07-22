import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Phase 3b — Self-update + in-app announcements (Grok `xai-grok-update` / `xai-announcements`,
 * ported in concept).
 *
 * Two small product-polish capabilities, deliberately advisory and non-invasive:
 *   1. **Update check** — compare the running version against the latest published one and, when a
 *      newer build exists, surface a one-line notice plus the upgrade command. Bimax NEVER installs
 *      an update itself; it only tells you one exists and how to get it.
 *   2. **Announcements** — an optional remote manifest can carry short, version-scoped notices
 *      (release highlights, deprecations). Each is shown at most once — seen ids are remembered on
 *      disk — and filtered to the running version's range.
 *
 * Every network read is injected ({@link UpdateCheckerOptions.fetchManifest}) so tests never touch
 * the wire, TTL-cached on disk so a normal launch does no I/O, and fail-open: if the check errors,
 * times out, or is disabled, Bimax proceeds in silence. It must never delay or block startup.
 */

export interface Announcement {
  id: string;
  level: 'info' | 'warn';
  text: string;
  /** Only show at/above this version (inclusive). Omit for "all". */
  minVersion?: string;
  /** Only show at/below this version (inclusive). Omit for "all". */
  maxVersion?: string;
}

export interface UpdateManifest {
  /** Latest published version, e.g. "1.1.0". */
  latest: string;
  /** Shell command to upgrade, shown verbatim. Defaults to `npm i -g bimax@latest`. */
  downloadCmd?: string;
  announcements?: Announcement[];
}

export interface UpdateReport {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  downloadCmd: string;
  announcements: Announcement[];
  /** True when the result came from the on-disk cache rather than a fresh fetch. */
  fromCache: boolean;
}

interface UpdateCache {
  checkedAt: number;
  latest: string | null;
  downloadCmd?: string;
  announcements?: Announcement[];
  seenIds: string[];
}

// Bimax ships as a SINGLE standalone binary installed by install.sh (see repo root) — the upgrade
// command must match that channel, not suggest a global npm install that doesn't apply.
const DEFAULT_DOWNLOAD_CMD = 'curl -fsSL https://bimax-liard.vercel.app/install | bash -s -- --update';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // one check per day is plenty

/** User cache directory for update metadata — NEVER process.cwd() (a repo-local write). */
export function defaultUpdateCachePath(): string {
  const base = process.env.XDG_CACHE_HOME
    ? path.join(process.env.XDG_CACHE_HOME, 'bimax')
    : path.join(os.homedir(), '.bimax');
  return path.join(base, 'update-check.json');
}

// ── Version helpers (pure) ───────────────────────────────────────────────────────────────────────

/** Read the running version from the nearest package.json (works from src/ and dist/). */
export function readPackageVersion(startDir: string = __dirname): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (pkg?.name === 'bimax' && typeof pkg.version === 'string') return pkg.version;
      if (typeof pkg?.version === 'string' && i > 0) return pkg.version;
    } catch { /* keep walking up */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

/**
 * Compare two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal. Numeric core is compared
 * field by field; a build-metadata suffix (`+…`) is ignored; a pre-release (`-…`) ranks BELOW the
 * same core release (1.1.0-rc.1 < 1.1.0). Non-numeric/garbage fields sort as 0.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const clean = String(v).trim().replace(/^v/i, '').split('+')[0];
    const [core, pre] = clean.split('-');
    const nums = core.split('.').map((n) => {
      const x = parseInt(n, 10);
      return Number.isFinite(x) ? x : 0;
    });
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  }
  // Equal core: a pre-release is lower than the release; two pre-releases compare lexically.
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre > pb.pre ? 1 : pa.pre < pb.pre ? -1 : 0;
}

/** Filter a manifest's announcements to those in range for `current` and not already seen. */
export function selectAnnouncements(
  manifest: UpdateManifest | null,
  current: string,
  seenIds: Iterable<string>,
): Announcement[] {
  if (!manifest?.announcements?.length) return [];
  const seen = new Set(seenIds);
  return manifest.announcements.filter((a) => {
    if (!a || !a.id || !a.text || seen.has(a.id)) return false;
    if (a.minVersion && compareSemver(current, a.minVersion) < 0) return false;
    if (a.maxVersion && compareSemver(current, a.maxVersion) > 0) return false;
    return true;
  });
}

/** Validate/normalize an untrusted manifest payload. Returns null on anything malformed. */
export function parseManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // Our own manifest uses `latest`; a GitHub release object uses `tag_name` (e.g. "v1.2.0");
  // an npm-style payload uses `version`. Accept all three.
  const latest = typeof obj.latest === 'string' ? obj.latest
    : typeof obj.tag_name === 'string' ? obj.tag_name
      : typeof obj.version === 'string' ? obj.version : null;
  if (!latest) return null;
  const announcements = Array.isArray(obj.announcements)
    ? obj.announcements
        .filter((a): a is Announcement =>
          !!a && typeof (a as any).id === 'string' && typeof (a as any).text === 'string')
        .map((a) => ({
          id: String((a as any).id),
          level: (a as any).level === 'warn' ? 'warn' as const : 'info' as const,
          text: String((a as any).text),
          minVersion: typeof (a as any).minVersion === 'string' ? (a as any).minVersion : undefined,
          maxVersion: typeof (a as any).maxVersion === 'string' ? (a as any).maxVersion : undefined,
        }))
    : [];
  return {
    latest,
    downloadCmd: typeof obj.downloadCmd === 'string' ? obj.downloadCmd : undefined,
    announcements,
  };
}

// ── Config ───────────────────────────────────────────────────────────────────────────────────────

/** Disabled only when explicitly opted out. */
export function updateCheckEnabled(): boolean {
  const v = String(process.env.BIMAX_UPDATE_CHECK || '').toLowerCase();
  return v !== 'off' && v !== '0';
}

/** Where to fetch the manifest. Our manifest URL if set, else the GitHub release feed for the
 * standalone-binary channel install.sh actually installs from. */
export function manifestUrl(): string {
  return process.env.BIMAX_UPDATE_MANIFEST_URL
    || 'https://api.github.com/repos/Sid7on1/bimax-releases/releases/latest';
}

// ── The checker ──────────────────────────────────────────────────────────────────────────────────

export interface UpdateCheckerOptions {
  /** Fetch + parse the remote manifest. Injected in tests; default hits {@link manifestUrl}. */
  fetchManifest?: (url: string) => Promise<UpdateManifest | null>;
  now?: () => number;
  cachePath?: string;
  ttlMs?: number;
  currentVersion?: string;
}

async function defaultFetchManifest(url: string): Promise<UpdateManifest | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return parseManifest(await res.json());
  } catch {
    return null; // offline, timeout, DNS, 404 — all fail open
  } finally {
    clearTimeout(timer);
  }
}

export class UpdateChecker {
  private readonly fetchManifest: (url: string) => Promise<UpdateManifest | null>;
  private readonly now: () => number;
  private readonly cachePath: string;
  private readonly ttlMs: number;
  private readonly current: string;

  constructor(opts: UpdateCheckerOptions = {}) {
    this.fetchManifest = opts.fetchManifest ?? defaultFetchManifest;
    this.now = opts.now ?? Date.now;
    this.cachePath = opts.cachePath ?? defaultUpdateCachePath();
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.current = opts.currentVersion ?? readPackageVersion();
  }

  private loadCache(): UpdateCache {
    try {
      const c = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (c && typeof c.checkedAt === 'number' && Array.isArray(c.seenIds)) return c;
    } catch { /* no/invalid cache */ }
    return { checkedAt: 0, latest: null, seenIds: [] };
  }

  private saveCache(cache: UpdateCache): void {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(cache, null, 2), 'utf8');
    } catch { /* cache is best-effort */ }
  }

  private report(latest: string | null, downloadCmd: string, announcements: Announcement[], fromCache: boolean): UpdateReport {
    return {
      current: this.current,
      latest,
      updateAvailable: !!latest && compareSemver(latest, this.current) > 0,
      downloadCmd,
      announcements,
      fromCache,
    };
  }

  /**
   * Return the current update status. Uses the on-disk cache while it's within TTL (no network),
   * otherwise fetches fresh and rewrites the cache. `force` always fetches. Never throws.
   */
  async check(force = false): Promise<UpdateReport> {
    const cache = this.loadCache();
    const fresh = this.now() - cache.checkedAt < this.ttlMs;

    if (!force && fresh) {
      const manifest = cache.latest ? { latest: cache.latest, downloadCmd: cache.downloadCmd, announcements: cache.announcements } : null;
      return this.report(
        cache.latest,
        cache.downloadCmd || DEFAULT_DOWNLOAD_CMD,
        selectAnnouncements(manifest, this.current, cache.seenIds),
        true,
      );
    }

    const manifest = await this.fetchManifest(manifestUrl());
    const latest = manifest?.latest ?? cache.latest;
    const downloadCmd = manifest?.downloadCmd || cache.downloadCmd || DEFAULT_DOWNLOAD_CMD;
    const announcements = selectAnnouncements(manifest ?? (cache.latest ? { latest: cache.latest, announcements: cache.announcements } : null), this.current, cache.seenIds);

    this.saveCache({
      checkedAt: this.now(),
      latest,
      downloadCmd,
      announcements: manifest?.announcements ?? cache.announcements,
      seenIds: cache.seenIds,
    });

    return this.report(latest, downloadCmd, announcements, false);
  }

  /**
   * The last cached result, read synchronously with NO network and NO fetch. For always-on
   * surfaces (the ui_snapshot footer, the ACP session banner) that must never block or await.
   * Returns `latest: null` (updateAvailable false) until a real check has populated the cache.
   */
  lastKnown(): UpdateReport {
    const cache = this.loadCache();
    const manifest = cache.latest ? { latest: cache.latest, downloadCmd: cache.downloadCmd, announcements: cache.announcements } : null;
    return this.report(
      cache.latest,
      cache.downloadCmd || DEFAULT_DOWNLOAD_CMD,
      selectAnnouncements(manifest, this.current, cache.seenIds),
      true,
    );
  }

  /** Remember these announcement ids as seen so they aren't shown again. */
  markSeen(ids: string[]): void {
    if (!ids.length) return;
    const cache = this.loadCache();
    cache.seenIds = Array.from(new Set([...cache.seenIds, ...ids]));
    this.saveCache(cache);
  }

  get currentVersion(): string { return this.current; }
}

/** Process-wide checker used by the boot notice and the `/update` command. */
export const updateChecker = new UpdateChecker();
