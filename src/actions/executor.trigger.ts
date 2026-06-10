import { Logger } from '../utils';
import { IEventBus } from '../core/interfaces';

interface TriggerTask {
  taskId: string;
  eventName: string;
  payload: any;
}

export class TriggerExecutor {
  private tasks: TriggerTask[] = [];

  constructor(private eventBus: IEventBus) {
    // Monkey patching removed for security.
  }

  private handleEvent(eventName: string, eventData: any) {
    const matchedTasks = this.tasks.filter(t => t.eventName === eventName);
    
    for (const task of matchedTasks) {
      Logger.info(`[TriggerExecutor] ⚡ Instant System Event detected: '${eventName}'. Firing Task ${task.taskId}!`);
    }
  }

  execute(taskId: string, payload: any) {
    // We map the payload.triggerOn to the specific event string
    const eventName = payload?.triggerOn || 'SYSTEM_GENERIC';
    this.tasks.push({ taskId, eventName, payload });
    
    // Register listener natively instead of hijacking emit
    this.eventBus.on(eventName, (eventData) => {
      this.handleEvent(eventName, eventData);
    });
    
    Logger.info(`[TriggerExecutor] Registered Task ${taskId} to trigger instantly on event: '${eventName}'`);
  }
}
