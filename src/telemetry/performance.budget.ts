import { PerfSnapshot, perfSnapshot } from './perf';
import { globalTelemetry } from './telemetry';
import { guardTimings } from '../tools/guard.timing';

export interface PerformanceBudgetCheck {
  metric: string;
  value: number;
  budget: number;
  unit: 'ms' | 'MB';
  measured: boolean;
  pass: boolean;
}

function envBudget(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Session-local performance SLOs. Unmeasured external-model metrics are explicit, never green. */
export function performanceBudgetReport(snapshot: PerfSnapshot = perfSnapshot()): PerformanceBudgetCheck[] {
  const toolP95 = globalTelemetry.getToolStats().reduce((max, tool) => Math.max(max, tool.p95Ms), 0);
  const guardMax = guardTimings().reduce((max, guard) => Math.max(max, guard.maxMs), 0);
  const checks: PerformanceBudgetCheck[] = [
    { metric: 'cold_start', value: snapshot.coldStartMs, budget: envBudget('BIMAX_BUDGET_COLD_START_MS', 5000), unit: 'ms', measured: snapshot.coldStartMs > 0, pass: false },
    { metric: 'rss', value: snapshot.rssMb, budget: envBudget('BIMAX_BUDGET_RSS_MB', 1024), unit: 'MB', measured: true, pass: false },
    { metric: 'first_token_p95', value: snapshot.firstTokenP95, budget: envBudget('BIMAX_BUDGET_FIRST_TOKEN_P95_MS', 120000), unit: 'ms', measured: snapshot.turns > 0 && snapshot.firstTokenP95 > 0, pass: false },
    { metric: 'tool_p95', value: toolP95, budget: envBudget('BIMAX_BUDGET_TOOL_P95_MS', 120000), unit: 'ms', measured: toolP95 > 0, pass: false },
    { metric: 'guard_max', value: guardMax, budget: envBudget('BIMAX_BUDGET_GUARD_MAX_MS', 5000), unit: 'ms', measured: guardTimings().length > 0, pass: false },
    // Phase-timeline SLOs (the P0-3 gates). These measure BIMAX overhead, not provider queue time,
    // so they are honest, deterministic budgets a CI gate can fail on.
    // Greeting lane: Bimax work before the provider request must be tiny (p95 <= 250ms).
    { metric: 'greeting_overhead_p95', value: snapshot.liteOverheadP95, budget: envBudget('BIMAX_BUDGET_GREETING_OVERHEAD_P95_MS', 250), unit: 'ms', measured: snapshot.liteOverheadP95 > 0, pass: false },
    // Raw provider chunk → visible engine token (our filter/emit path): p95 <= 100ms.
    { metric: 'render_p95', value: snapshot.renderP95, budget: envBudget('BIMAX_BUDGET_RENDER_P95_MS', 100), unit: 'ms', measured: snapshot.renderP95 > 0, pass: false },
  ];
  for (const check of checks) check.pass = check.measured && check.value <= check.budget;
  return checks;
}

/**
 * Hard gate: throw if any MEASURED budget is over. A performance regression must FAIL a run, not just
 * be reported (the v1.0.0 first-token p95 of 120s "passed" while the product was visibly broken).
 * Unmeasured metrics never fail — you can't regress what a headless CI run never exercised. Returns
 * the failing checks list for the caller to log; callers that want soft reporting use the report fn.
 */
export function assertPerformanceBudgets(snapshot: PerfSnapshot = perfSnapshot()): PerformanceBudgetCheck[] {
  const failures = performanceBudgetReport(snapshot).filter(c => c.measured && !c.pass);
  if (failures.length > 0) {
    const detail = failures.map(f => `${f.metric} ${f.value}${f.unit} > ${f.budget}${f.unit}`).join('; ');
    throw new Error(`Performance budget regression: ${detail}`);
  }
  return failures;
}
