import { globalCommandRegistry } from './registry';
import { perfSnapshot, PerfSnapshot } from '../../telemetry/perf';
import { guardTimings } from '../../tools/guard.timing';
import { performanceBudgetReport } from '../../telemetry/performance.budget';

/**
 * /perf — a hidden diagnostics readout of the engine's own performance: cold-start (process load →
 * ready), per-turn time-to-first-token (p50/p95), and memory. Pure local counters (see PRIVACY.md);
 * "you can't call it smooth without a number." Frame-level render metrics live in the Go TUI.
 */
export function renderPerf(s: PerfSnapshot): string {
  const ms = (n: number) => (n > 0 ? `${n} ms` : '—');
  const lines = [
    '● **Performance**',
    '',
    `  Cold start (load → ready):  **${ms(s.coldStartMs)}**` + (s.coldStartMs > 0 && s.coldStartMs < 300 ? '  ✓ < 300 ms' : ''),
    `  Uptime:                     ${Math.round(s.uptimeMs / 1000)} s`,
    `  Memory:                     ${s.rssMb} MB rss · ${s.heapMb} MB heap`,
    '',
    `  Turns measured:             ${s.turns}`,
    `  Time-to-first-token:        p50 ${ms(s.firstTokenP50)} · p95 ${ms(s.firstTokenP95)}`,
  ];
  if (s.lastTurn) {
    lines.push(`  Last turn:                  first token ${ms(s.lastTurn.firstTokenMs)} · total ${ms(s.lastTurn.totalMs)} · ${s.lastTurn.tokens} chars`);
  }

  lines.push('', '  Performance budgets:');
  for (const check of performanceBudgetReport(s)) {
    const state = !check.measured ? '○ unmeasured' : check.pass ? '✓ pass' : '✗ over';
    lines.push(`    ${check.metric.padEnd(20)} ${state} · ${check.value || '—'} / ${check.budget} ${check.unit}`);
  }

  try {
    const snapshot = require('../../outcome/outcome.manager').getOutcomeManager().snapshot();
    if (snapshot) {
      const schedule = snapshot.schedule;
      lines.push('', '  Active outcome:');
      lines.push(`    elapsed                  ${ms(snapshot.elapsedMs)}`);
      lines.push(`    time to verified         ${snapshot.timeToVerifiedMs ? ms(snapshot.timeToVerifiedMs) : 'in progress'}`);
      lines.push(`    estimated parallel save  ${ms(schedule.estimatedParallelSavingsMs)}`);
      lines.push(`    remaining critical path  ${ms(schedule.estimatedCriticalPathMs)}`);
    }
  } catch { /* /perf also works before the outcome runtime starts */ }

  // WS5 step 3 — guard pipeline timing. Shows whether tool latency is spent in the guards
  // (governor approval, hooks) or in the tool itself, so a slow guard is caught, not blamed.
  const guards = guardTimings();
  if (guards.length > 0) {
    lines.push('', '  Guard pipeline (this session):');
    for (const g of guards) {
      lines.push(`    ${g.phase.padEnd(18)} ${g.count}× · avg ${g.avgMs.toFixed(1)} ms · max ${g.maxMs} ms · total ${Math.round(g.totalMs)} ms`);
    }
  }
  return lines.join('\n');
}

globalCommandRegistry.register({
  name: '/perf',
  description: 'Engine perf readout — cold start, time-to-first-token, memory',
  category: 'Code & Intelligence',
  hidden: true, // diagnostics, not an everyday verb — reachable when typed
  execute: async () => ({ type: 'message', level: 'info', content: renderPerf(perfSnapshot()) }),
});
