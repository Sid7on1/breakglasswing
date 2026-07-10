import { getEventLedger, EventLedger } from '../mind/event.ledger';

/**
 * WS2.1 — sub-agent lifecycle instrumentation ("instrument first, opine second").
 *
 * Every spawn is journaled into the event ledger as a series of `subagent` events,
 * all timestamped by the PARENT the moment the worker's message arrives — no
 * worker-side ledger writes (a second SQLite writer per worker thread is exactly
 * the kind of overhead we're trying to measure, not add):
 *
 *   spawned     — spawnWorker entered (t0; msToSpawn covers worktree creation)
 *   first_event — first message of ANY kind from the worker (the "first token"
 *                 proxy: persona built, model responded, first tool armed)
 *   tool_call   — each tool invocation the worker relays (name + elapsed)
 *   settled     — terminal state: done | failed | timeout, with total wall time
 *                 and tool-call count
 *
 * `foldSubagentRuns` refolds the raw events into per-spawn timing rows so
 * /subagents (and WS2's measurement pass) can answer: where do the seconds go —
 * spawn overhead, time-to-first-event, or the tool loop itself?
 */

export interface SubagentJournalEvent {
  taskId: string;
  phase: 'spawned' | 'first_event' | 'tool_call' | 'settled';
  agentType?: string;
  model?: string;        // explicit override only; unset = inherited config
  depth?: number;
  isolation?: string;
  tool?: string;         // tool_call only
  outcome?: 'done' | 'failed' | 'timeout'; // settled only
  ms?: number;           // elapsed since spawned (first_event / tool_call / settled)
  toolCalls?: number;    // settled only — total relayed tool calls
}

/** Append one lifecycle event. Best-effort by construction (ledger never throws). */
export function journalSubagent(ev: SubagentJournalEvent): void {
  getEventLedger().append('subagent', ev);
}

export interface SubagentRunTiming {
  taskId: string;
  agentType: string;
  spawnedAt: number;          // ledger ts of the spawned event
  msToFirstEvent?: number;    // spawn → first worker message
  msTotal?: number;           // spawn → settled
  toolCalls: number;
  outcome?: 'done' | 'failed' | 'timeout';
  // Per-tool call log (name + elapsed) — the raw material for "where do the seconds go".
  calls: Array<{ tool: string; ms: number }>;
}

/** Fold raw `subagent` ledger events into per-spawn timing rows, oldest first. */
export function foldSubagentRuns(ledger: EventLedger = getEventLedger()): SubagentRunTiming[] {
  const runs = new Map<string, SubagentRunTiming>();
  for (const e of ledger.byType('subagent')) {
    const p = e.payload as SubagentJournalEvent;
    if (!p?.taskId) continue;
    let r = runs.get(p.taskId);
    switch (p.phase) {
      case 'spawned':
        runs.set(p.taskId, { taskId: p.taskId, agentType: p.agentType || '?', spawnedAt: e.ts, toolCalls: 0, calls: [] });
        break;
      case 'first_event':
        if (r && r.msToFirstEvent === undefined) r.msToFirstEvent = p.ms;
        break;
      case 'tool_call':
        if (r) { r.toolCalls++; r.calls.push({ tool: p.tool || '?', ms: p.ms ?? 0 }); }
        break;
      case 'settled':
        if (r) { r.msTotal = p.ms; r.outcome = p.outcome; if (p.toolCalls !== undefined) r.toolCalls = p.toolCalls; }
        break;
    }
  }
  return [...runs.values()];
}

/** One-line summary per run — what /subagents timings prints and tests assert on. */
export function summarizeRun(r: SubagentRunTiming): string {
  const parts = [
    `${r.taskId} [${r.agentType}]`,
    r.outcome ?? 'running',
    r.msToFirstEvent !== undefined ? `first-event ${r.msToFirstEvent}ms` : 'no events',
    r.msTotal !== undefined ? `total ${r.msTotal}ms` : null,
    `${r.toolCalls} tool call(s)`,
  ].filter(Boolean);
  return parts.join(' · ');
}
