import { Worker } from 'worker_threads';
import * as path from 'path';
import { Logger } from '../utils/logger';

export interface SubAgentConfig {
  agentType: string;
  prompt: string;
  cwd: string;
  parentMode: string;
}

export class SubAgentManager {
  private activeWorkers = new Map<string, Worker>();
  private workerScriptPath: string;

  constructor() {
    // Determine path to the worker entrypoint
    this.workerScriptPath = path.resolve(__dirname, '../cli/worker.entry.js');
  }

  public spawnWorker(taskId: string, config: SubAgentConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      Logger.info(`[SubAgentManager] Spawning worker for task ${taskId} (Agent: ${config.agentType})`);

      const worker = new Worker(this.workerScriptPath, {
        workerData: config
      });

      this.activeWorkers.set(taskId, worker);

      worker.on('message', (message) => {
        if (message.type === 'success') {
          this.activeWorkers.delete(taskId);
          resolve(message.result);
        } else if (message.type === 'error') {
          this.activeWorkers.delete(taskId);
          reject(new Error(message.error));
        } else if (message.type === 'log') {
          Logger.info(`[Worker ${taskId}] ${message.content}`);
        }
      });

      worker.on('error', (err) => {
        this.activeWorkers.delete(taskId);
        reject(err);
      });

      worker.on('exit', (code) => {
        this.activeWorkers.delete(taskId);
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
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
