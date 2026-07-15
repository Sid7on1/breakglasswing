import {
  markReady, recordTurn, perfSnapshot, __resetPerf,
  beginTurnTimeline, markRouted, markAssembled, markProviderRequest,
  markFirstRawChunk, markFirstVisibleToken, endTurnTimeline, loadPersistedTimelines,
} from '../telemetry/perf';
import { renderPerf } from '../cli/commands/perf';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

describe('perf phase timeline', () => {
  it('marks phases, splits overhead vs provider wait vs render, and marks are first-wins', () => {
    __resetPerf();
    beginTurnTimeline('lite', 'stepfun-ai/step-3.7-flash');
    markRouted();
    markAssembled();
    markProviderRequest();
    markFirstRawChunk();
    markFirstVisibleToken();
    markFirstVisibleToken(); // idempotent — must not overwrite
    const b = endTurnTimeline();
    expect(b).not.toBeNull();
    expect(b!.lane).toBe('lite');
    expect(b!.overheadMs).toBeGreaterThanOrEqual(0);
    expect(b!.providerWaitMs).toBeGreaterThanOrEqual(0);
    expect(b!.renderMs).toBeGreaterThanOrEqual(0);
    const s = perfSnapshot();
    expect(s.lastBreakdown?.lane).toBe('lite');
    expect(s.liteOverheadP95).toBeGreaterThanOrEqual(0);
  });

  it('marks are safe no-ops when no turn is active', () => {
    __resetPerf();
    expect(() => { markProviderRequest(); markFirstRawChunk(); }).not.toThrow();
    expect(endTurnTimeline()).toBeNull();
  });

  it('persists a bounded, secret-free record that survives a restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-perf-'));
    const prev = process.env.BIMAX_PERF_DIR;
    process.env.BIMAX_PERF_DIR = dir;
    try {
      __resetPerf();
      beginTurnTimeline('full', 'stepfun-ai/step-3.7-flash');
      markProviderRequest();
      markFirstRawChunk();
      endTurnTimeline();
      const raw = fs.readFileSync(path.join(dir, 'perf.jsonl'), 'utf-8');
      expect(raw).toContain('"lane":"full"');
      expect(raw).not.toMatch(/prompt|content|message/i); // secret-free
      // Simulate a restart: fresh in-memory state, then reload from disk.
      __resetPerf();
      expect(perfSnapshot().lastBreakdown).toBeNull();
      loadPersistedTimelines();
      expect(perfSnapshot().lastBreakdown?.lane).toBe('full');
    } finally {
      if (prev === undefined) delete process.env.BIMAX_PERF_DIR; else process.env.BIMAX_PERF_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
