import { Logger } from '../utils';
import { IShutdownCoordinator } from './interfaces';

export class ShutdownCoordinator implements IShutdownCoordinator {
  private isShuttingDown = false;
  private teardownHooks: (() => Promise<void>)[] = [];

  constructor() {
    this.registerSignalHandlers();
  }

  public registerTeardownHook(hook: () => Promise<void>) {
    this.teardownHooks.push(hook);
  }

  private registerSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

    signals.forEach(signal => {
      process.on(signal, async () => {
        Logger.warn(`\n[Shutdown] Caught signal ${signal}.`);
        await this.gracefulShutdown(signal);
      });
    });


  }

  private async gracefulShutdown(reason: string) {
    if (this.isShuttingDown) {
      Logger.warn('[Shutdown] Shutdown already in progress. Ignoring duplicate signal.');
      return;
    }

    this.isShuttingDown = true;
    Logger.info(`[Shutdown] Initiating idempotent graceful shutdown sequence... (Reason: ${reason})`);

    try {
      // Execute all teardown hooks sequentially
      for (let i = 0; i < this.teardownHooks.length; i++) {
        Logger.info(`[Shutdown] Executing teardown hook ${i + 1}/${this.teardownHooks.length}...`);
        await this.teardownHooks[i]();
      }
      
      Logger.info('[Shutdown] ✅ All teardown hooks completed cleanly. Exiting with code 0.');
      process.exit(0);

    } catch (error: any) {
      Logger.error(`[Shutdown] ❌ Fatal error during shutdown sequence: ${error.message}`);
      process.exit(1);
    }
  }

  public async initiateShutdown(): Promise<void> {
    await this.gracefulShutdown('programmatic');
  }
}

