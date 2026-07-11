// guard.timing.ts — WS5 step 3. Accumulates wall-time spent in each phase of the tool guard
// pipeline (governor approval, PreToolUse hooks, PostToolUse hooks) so a slow guard is VISIBLE
// before it's blamed. In-memory, per-session, best-effort: recording is a Map upsert (zero I/O),
// and the numbers are read on demand by /perf. Deliberately NOT wired into the hot LLM stream.

export interface GuardStat { count: number; totalMs: number; maxMs: number; }

const stats = new Map<string, GuardStat>();

/** Fold one timed guard phase into the running per-phase {count, total, max}. Never throws. */
export function recordGuard(phase: string, ms: number): void {
  if (!(ms >= 0)) return; // NaN / negative (clock skew) — ignore rather than poison the average
  const s = stats.get(phase) || { count: 0, totalMs: 0, maxMs: 0 };
  s.count++;
  s.totalMs += ms;
  if (ms > s.maxMs) s.maxMs = ms;
  stats.set(phase, s);
}

export interface GuardTimingRow extends GuardStat { phase: string; avgMs: number; }

/** Per-phase timings, slowest cumulative first — what /perf renders. */
export function guardTimings(): GuardTimingRow[] {
  return [...stats.entries()]
    .map(([phase, s]) => ({ phase, ...s, avgMs: s.count ? s.totalMs / s.count : 0 }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

/** Test seam / session reset. */
export function resetGuardTimings(): void { stats.clear(); }
