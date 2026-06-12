import { Logger } from '../utils';
import { IEventBus } from '../core/interfaces';

interface TriggerTask {
  taskId: string;
  eventName: string;
  payload: any;
}

export class TriggerExecutor {
  private tasks: TriggerTask[] = [];
  private listeningEvents: Set<string> = new Set();

  constructor(private eventBus: IEventBus) {
    // Monkey patching removed for security.
  }

  private handleEvent(eventName: string, eventData: any) {
    const matchedTasks = this.tasks.filter(t => t.eventName === eventName);
    for (const task of matchedTasks) {
      Logger.info(`[TriggerExecutor] ⚡ Instant System Event detected: '${eventName}'. Firing Task ${task.taskId}!`);
      // Bug 4 Fix: Actually emit the execution event instead of a silent no-op
      this.eventBus.emit('TASK_QUEUED', task.payload);
    }
  }

  execute(taskId: string, payload: any) {
    // We map the payload.triggerOn to the specific event string
    const eventName = payload?.triggerOn || 'SYSTEM_GENERIC';
    
    // Avoid duplicate task registrations
    if (!this.tasks.some(t => t.taskId === taskId && t.eventName === eventName)) {
      this.tasks.push({ taskId, eventName, payload });
    }
    
    // Register listener natively but ensure we don't accumulate duplicates
    if (!this.listeningEvents.has(eventName)) {
      this.listeningEvents.add(eventName);
      this.eventBus.on(eventName, (eventData) => {
        this.handleEvent(eventName, eventData);
      });
    }
    
    Logger.info(`[TriggerExecutor] Registered Task ${taskId} to trigger instantly on event: '${eventName}'`);
  }
}
