import { performanceBudgetReport } from '../telemetry/performance.budget';
import { PerfSnapshot } from '../telemetry/perf';

describe('performance budgets', () => {
  it('distinguishes passing, over-budget, and unmeasured metrics', () => {
    const snapshot: PerfSnapshot = {
      coldStartMs: 1200, uptimeMs: 2000, rssMb: 2048, heapMb: 100, turns: 0,
      firstTokenP50: 0, firstTokenP95: 0, lastTurn: null,
    };
    const checks = performanceBudgetReport(snapshot);
    expect(checks.find(check => check.metric === 'cold_start')).toMatchObject({ measured: true, pass: true });
    expect(checks.find(check => check.metric === 'rss')).toMatchObject({ measured: true, pass: false });
    expect(checks.find(check => check.metric === 'first_token_p95')).toMatchObject({ measured: false, pass: false });
  });
});
