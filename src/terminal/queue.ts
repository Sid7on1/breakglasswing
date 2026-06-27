import { Logger } from '../utils';

interface QueueItem {
  command: string;
  resolve: (value: string) => void;
  reject: (reason?: any) => void;
  timeoutHandle: NodeJS.Timeout;
}

export class CommandQueue {
  private queue: QueueItem[] = [];

  enqueue(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      Logger.warn(`[CommandQueue] Terminals busy. Pushing task to queue. (Queue depth: ${this.queue.length + 1})`);
      
      const timeout = setTimeout(() => {
        // Remove from queue
        this.queue = this.queue.filter(q => q.resolve !== resolve);
        reject(new Error("CommandQueue timeout: Session never became available after 60s"));
      }, 60000);

      const wrappedResolve = (value: string) => {
        clearTimeout(timeout);
        resolve(value);
      };

      const wrappedReject = (reason?: any) => {
        clearTimeout(timeout);
        reject(reason);
      };

      this.queue.push({ command, resolve: wrappedResolve, reject: wrappedReject, timeoutHandle: timeout });
    });
  }

  dequeue(): QueueItem | undefined {
    const item = this.queue.shift();
    if (item) {
      clearTimeout(item.timeoutHandle);
    }
    return item;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}
