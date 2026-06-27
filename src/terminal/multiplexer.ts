import { BaseAdapter } from './base.adapter';
import { CommandQueue } from './queue';
import { Logger } from '../utils';

export class TerminalMultiplexer {
  private sessions: Map<string, BaseAdapter> = new Map();
  private queues: Map<string, CommandQueue> = new Map();

  constructor(private maxPoolSize: number = 3) {}

  /**
   * Registers a new adapter session into the multiplexer.
   */
  async registerSession(adapter: BaseAdapter): Promise<string> {
    await adapter.spawnSession();
    this.sessions.set(adapter.getId(), adapter);
    if (!this.queues.has(adapter.getToolName())) {
      this.queues.set(adapter.getToolName(), new CommandQueue());
    }
    return adapter.getId();
  }

  /**
   * Gets an available session for a specific tool.
   */
  private getAvailableSession(toolName: string): BaseAdapter | undefined {
    for (const [id, adapter] of this.sessions.entries()) {
      if (adapter.getToolName() === toolName && !adapter.isSessionBusy()) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * Routes a command. Buffers to queue if busy.
   */
  async routeCommand(toolName: string, command: string): Promise<string> {
    if (!this.queues.has(toolName)) {
      this.queues.set(toolName, new CommandQueue());
    }

    const session = this.getAvailableSession(toolName);
    const queue = this.queues.get(toolName)!;
    
    if (!session) {
      // Auto-scale condition hit. Place in queue to await a free session.
      return queue.enqueue(command);
    }

    // Execute immediately
    try {
      const output = await session.execute(command);
      return output;
    } finally {
      // Process queue now that we are free
      this.processQueue(toolName, session);
    }
  }

  private async processQueue(toolName: string, session: BaseAdapter) {
    const queue = this.queues.get(toolName);
    if (!queue || queue.isEmpty() || session.isSessionBusy()) return;

    const item = queue.dequeue();
    if (item) {
      Logger.info(`[Multiplexer] Dequeued task for ${toolName}. Assigning to ${session.getId()}...`);
      try {
        const output = await session.execute(item.command);
        item.resolve(output);
      } catch (err) {
        item.reject(err);
      }
      // Recursive call to drain queue
      this.processQueue(toolName, session);
    }
  }

  /**
   * Closes all active sessions.
   */
  async shutdownAll(): Promise<void> {
    for (const [id, adapter] of this.sessions.entries()) {
      await adapter.killSession();
    }
    this.sessions.clear();
    Logger.info('[Multiplexer] All sessions shut down cleanly.');
  }
}
