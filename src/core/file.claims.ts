import * as fs from 'fs';
import * as path from 'path';
import { getEventLedger } from '../mind/event.ledger';

/**
 * File claims (v2 §3.10 / §9.7 — the merge queue's path tier). An agent LEASES the
 * paths it is about to mutate; a second agent whose lease overlaps queues instead of
 * clobbering. Leases live in `.bimax/claims.json` so they work ACROSS PROCESSES (two
 * bimax sessions, a swarm and a heal, a dream worker and the user's session) — the
 * in-repo file plus atomic rename is the lock, TTL plus dead-PID pruning is the
 * liveness story (a crashed holder never wedges the repo).
 *
 * Honest tier: overlap is path/glob-level. The plan's AST tier ("same file but
 * disjoint symbols → allowed") is the documented next step — the conservative answer
 * (queue) is always safe, just occasionally slower.
 */

export interface Claim {
  id: string;
  agent: string;
  pid: number;
  paths: string[];   // concrete paths or globs (* ? **)
  at: number;
  ttlMs: number;
}

export interface AcquireResult {
  granted: boolean;
  id?: string;
  conflicts: { path: string; holder: string }[];
}

const DEFAULT_TTL_MS = 10 * 60_000;

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')       // placeholder so `**` survives the `*` pass
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    // eslint-disable-next-line no-control-regex -- NUL is our internal `**` placeholder sentinel
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
}

function literalPrefix(glob: string): string {
  const i = glob.search(/[*?]/);
  return i === -1 ? glob : glob.slice(0, i);
}

/** Conservative overlap: concrete-vs-glob is exact; glob-vs-glob falls back to prefix containment. */
export function pathsOverlap(a: string, b: string): boolean {
  const an = a.replace(/\\/g, '/');
  const bn = b.replace(/\\/g, '/');
  const aGlob = /[*?]/.test(an);
  const bGlob = /[*?]/.test(bn);
  if (!aGlob && !bGlob) return an === bn;
  if (aGlob && !bGlob) return globToRegex(an).test(bn);
  if (!aGlob && bGlob) return globToRegex(bn).test(an);
  const ap = literalPrefix(an);
  const bp = literalPrefix(bn);
  return ap.startsWith(bp) || bp.startsWith(ap);
}

function pidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; }
}

export class FileClaims {
  private filePath: string;

  constructor(projectRoot: string = process.cwd()) {
    this.filePath = path.join(projectRoot, '.bimax', 'claims.json');
  }

  private read(): Claim[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  private write(claims: Claim[]): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(claims, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath); // atomic on POSIX — the cross-process story
    } catch { /* best-effort */ }
  }

  /** Live claims only: expired leases and leases whose holder process died are pruned. */
  live(): Claim[] {
    const now = Date.now();
    const all = this.read();
    const live = all.filter(c => now - c.at <= c.ttlMs && pidAlive(c.pid));
    if (live.length !== all.length) this.write(live);
    return live;
  }

  /** Try to lease `paths` for `agent`. Overlap with another holder → not granted, holders named. */
  acquire(agent: string, paths: string[], opts?: { ttlMs?: number }): AcquireResult {
    const wanted = paths.filter(Boolean);
    if (wanted.length === 0) return { granted: true, id: undefined, conflicts: [] };
    const live = this.live();
    const conflicts: { path: string; holder: string }[] = [];
    for (const c of live) {
      if (c.agent === agent) continue; // re-entrant: an agent never conflicts with itself
      for (const mine of wanted) {
        for (const theirs of c.paths) {
          if (pathsOverlap(mine, theirs)) conflicts.push({ path: mine, holder: c.agent });
        }
      }
    }
    if (conflicts.length > 0) {
      try { getEventLedger().append('file_claim', { agent, paths: wanted.slice(0, 20), granted: false, conflicts: conflicts.slice(0, 5) }); } catch { /* best-effort */ }
      return { granted: false, conflicts };
    }
    const claim: Claim = {
      id: `${agent}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      agent, pid: process.pid, paths: wanted, at: Date.now(), ttlMs: opts?.ttlMs ?? DEFAULT_TTL_MS,
    };
    this.write([...live, claim]);
    try { getEventLedger().append('file_claim', { agent, paths: wanted.slice(0, 20), granted: true, id: claim.id }); } catch { /* best-effort */ }
    return { granted: true, id: claim.id, conflicts: [] };
  }

  /** Queue politely: retry acquire until granted or the timeout — the merge-queue verb. */
  async awaitAcquire(agent: string, paths: string[], opts?: { ttlMs?: number; timeoutMs?: number; pollMs?: number }): Promise<AcquireResult> {
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const pollMs = opts?.pollMs ?? 500;
    const start = Date.now();
    for (;;) {
      const res = this.acquire(agent, paths, opts);
      if (res.granted || Date.now() - start >= timeoutMs) return res;
      await new Promise(r => setTimeout(r, pollMs));
    }
  }

  release(idOrAgent: string): number {
    const live = this.live();
    const keep = live.filter(c => c.id !== idOrAgent && c.agent !== idOrAgent);
    const released = live.length - keep.length;
    if (released > 0) {
      this.write(keep);
      try { getEventLedger().append('file_release', { idOrAgent, released }); } catch { /* best-effort */ }
    }
    return released;
  }
}

let _global: FileClaims | null = null;
export function getFileClaims(): FileClaims {
  if (!_global) _global = new FileClaims(process.cwd());
  return _global;
}
export function __setFileClaims(f: FileClaims | null): void { _global = f; }
