/**
 * Per-tool MCP call telemetry — call counts, latency, error rate, keyed by `server/tool`.
 * A tiny standalone singleton (no imports) so client.ts can record from the hot call path and
 * the manager/doctor can read it without creating an import cycle.
 */

export interface McpToolStat {
  calls: number;
  errors: number;
  totalMs: number;
  lastMs: number;
  /** Set on the most recent failure so the doctor can say WHY, not just how often. */
  lastError?: string;
}

const stats = new Map<string, McpToolStat>();

export function recordMcpCall(server: string, tool: string, ms: number, error?: string): void {
  const key = `${server}/${tool}`;
  const s = stats.get(key) ?? { calls: 0, errors: 0, totalMs: 0, lastMs: 0 };
  s.calls++;
  s.totalMs += ms;
  s.lastMs = ms;
  if (error) { s.errors++; s.lastError = error.slice(0, 200); }
  stats.set(key, s);
}

/** All stats for one server, keyed by bare tool name, busiest first. */
export function statsForServer(server: string): Array<{ tool: string } & McpToolStat> {
  const prefix = `${server}/`;
  return Array.from(stats.entries())
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, s]) => ({ tool: k.slice(prefix.length), ...s }))
    .sort((a, b) => b.calls - a.calls);
}

/** Aggregate across one server: total calls/errors and average latency (0 when unused). */
export function serverCallSummary(server: string): { calls: number; errors: number; avgMs: number } {
  let calls = 0, errors = 0, totalMs = 0;
  for (const s of statsForServer(server)) { calls += s.calls; errors += s.errors; totalMs += s.totalMs; }
  return { calls, errors, avgMs: calls ? Math.round(totalMs / calls) : 0 };
}

export function resetMcpStats(): void {
  stats.clear();
}
