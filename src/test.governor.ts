import { CognitiveLoop } from './core/cognitive.loop';
import { ActionRouter } from './actions/action.router';
import { DatabaseConnection } from './storage/db.connection';
import { ContextEngine } from './memory/context.engine';
import { ShortTermMemory } from './memory/short.term';
import { LongTermMemory } from './memory/long.term';
import { VectorStore } from './memory/vector.store';
import { Governor } from './governor/governor';
import { EventBus } from './core/event.bus';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Emergency Governor Halt Test ---');

  // Initialize mock dependencies
  const db = new DatabaseConnection();
  await db.connect('sqlite://local');
  const eventBus = new EventBus();
  const router = new ActionRouter(eventBus);
  const shortTerm = new ShortTermMemory();
  const vectorStore = new VectorStore();
  const longTerm = new LongTermMemory(vectorStore);
  const context = new ContextEngine(shortTerm, longTerm);
  
  // Initialize and start Cognitive Loop
  const governor = new Governor(eventBus);
  const loop = new CognitiveLoop(router, db, context, governor, eventBus);
  await loop.start();

  // Send a malicious task over the global bus (Attempting to write to /etc/id_rsa)
  Logger.info('\n[Test] Simulating malicious FILE_WRITE request targeting /etc/id_rsa...');
  
  eventBus.emit('TASK_QUEUED', {
    id: 'task-malicious-001',
    category: 'FILE_WRITE',
    data: { targetPath: '/etc/id_rsa', content: 'fake-key' }
  });

  // Wait a second to allow async event processing
  await new Promise(r => setTimeout(r, 1000));
  
  Logger.info('\n[Test] Sending a benign task to test if the agent is still alive...');
  
  eventBus.emit('TASK_QUEUED', {
    id: 'task-benign-002',
    category: 'API_CALL',
    data: { estimatedCost: 0.1 }
  });

  // Wait a second for processing
  await new Promise(r => setTimeout(r, 1000));
  
  Logger.info('\n[Test] Did task-benign-002 print? It should NOT have printed, proving the agent is completely paralyzed.');
}

main().catch(console.error);
