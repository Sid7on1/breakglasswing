import { Logger } from '../utils';

interface QueueItem {
  command: string;
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
}

export class CommandQueue {
  private queue: QueueItem[] = [];

  enqueue(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      Logger.warn(`[CommandQueue] Terminals busy. Pushing task to queue. (Queue depth: ${this.queue.length + 1})`);
      this.queue.push({ command, resolve, reject });
    });
  }

  dequeue(): QueueItem | undefined {
    return this.queue.shift();
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}
