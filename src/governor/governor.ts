import { BudgetVeto } from './budget.veto';
import { FileSystemVeto } from './fs.veto';
import { Logger } from '../utils';
import { GovernorVetoError } from '../core/errors';
import { IGovernor, IEventBus } from '../core/interfaces';

export class Governor implements IGovernor {
  public budget: BudgetVeto;
  public fs: FileSystemVeto;

  constructor(private eventBus: IEventBus) {
    this.budget = new BudgetVeto();
    this.fs = new FileSystemVeto();
    Logger.info('[Governor] Initialized safety oversight engine.');
  }

  public async approveTaskExecution(taskType: string, payload: any): Promise<void> {
    Logger.info(`[Governor] Analyzing proposed task: ${taskType}`);
    
    try {
      if (taskType === 'FILE_WRITE' || taskType === 'FILE_DELETE') {
        await this.fs.checkVeto(payload.targetPath);
      }
      
      if (taskType === 'API_CALL') {
        // budget checkVeto is sync for now, but we can await it just in case
        await this.budget.checkVeto(payload.estimatedCost);
      }
    } catch (e: any) {
      if (e instanceof GovernorVetoError) {
        Logger.error(`[Governor] 🚨 SEVERE VIOLATION DETECTED. BROADCASTING EMERGENCY HALT. 🚨`);
        this.eventBus.emit('EMERGENCY_HALT', { reason: e.message });
      }
      throw e;
    }

    Logger.info(`[Governor] ✅ Veto cleared. Task approved.`);
  }
}
