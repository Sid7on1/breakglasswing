/**
 * Where did an action's wall time actually go?
 *
 * This subsystem had no answer to that question, and it cost real accuracy: a scan-cap comment in
 * desktop.runtime.ts recorded "cap 200 → 585ms … ~3.7ms per node, linear" and every element budget
 * in the observe path was sized from it. Re-measured against the same driver, the same call is
 * ~0.3ms per node and saturates at the tree's real size — the number was wrong by an order of
 * magnitude, and nothing in the system could have contradicted it, because nothing measured.
 *
 * So: a phase trace that is free when off, exact when on, and attached to the result rather than
 * printed. Enable with BIMAX_COMPUTER_PROFILE=1.
 *
 * Deliberately a module singleton keyed to the action currently being executed. The runtime
 * serializes actions through run(), so there is one live trace at a time; a nested run() (recovery
 * re-observing, say) continues the outer trace instead of starting a rival one, which is what makes
 * "open cost 3296ms" decompose into its recursive parts rather than hiding them.
 */

export interface PhaseSpan {
  name: string;
  ms: number;
  /** Nesting depth, so a caller can render the tree rather than a flat list. */
  depth: number;
}

const enabled = (): boolean => process.env.BIMAX_COMPUTER_PROFILE === '1';

const nowMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);

class Trace {
  private spans: PhaseSpan[] = [];
  private depth = 0;
  private startedAt = nowMs();

  reset(): void {
    this.spans = [];
    this.depth = 0;
    this.startedAt = nowMs();
  }

  /** Time an awaited phase. Records even when the phase throws — a slow failure is still slow. */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!enabled()) return fn();
    const depth = this.depth++;
    const t0 = nowMs();
    try {
      return await fn();
    } finally {
      this.depth--;
      this.spans.push({ name, ms: nowMs() - t0, depth });
    }
  }

  /** Time a synchronous phase. */
  sync<T>(name: string, fn: () => T): T {
    if (!enabled()) return fn();
    const depth = this.depth++;
    const t0 = nowMs();
    try {
      return fn();
    } finally {
      this.depth--;
      this.spans.push({ name, ms: nowMs() - t0, depth });
    }
  }

  /** Total wall time since the last reset, and the recorded spans in completion order. */
  report(): { totalMs: number; spans: PhaseSpan[]; unaccountedMs: number } | undefined {
    if (!enabled()) return undefined;
    const totalMs = nowMs() - this.startedAt;
    // Only depth-0 spans partition the timeline; deeper ones are contained within them.
    const topLevel = this.spans.filter(span => span.depth === 0).reduce((sum, span) => sum + span.ms, 0);
    return { totalMs, spans: [...this.spans], unaccountedMs: totalMs - topLevel };
  }
}

export const phaseTrace = new Trace();

/** Human-readable rendering, deepest-nested indented under its parent. */
export function formatPhaseReport(report: { totalMs: number; spans: PhaseSpan[]; unaccountedMs: number } | undefined): string {
  if (!report) return '(profiling off; set BIMAX_COMPUTER_PROFILE=1)';
  const lines = report.spans.map(span =>
    `${'  '.repeat(span.depth)}${span.name.padEnd(38 - span.depth * 2)} ${String(span.ms).padStart(6)} ms`);
  lines.push(`${'TOTAL'.padEnd(38)} ${String(report.totalMs).padStart(6)} ms`);
  lines.push(`${'unaccounted (uninstrumented)'.padEnd(38)} ${String(report.unaccountedMs).padStart(6)} ms`);
  return lines.join('\n');
}
