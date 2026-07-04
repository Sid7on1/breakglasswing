// Lightweight, local perf instrumentation for /perf. Measures what the engine can measure honestly:
// cold-start (process load → engine ready), per-turn first-token + total latency, and memory. Pure
// in-process counters — no egress (see PRIVACY.md). Frame-level TUI metrics live in the Go front-end.

const processStart = Date.now();
let readyAt = 0;

/** Called once when the engine is wired and ready to accept the first turn. */
export function markReady(): void {
  if (readyAt === 0) readyAt = Date.now();
}

export interface TurnPerf {
  firstTokenMs: number; // turn start → first streamed token (0 if the turn produced none)
  totalMs: number;      // turn start → turn end
  tokens: number;       // streamed characters this turn
}

const turns: TurnPerf[] = [];
const MAX_TURNS = 100;

export function recordTurn(t: TurnPerf): void {
  turns.push(t);
  if (turns.length > MAX_TURNS) turns.shift();
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export interface PerfSnapshot {
  coldStartMs: number;
  uptimeMs: number;
  rssMb: number;
  heapMb: number;
  turns: number;
  firstTokenP50: number;
  firstTokenP95: number;
  lastTurn: TurnPerf | null;
}

export function perfSnapshot(): PerfSnapshot {
  const mem = process.memoryUsage();
  const ft = turns.map(t => t.firstTokenMs).filter(x => x > 0).sort((a, b) => a - b);
  return {
    coldStartMs: readyAt ? readyAt - processStart : 0,
    uptimeMs: Date.now() - processStart,
    rssMb: Math.round(mem.rss / 1048576),
    heapMb: Math.round(mem.heapUsed / 1048576),
    turns: turns.length,
    firstTokenP50: percentile(ft, 0.5),
    firstTokenP95: percentile(ft, 0.95),
    lastTurn: turns.length ? turns[turns.length - 1] : null,
  };
}

/** Test seam. */
export function __resetPerf(): void {
  turns.length = 0;
  readyAt = 0;
}
