import { ShutdownCoordinator } from './core/shutdown.coordinator';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Advanced Shutdown Coordinator Test ---');
  
  const GlobalShutdown = new ShutdownCoordinator();

  // 1. Mock the Cognitive Loop Teardown
  GlobalShutdown.registerTeardownHook(async () => {
    Logger.info('[Teardown: CognitiveLoop] Halting infinite processing loop...');
    await new Promise(r => setTimeout(r, 200));
    Logger.info('[Teardown: CognitiveLoop] Loop Halted.');
  });

  // 2. Mock the Terminal Multiplexer Teardown
  GlobalShutdown.registerTeardownHook(async () => {
    Logger.info('[Teardown: Multiplexer] Identifying 3 zombie child processes...');
    await new Promise(r => setTimeout(r, 300));
    Logger.info('[Teardown: Multiplexer] SIGKILL sent to all child terminals.');
  });

  // 3. Mock the State Sync Teardown
  GlobalShutdown.registerTeardownHook(async () => {
    Logger.info('[Teardown: StateSync] Performing final incremental cloud upload...');
    await new Promise(r => setTimeout(r, 400));
    Logger.info('[Teardown: StateSync] Upload complete.');
  });

  // 4. Mock the Database WAL Checkpoint
  GlobalShutdown.registerTeardownHook(async () => {
    Logger.info('[Teardown: Database] Flushing WAL checkpoint to disk...');
    await new Promise(r => setTimeout(r, 200));
    Logger.info('[Teardown: Database] WAL flush successful.');
  });

  Logger.info('\n[Agent] System is online and running normally.');
  Logger.info('[Agent] Simulating user pressing Ctrl+C (SIGINT) in 2 seconds...');

  setTimeout(() => {
    Logger.warn('\n>>> SIMULATING SIGINT <<<');
    process.emit('SIGINT' as any);
  }, 2000);

  setTimeout(() => {
    Logger.warn('\n>>> SIMULATING SPAM SIGINT (Should be ignored due to idempotency) <<<');
    process.emit('SIGINT' as any);
  }, 2100);

  // Keep script alive long enough for tests
  setInterval(() => {}, 1000);

}

main().catch(console.error);
