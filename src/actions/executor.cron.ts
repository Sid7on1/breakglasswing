import { Logger } from '../utils';
import { CronExpressionParser } from 'cron-parser';

export class CronExecutor {
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    Logger.info(`[CronExecutor] Background daemon booted. Standing by for cron schedules.`);
  }

  start(taskId: string, payload: any, schedule: string) {
    this.scheduleNext(taskId, payload, schedule);
    Logger.info(`[CronExecutor] Registered Task ${taskId} with precise Cron schedule: [${schedule}]`);
  }

  private scheduleNext(taskId: string, payload: any, schedule: string) {
    try {
      const interval = CronExpressionParser.parse(schedule);
      const nextExecution = interval.next().toDate();
      let delay = nextExecution.getTime() - Date.now();
      
      // Prevent immediate execution loop if delay is exactly 0 due to precision
      if (delay <= 0) delay = 1000;

      const timer = setTimeout(() => {
        Logger.info(`[CronExecutor] ⏰ TICK! Executing Task ${taskId} (Schedule: ${schedule})`);
        // The event bus routing logic goes here in the real system
        this.scheduleNext(taskId, payload, schedule);
      }, delay);

      this.timers.set(taskId, timer);
    } catch (err: any) {
      Logger.error(`[CronExecutor] Invalid cron expression for task ${taskId}: ${schedule}. Error: ${err.message}`);
    }
  }

  stop() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    Logger.info(`[CronExecutor] Shutdown complete. All timers cleared.`);
  }
}
