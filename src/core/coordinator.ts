import { Logger } from '../utils/logger';
import { IEventBus, IDatabase, IGovernor } from './interfaces';
import { WorkerAgent } from './worker.agent';
import { ActionRouter } from '../actions/action.router';
import { ContextEngine } from '../memory/context.engine';
import { LlmAdapter } from './llm.adapter';
import { ToolRegistry } from '../tools/tool.registry';

export class Coordinator {
  private isRunning = false;
  private pendingTasks: Set<string> = new Set();
  private retryCounts: Map<string, number> = new Map();
  
  constructor(
    private eventBus: IEventBus,
    private db: IDatabase,
    private router: ActionRouter,
    private contextEngine: ContextEngine,
    private governor: IGovernor,
    private llmAdapter: LlmAdapter,
    private toolRegistry: ToolRegistry
  ) {}

  public start() {
    this.isRunning = true;
    Logger.info(`\n[Coordinator] 🧠 Coordinator initialized in Event-Driven mode.`);
    Logger.info(`[Coordinator] Standing by for complex tasks...`);

    this.eventBus.on('COMPLEX_TASK_QUEUED', async (payload: any) => {
      if (!this.isRunning) return;
      await this.processComplexTask(payload);
    });

    this.eventBus.on('WORKER_COMPLETED', (payload: any) => {
      if (!this.isRunning) return;
      Logger.info(`[Coordinator] Received WORKER_COMPLETED for subtask: ${payload.id}`);
      this.pendingTasks.delete(payload.id);
      this.retryCounts.delete(payload.id);
      this.checkTaskCompletion(payload.parentId);
    });

    this.eventBus.on('WORKER_FAILED', (payload: any) => {
      if (!this.isRunning) return;
      
      const currentRetries = this.retryCounts.get(payload.id) || 0;
      if (currentRetries < 3) {
        this.retryCounts.set(payload.id, currentRetries + 1);
        Logger.warn(`[Coordinator] Received WORKER_FAILED for subtask: ${payload.id}. Retrying (${currentRetries + 1}/3)... Reason: ${payload.reason}`);
        this.dispatchWorker(payload.id, payload.parentId, payload.category || 'WORKER_START', payload.data || {});
      } else {
        Logger.error(`[Coordinator] Subtask ${payload.id} failed 3 times. Failing parent task ${payload.parentId}. Reason: ${payload.reason}`);
        this.pendingTasks.delete(payload.id);
        this.retryCounts.delete(payload.id);
        this.eventBus.emit('COMPLEX_TASK_FAILED', { id: payload.parentId, reason: `Subtask ${payload.id} failed fatally: ${payload.reason}` });
      }
    });

    this.eventBus.on('EMERGENCY_HALT', (payload: any) => {
      Logger.error(`\n[Coordinator] 💀 RECEIVED EMERGENCY HALT SIGNAL: ${payload.reason}`);
      this.stop();
    });
  }

  private dispatchWorker(subTaskId: string, parentId: string, category: string, data: any) {
    Logger.info(`[Coordinator] Dispatching worker for sub-task: ${subTaskId}`);
    
    const payloadData = {
      id: subTaskId,
      parentId,
      category,
      data
    };
    
    const worker = new WorkerAgent(this.router, this.db, this.contextEngine, this.governor, this.eventBus, this.llmAdapter, this.toolRegistry);
    
    setTimeout(() => {
      worker.execute(payloadData).catch(e => {
        Logger.error(`[Coordinator] Spontaneously spawned worker failed: ${e.message}`);
      });
    }, 0);
  }

  private async processComplexTask(payload: any) {
    Logger.info(`\n=== ⚡ COORDINATOR WAKE EVENT ===`);
    Logger.info(`[Coordinator] Complex Task Received: ${payload.id || 'unknown'}`);
    
    try {
      // 1. Synthesize task into multiple sub-tasks
      Logger.info(`[Coordinator] Synthesizing complex task into parallel sub-tasks...`);
      
      const subTasks = payload.subTasks || [];
      
      if (subTasks.length === 0) {
        Logger.warn(`[Coordinator] No sub-tasks to process for ${payload.id}`);
        return;
      }

      await this.db.saveEvent({ action: 'COMPLEX_TASK_STARTED', taskId: payload.id, subTaskCount: subTasks.length });

      // 2. Dispatch to workers concurrently
      for (let i = 0; i < subTasks.length; i++) {
        const subTaskId = `${payload.id}_sub_${i}`;
        this.pendingTasks.add(subTaskId);
        this.dispatchWorker(subTaskId, payload.id, subTasks[i].category, subTasks[i].data);
      }
    } catch (error: any) {
      Logger.error(`[Coordinator] ❌ Unexpected Error during synthesis: ${error.message}`);
    }
  }

  private checkTaskCompletion(parentId: string) {
    // For this demonstration, if pendingTasks is empty, we consider all tasks complete.
    if (this.pendingTasks.size === 0) {
      Logger.info(`\n[Coordinator] 🎉 All parallel workers completed for parent task: ${parentId}!`);
      this.eventBus.emit('COMPLEX_TASK_COMPLETED', { id: parentId });
    }
  }

  public stop() {
    this.isRunning = false;
    Logger.info(`[Coordinator] 🛑 Coordinator Halted.`);
  }
}
