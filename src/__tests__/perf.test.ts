import { markReady, recordTurn, perfSnapshot, __resetPerf } from '../telemetry/perf';
import { renderPerf } from '../cli/commands/perf';

afterEach(() => __resetPerf());

describe('perf tracker', () => {
  it('reports cold-start after markReady and aggregates turn latency', () => {
    __resetPerf();
    markReady();
    recordTurn({ firstTokenMs: 120, totalMs: 800, tokens: 500 });
    recordTurn({ firstTokenMs: 300, totalMs: 1500, tokens: 900 });
    const s = perfSnapshot();
    expect(s.coldStartMs).toBeGreaterThanOrEqual(0);
    expect(s.turns).toBe(2);
    expect(s.firstTokenP50).toBeGreaterThan(0);
    expect(s.firstTokenP95).toBeGreaterThanOrEqual(s.firstTokenP50);
    expect(s.lastTurn?.tokens).toBe(900);
    expect(s.rssMb).toBeGreaterThan(0);
  });

  it('markReady is idempotent (first ready wins)', () => {
    __resetPerf();
    markReady();
    const first = perfSnapshot().coldStartMs;
    markReady();
    expect(perfSnapshot().coldStartMs).toBe(first);
  });

  it('renderPerf surfaces the headline numbers', () => {
    __resetPerf();
    markReady();
    recordTurn({ firstTokenMs: 90, totalMs: 500, tokens: 200 });
    const out = renderPerf(perfSnapshot());
    expect(out).toMatch(/Cold start/);
    expect(out).toMatch(/first-token/i);
    expect(out).toMatch(/Memory/);
  });
});
