/**
 * Lightweight in-memory telemetry — per-tool latency histograms + cache-hit tracking.
 * No external SDK required. Data lives in memory for the session; exposed via /diagnostics.
 *
 * These are SESSION-wide aggregates. Per-task counters (turns, tool calls, tokens for one
 * `execute()`) live in `./task.metrics`, which this module forwards to so that a tool call is
 * counted in exactly one place.
 */

import { taskMetrics } from './task.metrics';

export interface ToolSummary {
  name: string;
  count: number;
  avgMs: number;
  minMs: number;
  p95Ms: number;
  maxMs: number;
}

// Reservoir size: 500 samples per tool gives accurate p95 without unbounded memory growth.
// Reservoir sampling ensures late calls are represented equally — unlike a "first N then stop"
// approach, which would bias p95 toward the cold-start burst at session open.
const RESERVOIR = 500;

interface ToolStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  reservoir: number[];
}

class TelemetryStore {
  private toolStats = new Map<string, ToolStats>();
  private cacheReadTokens = 0;
  private cacheCreationTokens = 0;
  private totalPromptTokens = 0;

  recordToolCall(toolName: string, durationMs: number): void {
    // Forward to the live task, if one is recording. Done here rather than at the agent-loop call
    // site so the per-task counters cannot drift from the session-wide ones: there is exactly one
    // place a tool call is counted, and both consumers read it.
    taskMetrics.recordToolCall(toolName);

    let s = this.toolStats.get(toolName);
    if (!s) {
      s = { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, reservoir: [] };
      this.toolStats.set(toolName, s);
    }
    s.count++;
    s.totalMs += durationMs;
    if (durationMs < s.minMs) s.minMs = durationMs;
    if (durationMs > s.maxMs) s.maxMs = durationMs;

    if (s.reservoir.length < RESERVOIR) {
      s.reservoir.push(durationMs);
    } else {
      // Replace a random slot: keeps a statistically uniform sample across the whole session.
      const idx = Math.floor(Math.random() * s.count);
      if (idx < RESERVOIR) s.reservoir[idx] = durationMs;
    }
  }

  recordUsage(promptTokens: number, cacheRead: number, cacheCreation: number): void {
    taskMetrics.recordUsage(promptTokens, cacheRead, cacheCreation);

    this.totalPromptTokens += promptTokens;
    this.cacheReadTokens += cacheRead;
    this.cacheCreationTokens += cacheCreation;
  }

  getToolStats(): ToolSummary[] {
    const out: ToolSummary[] = [];
    for (const [name, s] of this.toolStats) {
      const avg = s.count > 0 ? Math.round(s.totalMs / s.count) : 0;
      const sorted = [...s.reservoir].sort((a, b) => a - b);
      const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
      out.push({
        name,
        count: s.count,
        avgMs: avg,
        minMs: s.minMs === Infinity ? 0 : Math.round(s.minMs),
        p95Ms: Math.round(p95),
        maxMs: Math.round(s.maxMs),
      });
    }
    return out.sort((a, b) => b.count - a.count);
  }

  getCacheStats(): { readTokens: number; creationTokens: number; totalPrompt: number; hitRate: string } {
    const total = this.totalPromptTokens;
    const rate = total > 0 ? ((this.cacheReadTokens / total) * 100).toFixed(1) + '%' : 'n/a';
    return {
      readTokens: this.cacheReadTokens,
      creationTokens: this.cacheCreationTokens,
      totalPrompt: total,
      hitRate: rate,
    };
  }

  reset(): void {
    this.toolStats.clear();
    this.cacheReadTokens = 0;
    this.cacheCreationTokens = 0;
    this.totalPromptTokens = 0;
  }
}

export const globalTelemetry = new TelemetryStore();
