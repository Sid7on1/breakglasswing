import { EventEmitter } from 'events';
import { IEventBus } from './interfaces';

export class EventBus implements IEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Prevent unhandled error crashes if no listeners for 'error'
    this.emitter.on('error', (err) => {
      console.error(`[EventBus] Unhandled error event: ${err.message}`);
    });
  }

  emit(event: string, ...args: any[]): boolean {
    return this.emitter.emit(event, ...args);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.emitter.off(event, handler);
  }
}
