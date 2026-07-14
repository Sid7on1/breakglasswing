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
  ];
  for (const check of checks) check.pass = check.measured && check.value <= check.budget;
  return checks;
}
