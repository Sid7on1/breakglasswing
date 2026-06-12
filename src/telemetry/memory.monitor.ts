import * as os from 'os';
import { Logger } from '../utils';

import { IEventBus } from '../core/interfaces';

export class MemoryMonitor {
  private isRunning = false;
  private monitorLoop: NodeJS.Timeout | null = null;

  constructor(
    private eventBus: IEventBus,
    private readonly MEM_WARNING_MB = 1000,
    private readonly MEM_CRITICAL_MB = 2000
  ) {}

  public start(intervalMs: number = 5000) {
    if (this.isRunning) {
      this.stop(); // Clear existing interval if called multiple times
    }
    
    this.isRunning = true;
    Logger.info(`[MemoryMonitor] Started tracking RSS usage. Critical limit: ${this.MEM_CRITICAL_MB}MB`);
    
    this.monitorLoop = setInterval(() => {
      if (!this.isRunning) {
        this.stop();
        return;
      }
      this.checkMemory();
    }, intervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.monitorLoop) {
      clearInterval(this.monitorLoop);
      this.monitorLoop = null;
    }
  }

  public getMemoryMB(): number {
    const memoryUsage = process.memoryUsage();
    return Math.round(memoryUsage.rss / 1024 / 1024);
  }

  private checkMemory() {
    const rssMB = this.getMemoryMB();
    
    if (rssMB > this.MEM_CRITICAL_MB) {
      Logger.error(`[MemoryMonitor] CRITICAL: Memory usage (${rssMB}MB) exceeded limit of ${this.MEM_CRITICAL_MB}MB.`);
      Logger.error(`[MemoryMonitor] Forcing clean restart to prevent OOM.`);
      // Emit EMERGENCY_HALT to trigger graceful shutdown (GlobalShutdown coordinates this)
      this.eventBus.emit('EMERGENCY_HALT', { reason: 'OUT_OF_MEMORY' });
    } 
    else if (rssMB > this.MEM_WARNING_MB) {
      Logger.warn(`[MemoryMonitor] WARNING: Memory usage (${rssMB}MB) approaching critical limit.`);
    }
  }
}
