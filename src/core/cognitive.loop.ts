import { GovernorVetoError } from './errors';
import { IGovernor, IDatabase, IEventBus } from './interfaces';
import { withCorrelation } from './correlation';
import { Logger } from '../utils/logger';
import { ActionRouter } from '../actions/action.router';
import { ContextEngine } from '../memory/context.engine';

export class CognitiveLoop {
  private isRunning = false;
  
  constructor(
    private router: ActionRouter,
    private db: IDatabase,
    private contextEngine: ContextEngine,
    private governor: IGovernor,
    private eventBus: IEventBus
  ) {}

  async start() {
    this.isRunning = true;
    Logger.info(`\n[CognitiveLoop] 🧠 Cognitive Loop initialized in Event-Driven mode.`);
    Logger.info(`[CognitiveLoop] Standing by for tasks at 0% CPU...`);

    // Subscribe to task queue events instead of busy-waiting
    this.eventBus.on('TASK_QUEUED', async (payload: any) => {
      if (!this.isRunning) return;
      await withCorrelation(() => this.processTask(payload));
    });

    // 🚨 Quarantine Listener
    this.eventBus.on('EMERGENCY_HALT', (payload: any) => {
      Logger.error(`\n[CognitiveLoop] 💀 RECEIVED EMERGENCY HALT SIGNAL: ${payload.reason}`);
      Logger.error(`[CognitiveLoop] 💀 INITIATING ABSOLUTE QUARANTINE. DISABLING NEURAL LOOP PERMANENTLY.`);
      this.stop();
    });
  }

  private async processTask(payload: any) {
    Logger.info(`\n=== ⚡ COGNITIVE WAKE EVENT ===`);
    Logger.info(`[CognitiveLoop] Task Received: ${payload.id || 'unknown'}`);
    
    try {
      // 1. Context Engine Injection
      Logger.info(`[CognitiveLoop] Injecting memory context...`);
      await this.contextEngine.buildContextAwarePrompt(JSON.stringify(payload));

      // 2. The Governor intercepts right before execution
      Logger.info(`[CognitiveLoop] Requesting Governor safety approval...`);
      await this.governor.approveTaskExecution(payload.category || 'TASK_EXECUTE', payload.data || {});
      
      // 3. Persist to Write-Ahead Log
      await this.db.saveEvent({ action: 'TASK_APPROVED', taskId: payload.id, payload });

      // 4. Physical Routing
      Logger.info(`[CognitiveLoop] Safely routing task to ActionRouter...`);
      await this.router.route({
        id: payload.id,
        category: payload.category || 'trigger',
        payload: payload.data
      });

    } catch (error: any) {
      if (error instanceof GovernorVetoError) {
        Logger.error(`[CognitiveLoop] 🛑 Governor blocked execution: ${error.message}`);
        await this.db.saveEvent({ action: 'TASK_BLOCKED', taskId: payload.id, reason: error.message });
      } else {
        Logger.error(`[CognitiveLoop] ❌ Unexpected Error during task execution: ${error.message}`);
        await this.db.saveEvent({ action: 'TASK_FAILED', taskId: payload.id, reason: error.message });
        
        // Error Recovery: Re-queue or notify system of failure
        this.eventBus.emit('TASK_FAILED', {
          id: payload.id,
          reason: error.message,
          originalPayload: payload
        });
      }
    }
  }

  stop() {
    this.isRunning = false;
    Logger.info(`[CognitiveLoop] 🛑 Loop Halted.`);
  }
}
