import { Logger } from '../utils';
import { ActionRouter } from '../actions';
import { CognitiveLoop } from './cognitive.loop';
import { IShutdownCoordinator } from './interfaces';

export interface OrchestratorDeps {
  actionRouter: ActionRouter;
  loop: CognitiveLoop;
  shutdown: IShutdownCoordinator;
}

export class Orchestrator {
  constructor(private deps: OrchestratorDeps) {}

  async run() {
    Logger.info('Handing over to Event-Driven Cognitive Loop.');
    
    try {
      this.deps.shutdown.registerTeardownHook(async () => this.deps.actionRouter.shutdown());
      this.deps.shutdown.registerTeardownHook(async () => this.deps.loop.stop());

      // Start Brain
      await this.deps.loop.start();
    } catch (error: any) {
      Logger.error(`\n🚨 FATAL ORCHESTRATION EXCEPTION: ${error.message}\n`);
      Logger.error(error.stack);
      
      // Trigger graceful shutdown on fatal error
      await this.deps.shutdown.initiateShutdown();
      process.exit(1);
    }
  }
}
