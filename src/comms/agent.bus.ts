import { EventEmitter } from 'events';
import { Logger } from '../utils';

export interface BusEvent {
  topic: string;
  payload: any;
}

export class AgentBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50); // support many agents
  }

  publish(topic: string, payload: any): void {
    // Logger.info(`[Bus] Published event on topic: ${topic}`);
    this.emitter.emit(topic, payload);
  }

  subscribe(topic: string, callback: (payload: any) => void): void {
    Logger.info(`[Bus] New subscription on topic: ${topic}`);
    this.emitter.on(topic, callback);
  }
}
