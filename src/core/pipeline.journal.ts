import { getEventLedger, EventLedger } from '../mind/event.ledger';

/**
 * Durable pipelines (v2 §3.10) — every multi-step orchestration becomes a JOURNALED
 * state machine over the event ledger. Each step transition is an append-only event;
 * crash recovery is a refold: re-open the same run and completed steps return their
 * recorded results instead of re-executing. Worktrees and branches already survive a
 * crash (they're on disk/in git); the journal is what tells a resumed run which of
 * them belong to steps that finished.
 *
 * Honest contract:
 *   - A step is SKIPPED on resume only when its recorded result round-trips through
 *     JSON within the size cap. Anything bigger re-runs — which is why steps must be
 *     idempotent-or-cheap by construction (the ones we wrap are: speculation re-picks,
 *     swarm re-decomposes into fresh worktrees, heal re-measures).
 *   - Failures are journaled too (`step_failed` + error), so `/pipelines` can show
 *     exactly where a run died and what it had already banked.
 */

const RESULT_CAP = 8_192; // recorded results above this re-run on resume instead of lying

export interface PipelineEvent {
  pipeline: string;
  run: string;                       // idempotency key for one run (baseKey@n)
  step?: string;
  phase: 'run_start' | 'step_start' | 'step_done' | 'step_failed' | 'run_done' | 'run_failed';
  result?: unknown;
  error?: string;
}

export interface RunState {
  run: string;
  started: boolean;
  finished: boolean;
  failed: boolean;
  steps: Record<string, { done: boolean; failed?: string; result?: unknown; resumable: boolean }>;
  lastStep?: string;
}

/** Fold every journal event for one pipeline into per-run state (a view, like everything). */
export function foldRuns(ledger: EventLedger, pipeline: string): Record<string, RunState> {
  const runs: Record<string, RunState> = {};
  for (const e of ledger.byType('pipeline')) {
    const p = e.payload as PipelineEvent;
    if (!p || p.pipeline !== pipeline || !p.run) continue;
    const r = runs[p.run] || (runs[p.run] = { run: p.run, started: false, finished: false, failed: false, steps: {} });
    switch (p.phase) {
      case 'run_start': r.started = true; break;
      case 'run_done': r.finished = true; break;
      case 'run_failed': r.finished = true; r.failed = true; break;
      case 'step_start':
        if (p.step) { r.steps[p.step] = { done: false, resumable: false }; r.lastStep = p.step; }
        break;
      case 'step_done':
        if (p.step) {
          const resumable = p.result !== undefined;
          r.steps[p.step] = { done: true, result: p.result, resumable };
          r.lastStep = p.step;
        }
        break;
      case 'step_failed':
        if (p.step) { r.steps[p.step] = { done: false, failed: p.error || 'failed', resumable: false }; r.lastStep = p.step; }
        break;
    }
  }
  return runs;
}

export class PipelineJournal {
  private prior: RunState | null;

  private constructor(
    public readonly pipeline: string,
    public readonly run: string,
    private ledger: EventLedger,
    prior: RunState | null,
  ) {
    this.prior = prior;
    this.emit({ pipeline, run, phase: 'run_start' });
  }

  /**
   * Open a run for this pipeline+key: RESUMES the latest unfinished run with the same
   * base key (completed steps will short-circuit), otherwise starts a fresh numbered run.
   */
  static open(pipeline: string, baseKey: string, ledger: EventLedger = getEventLedger()): PipelineJournal {
    const runs = foldRuns(ledger, pipeline);
    const mine = Object.values(runs)
      .filter(r => r.run === baseKey || r.run.startsWith(`${baseKey}@`))
      .sort((a, b) => a.run.localeCompare(b.run, undefined, { numeric: true }));
    const last = mine[mine.length - 1];
    if (last && !last.finished) return new PipelineJournal(pipeline, last.run, ledger, last);
    const n = mine.length + 1;
    return new PipelineJournal(pipeline, n === 1 ? baseKey : `${baseKey}@${n}`, ledger, null);
  }

  /** Is this journal continuing a crashed/incomplete run? */
  get resumed(): boolean { return this.prior !== null; }

  private emit(p: PipelineEvent): void {
    try { this.ledger.append('pipeline', p as any); } catch { /* journal is best-effort, never the failure */ }
  }

  /**
   * Execute (or skip) one step. On a resumed run, a step that completed WITH a recorded
   * result returns that result without re-executing — the crash-recovery contract.
   */
  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.prior?.steps[name];
    if (prev?.done && prev.resumable) return prev.result as T;

    this.emit({ pipeline: this.pipeline, run: this.run, step: name, phase: 'step_start' });
    try {
      const result = await fn();
      let recorded: unknown = undefined;
      try {
        const json = JSON.stringify(result);
        if (json !== undefined && json.length <= RESULT_CAP) recorded = JSON.parse(json);
      } catch { /* unserializable results simply aren't resumable */ }
      this.emit({ pipeline: this.pipeline, run: this.run, step: name, phase: 'step_done', result: recorded });
      return result;
    } catch (e: any) {
      this.emit({ pipeline: this.pipeline, run: this.run, step: name, phase: 'step_failed', error: String(e?.message || e).slice(0, 500) });
      throw e;
    }
  }

  /** Close the run. A run left unclosed (crash) is what open() offers to resume. */
  finish(ok = true): void {
    this.emit({ pipeline: this.pipeline, run: this.run, phase: ok ? 'run_done' : 'run_failed' });
  }
}

/** Unfinished runs across a pipeline — the `/pipelines` view. */
export function incompleteRuns(pipeline: string, ledger: EventLedger = getEventLedger()): RunState[] {
  return Object.values(foldRuns(ledger, pipeline)).filter(r => r.started && !r.finished);
}
