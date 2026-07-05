import { Worker } from 'worker_threads';
import * as path from 'path';
import { existsSync } from 'fs';
import { Logger } from '../utils/logger';
import { cliEvents } from '../cli/events';
import { FLOOR_ENV } from '../sandbox/exec.sandbox';
import { globalSubAgentBlackboard } from './subagent.blackboard';

// Line-delimited sentinels the sub-agent SUBPROCESS (bun-compiled binary re-execing itself) writes to
// stdout, and the parent parses back into the same {type} messages a worker_thread posts. Shared with
// worker.entry.ts's runAsSubprocess so the two ends can never drift.
export const SUB_RESULT = '\x00BIMAX_SUB_RESULT\x00';
export const SUB_ERROR = '\x00BIMAX_SUB_ERROR\x00';
export const SUB_EVENT = '\x00BIMAX_SUB_EVENT\x00';

// The uniform surface both a Worker (Node dev/dist) and a child-process handle (bun binary) expose,
// so the spawn/timeout/settle logic below is identical for both transports.
interface WorkerHandle {
  on(event: 'message' | 'error' | 'exit', listener: (arg: any) => void): void;
  terminate(): void | Promise<number>;
}

export interface SubAgentConfig {
  agentType: string;
  prompt: string;
  cwd: string;
  parentMode: string;
  // What this agent is responsible for (paths/globs/topic) — its claim on the blackboard, used to
  // detect overlap with sibling agents and to show coverage in /subagents and the TUI panel.
  scope?: string;
  // Sandbox floor (BiMax v2): when set, the worker runs as an isolated autonomous episode —
  // Bash confined by the OS sandbox to this root with network denied, file tools' workspace
  // narrowed to it, net-facing tools not registered. Carried via the worker's own env copy.
  sandboxFloorRoot?: string;
}

export class SubAgentManager {
  private activeWorkers = new Map<string, WorkerHandle>();
  private workerScriptPath: string;
  // Extra Node args for the worker thread. In dev the engine runs from TypeScript source via `tsx`,
  // so the worker must load the tsx hooks to parse the .ts entry — otherwise `new Worker(...ts)`
  // throws "Cannot find module" / can't parse TS. Empty in prod (compiled .js needs no loader).
  private readonly workerExecArgv: string[];
  // True inside a `bun --compile` single binary (the shipped global install). There is no dist/ or
  // node_modules on disk there, so the worker can't be spawned from a filesystem path — it must be
  // the bun-EMBEDDED worker (see worker.target.bun.ts). Node dev/dist keep the compiled-.js path.
  private readonly isBun: boolean = !!(process as any).versions?.bun;
  // Set when a test passes an explicit worker script — that path always wins over bun-embedding.
  private readonly hasScriptOverride: boolean;
  // A sub-agent that hangs (stalled stream, infinite loop) must not block the parent
  // forever. Configurable; defaults to 10 minutes — generous for slow reasoning models.
  private readonly workerTimeoutMs: number;

  // opts is a test seam: production callers use the default worker entrypoint and timeout.
  constructor(opts?: { workerScriptPath?: string; timeoutMs?: number }) {
    // ALWAYS prefer a COMPILED worker entry. A worker thread does not reliably inherit a TypeScript
    // loader (tsx/ts-node) via execArgv across Node versions — passing `--import tsx` to the worker
    // fails to register the ESM hooks, which surfaced as "Cannot find package 'minimatch'" /
    // "Unknown file extension '.ts'" and killed EVERY sub-agent whenever the engine ran from source.
    // A plain .js worker under plain node needs no loader and just works.
    // Candidates: the sibling .js when we're already compiled (dist/core → dist/cli), and the dist
    // copy when running from source (src/core → ../../dist/cli). Fall back to the .ts entry + tsx
    // only if no compiled worker exists at all (pure-source checkout with no build).
    const compiledCandidates = [
      path.resolve(__dirname, '../cli/worker.entry.js'),
      path.resolve(__dirname, '../../dist/cli/worker.entry.js'),
    ];
    const compiledJs = compiledCandidates.find(existsSync);
    const tsPath = path.resolve(__dirname, '../cli/worker.entry.ts');
    this.hasScriptOverride = !!opts?.workerScriptPath;
    if (opts?.workerScriptPath) {
      this.workerScriptPath = opts.workerScriptPath;
      this.workerExecArgv = opts.workerScriptPath.endsWith('.ts') ? ['--import', 'tsx'] : [];
    } else if (compiledJs) {
      this.workerScriptPath = compiledJs;
      this.workerExecArgv = [];
    } else {
      this.workerScriptPath = tsPath;
      this.workerExecArgv = ['--import', 'tsx'];
    }
    this.workerTimeoutMs = opts?.timeoutMs ?? parseInt(process.env.BGW_WORKER_TIMEOUT_MS || '600000', 10);
  }

  // Choose the transport. Node dev/dist → a worker_thread (fast, shared address space). The
  // bun-compiled single binary → a CHILD PROCESS that re-execs the binary itself: worker_threads
  // in a bun --compile executable cannot resolve their dependencies (minimatch et al. aren't
  // bundled into the embedded worker), but a re-exec of the whole binary carries every dependency.
  private createHandle(taskId: string, config: SubAgentConfig, workerOpts: any): WorkerHandle {
    if (this.isBun && !this.hasScriptOverride) {
      return this.spawnSubprocessHandle(config, workerOpts);
    }
    return new Worker(this.workerScriptPath, { ...workerOpts, execArgv: this.workerExecArgv });
  }

