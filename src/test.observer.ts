import { GraphStore } from './graph/graph.store';
import { GraphObserver } from './graph/graph.observer';
import { EventBus } from './core/event.bus';
import * as path from 'path';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Graph Observer Test ---');
  
  const projectRoot = process.cwd();
  const storePath = path.join(projectRoot, '.breakglass_graph', 'playground.json');
  
  const store = new GraphStore(storePath);
  await store.loadFromDisk();

  const eventBus = new EventBus();
  
  // Register a dummy listener to prove VERIFY task is dispatched
  eventBus.on('TASK_QUEUED', (payload) => {
    Logger.info(`[Test] Caught internal task dispatch: ${JSON.stringify(payload)}`);
  });

  const observer = new GraphObserver(eventBus, store, projectRoot);
  observer.start();

  // Simulate a file write
  const testFilePath = path.join(projectRoot, 'src', 'core', 'event.bus.ts');
  Logger.info(`\n[Test] Simulating FILE_WRITE for ${testFilePath}`);
  
  eventBus.emit('FILE_WRITE', { filePath: testFilePath });

  // Wait a moment for async observer to process
  setTimeout(() => {
    Logger.info('\n--- Graph Observer Test Complete ---');
    process.exit(0);
  }, 2000);
}

main().catch(console.error);
