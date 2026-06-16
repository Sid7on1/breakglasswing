import { Worker } from 'worker_threads';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { cliEvents } from '../cli/events';

export interface SubAgentConfig {
  agentType: string;
  prompt: string;
  cwd: string;
  parentMode: string;
}

export class SubAgentManager {
  private activeWorkers = new Map<string, Worker>();
  private workerScriptPath: string;
  // A sub-agent that hangs (stalled stream, infinite loop) must not block the parent
  // forever. Configurable; defaults to 10 minutes — generous for slow reasoning models.
  private readonly workerTimeoutMs: number;

  // opts is a test seam: production callers use the default worker entrypoint and timeout.
  constructor(opts?: { workerScriptPath?: string; timeoutMs?: number }) {
    this.workerScriptPath = opts?.workerScriptPath ?? path.resolve(__dirname, '../cli/worker.entry.js');
    this.workerTimeoutMs = opts?.timeoutMs ?? parseInt(process.env.BGW_WORKER_TIMEOUT_MS || '600000', 10);
  }

  public spawnWorker(taskId: string, config: SubAgentConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      Logger.info(`[SubAgentManager] Spawning worker for task ${taskId} (Agent: ${config.agentType})`);

      const worker = new Worker(this.workerScriptPath, {
        workerData: config
      });

      this.activeWorkers.set(taskId, worker);

      // Watchdog: terminate and reject if the worker produces no result in time. Cleared
      // the moment the promise settles so a healthy worker never trips it.
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        Logger.error(`[SubAgentManager] Worker for task ${taskId} timed out after ${this.workerTimeoutMs}ms. Terminating.`);
        this.activeWorkers.delete(taskId);
        worker.terminate().catch(() => { /* best-effort */ });
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
          finalize(() => resolve(message.result));
        } else if (message.type === 'error') {
          finalize(() => reject(new Error(message.error)));
        } else if (message.type === 'log') {
          Logger.info(`[Worker ${taskId}] ${message.content}`);
        } else if (message.type === 'tool_event' && message.call) {
          // T3 — re-emit a sub-agent's tool activity on the main event bus, tagged so the UI nests
          // it under this spawn. Tag-and-forward only; never settles the spawn promise.
          const call = { ...message.call, parentId: taskId, agentLabel: config.agentType };
          cliEvents.emit(message.subtype === 'tool_call_result' ? 'tool_call_result' : 'tool_call', call);
        }
      });

      worker.on('error', (err) => {
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