  // Re-exec THIS binary with BIMAX_SUBAGENT_CONFIG set; index.ts detects it and runs the sub-agent
  // instead of the engine, streaming results back over stdout sentinels which we translate into the
  // same {type: 'success'|'error'|'tool_event'} messages a worker_thread would post.
  private spawnSubprocessHandle(config: SubAgentConfig, workerOpts: any): WorkerHandle {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawn } = require('child_process') as typeof import('child_process');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EventEmitter } = require('events') as typeof import('events');
    const env = { ...(workerOpts.env || process.env), BIMAX_SUBAGENT_CONFIG: JSON.stringify(config) };
    const child = spawn(process.execPath, [], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    const emitter = new EventEmitter();
    let buf = '';
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try {
          if (line.startsWith(SUB_RESULT)) emitter.emit('message', { type: 'success', result: JSON.parse(line.slice(SUB_RESULT.length)).result });
          else if (line.startsWith(SUB_ERROR)) emitter.emit('message', { type: 'error', error: JSON.parse(line.slice(SUB_ERROR.length)).error });
          else if (line.startsWith(SUB_EVENT)) { const e = JSON.parse(line.slice(SUB_EVENT.length)); emitter.emit('message', { type: 'tool_event', subtype: e.subtype, call: e.call }); }
          // any other line is stray child stdout — ignore it
        } catch { /* malformed sentinel line — ignore */ }
      }
    });
    child.on('error', (e: Error) => emitter.emit('error', e));
    child.on('exit', (code: number | null) => emitter.emit('exit', code ?? 0));
    return {
      on: (ev, fn) => { emitter.on(ev, fn); },
      terminate: () => { try { child.kill('SIGKILL'); } catch { /* best-effort */ } },
    };
  }

  /** Snapshot the blackboard onto the event bus so the /subagents view + TUI panel stay live. */
  private emitBoard(): void {
    try { cliEvents.emit('subagent_update', globalSubAgentBlackboard.all()); } catch { /* best-effort */ }
  }

  public spawnWorker(taskId: string, config: SubAgentConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      Logger.info(`[SubAgentManager] Spawning worker for task ${taskId} (Agent: ${config.agentType})`);
      globalSubAgentBlackboard.register(taskId, config.agentType, config.scope || '', config.prompt);
      this.emitBoard();

      const workerOpts = {
        workerData: config,
        // Floored episodes get their own env copy with the floor flag — thread-scoped, so the
        // parent session and sibling workers are unaffected.
        ...(config.sandboxFloorRoot
          ? { env: { ...process.env, [FLOOR_ENV]: config.sandboxFloorRoot } }
          : {}),
      };
      const worker: WorkerHandle = this.createHandle(taskId, config, workerOpts);

      this.activeWorkers.set(taskId, worker);

      // Watchdog: terminate and reject if the worker produces no result in time. Cleared
      // the moment the promise settles so a healthy worker never trips it.
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        Logger.error(`[SubAgentManager] Worker for task ${taskId} timed out after ${this.workerTimeoutMs}ms. Terminating.`);
        this.activeWorkers.delete(taskId);
        Promise.resolve(worker.terminate()).catch(() => { /* best-effort */ });
        reject(new Error(`Worker for task ${taskId} timed out after ${this.workerTimeoutMs}ms`));
      }, this.workerTimeoutMs);

      const finalize = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeWorkers.delete(taskId);
        fn();
      };

      worker.on('message', (message) => {
        if (message.type === 'success') {
          globalSubAgentBlackboard.markDone(taskId, typeof message.result === 'string' ? message.result : JSON.stringify(message.result));
          this.emitBoard();
          finalize(() => resolve(message.result));
        } else if (message.type === 'error') {
          globalSubAgentBlackboard.markFailed(taskId, String(message.error));
          this.emitBoard();
          finalize(() => reject(new Error(message.error)));
        } else if (message.type === 'log') {
          Logger.info(`[Worker ${taskId}] ${message.content}`);
        } else if (message.type === 'tool_event' && message.call) {
          // T3 — re-emit a sub-agent's tool activity on the main event bus, tagged so the UI nests
          // it under this spawn. Tag-and-forward only; never settles the spawn promise.
          globalSubAgentBlackboard.incTool(taskId);
          if (message.subtype === 'tool_call') this.emitBoard(); // one board refresh per new call, not per result
          const call = { ...message.call, parentId: taskId, agentLabel: config.agentType };
          cliEvents.emit(message.subtype === 'tool_call_result' ? 'tool_call_result' : 'tool_call', call);
        }
      });

      worker.on('error', (err) => {
        globalSubAgentBlackboard.markFailed(taskId, err?.message || String(err));
        this.emitBoard();
        finalize(() => reject(err));
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          finalize(() => reject(new Error(`Worker stopped with exit code ${code}`)));
        } else {
          // Worker exited cleanly but never posted a 'success' message — settle the
          // promise so the caller is never left hanging. No-op if already settled.
          finalize(() => resolve('Worker exited cleanly with no explicit result.'));
        }
      });
    });
  }

  public activeCount(): number {
    return this.activeWorkers.size;
  }

  public killWorker(taskId: string): void {
    const worker = this.activeWorkers.get(taskId);
    if (worker) {
      worker.terminate();
      this.activeWorkers.delete(taskId);
      Logger.warn(`[SubAgentManager] Terminated worker for task ${taskId}`);
    }
  }

  public killAll(): void {
    for (const [taskId, worker] of this.activeWorkers) {
      worker.terminate();
      Logger.warn(`[SubAgentManager] Terminated worker for task ${taskId}`);
    }
    this.activeWorkers.clear();
  }
}

export const globalSubAgentManager = new SubAgentManager();
