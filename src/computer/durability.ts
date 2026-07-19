/**
 * Long-run durability for computer use.
 *
 * An hours-long desktop run fails in slow, quiet ways: screenshots and recordings pile up until the
 * disk (this Mac's APFS especially) starts truncating reads; the action history grows without bound
 * in memory and context; and a crash loses all knowledge of what the agent was doing. This module
 * provides the three bounded, durable structures that prevent that — a capped action history with a
 * COMPRESSED summary (so we never resend the whole thing), recording-storage sweeping, and a small
 * atomically-written session-state file the runtime can reload to resume after an interruption.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ActionRecord {
  seq: number;
  action: string;
  app?: string;
  outcome?: string; // a VerificationOutcome, when known
  at: number;
}

export interface ActionHistorySummary {
  /** Total actions ever taken this session (monotonic). */
  total: number;
  /** How many records are retained in the bounded ring. */
  kept: number;
  /** Count per action verb across the retained window. */
  byAction: Record<string, number>;
  /** Trailing run of consecutive no-change outcomes. */
  noChangeStreak: number;
  /** The last few records — the only detail the next decision actually needs. */
  recent: ActionRecord[];
  lastOutcome?: string;
}

/**
 * Bounded, append-only action log. Keeps only the newest `keep` records in memory (older ones are
 * dropped, not accumulated), while `total` still counts everything for budgets/telemetry. `summary`
 * is the compressed relevant-state view — counts plus the last few actions — so callers preserve
 * only what the next decision needs instead of the whole trajectory.
 */
export class ActionHistory {
  private records: ActionRecord[] = [];
  private seq = 0;

  constructor(private readonly keep = 50) {}

  record(action: string, opts: { app?: string; outcome?: string } = {}): ActionRecord {
    const rec: ActionRecord = { seq: ++this.seq, action, app: opts.app, outcome: opts.outcome, at: Date.now() };
    this.records.push(rec);
    if (this.records.length > this.keep) this.records.splice(0, this.records.length - this.keep);
    return rec;
  }

  get size(): number { return this.records.length; }
  get total(): number { return this.seq; }
  all(): ActionRecord[] { return [...this.records]; }

  summary(recentN = 5): ActionHistorySummary {
    const byAction: Record<string, number> = {};
    for (const r of this.records) byAction[r.action] = (byAction[r.action] || 0) + 1;
    let noChangeStreak = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].outcome === 'no-change') noChangeStreak++; else break;
    }
    return {
      total: this.seq, kept: this.records.length, byAction, noChangeStreak,
      recent: this.records.slice(-recentN),
      lastOutcome: this.records[this.records.length - 1]?.outcome,
    };
  }

  toJSON(): { seq: number; records: ActionRecord[] } { return { seq: this.seq, records: this.records }; }

  static fromJSON(data: any, keep = 50): ActionHistory {
    const h = new ActionHistory(keep);
    if (Array.isArray(data?.records)) {
      h.records = data.records.slice(-keep);
      h.seq = Number(data.seq) || h.records.length;
    }
    return h;
  }

  /**
   * Rebuild a history from a persisted {@link ActionHistorySummary} — the shape the session-state
   * file stores. This is the resume primitive: it restores the monotonic `total` (so budgets and
   * telemetry continue counting instead of resetting to zero after a crash/relaunch) and the last
   * few records (so the recovered session keeps its recent trajectory and no-change streak). Only
   * the compressed recent window is persisted, not the full ring — which is all the next decision
   * needs after an interruption.
   */
  static fromSummary(summary: ActionHistorySummary | null | undefined, keep = 50): ActionHistory {
    const h = new ActionHistory(keep);
    if (!summary) return h;
    h.seq = Math.max(0, Number(summary.total) || 0);
    if (Array.isArray(summary.recent)) h.records = summary.recent.slice(-keep).map(r => ({ ...r }));
    return h;
  }

  reset(): void { this.records = []; this.seq = 0; }
}

/**
 * Keep the recordings directory bounded during hours-long runs: retain the newest `keepRuns` run-*
 * folders, deleting older ones (and anything past `maxAgeMs` when set). Returns how many were removed.
 * Best-effort — hygiene must never crash a run.
 */
export function sweepRecordings(root: string, opts: { keepRuns?: number; maxAgeMs?: number } = {}): number {
  const keepRuns = opts.keepRuns ?? 5;
  let removed = 0;
  try {
    const now = Date.now();
    const runs = fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('run-'))
      .map(e => { const dir = path.join(root, e.name); return { dir, t: fs.statSync(dir).mtimeMs }; })
      .sort((a, b) => b.t - a.t);
    runs.forEach((r, i) => {
      const tooOld = opts.maxAgeMs != null && (now - r.t) > opts.maxAgeMs;
      if (i >= keepRuns || tooOld) { fs.rmSync(r.dir, { recursive: true, force: true }); removed++; }
    });
  } catch { /* best-effort hygiene */ }
  return removed;
}

/** A surface snapshot small enough to persist and reload for resume. */
export interface PersistedSurface {
  id: string;
  kind: string;
  app?: string;
  pid?: number;
  windowId?: number;
  bounds?: { x: number; y: number; w: number; h: number };
  focusOwner?: string;
}

export interface ComputerSessionState {
  version: 1;
  updatedAt: number;
  surface: PersistedSurface | null;
  history: ActionHistorySummary;
  recordingDir?: string;
}

/** Atomic write (temp + rename) so a crash mid-write never leaves a half-parsed state file. */
export function writeSessionState(file: string, state: ComputerSessionState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Reload persisted state to resume after an interruption; null when absent or unrecognized. */
export function readSessionState(file: string): ComputerSessionState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed?.version === 1 ? parsed as ComputerSessionState : null;
  } catch {
    return null;
  }
}
