import { createContainer } from './core/container';
import { EventBus } from './core/event.bus';
import { Logger } from './utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  Logger.info('--- Initializing Robust Core Orchestrator Test ---');

  // 1. Setup Environment
  process.env.OPENAI_API_KEY = "sk-mock-orchestrator-key123";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
  process.env.AGENT_PORT = "8888";

  // Wipe old DB
  await fs.rm(path.join(process.cwd(), '.breakglass_db'), { recursive: true, force: true });

  const { orchestrator: app, bootloader } = createContainer();
  
  // 2. Boot the full system
  Logger.info('\n[Test] Booting the full Orchestrator...');
  await bootloader.ignite();
  await app.run();

  // 3. Fire an Event-Driven Task via the Bus
  Logger.info('\n[Test] Sending a payload through the globalEventBus to wake up CognitiveLoop...');
  const eventBus = new EventBus();
  eventBus.emit('TASK_QUEUED', {
    id: 'task-test-999',
    category: 'trigger',
    data: { triggerOn: 'SUCCESS_EVENT' }
  });

  // Wait 500ms for event to propagate and process
  await new Promise(r => setTimeout(r, 500));

  // 4. Verify Database WAL holds the transaction
  const dbFile = path.join(process.cwd(), '.breakglass_db', 'events.jsonl');
  const dbContent = await fs.readFile(dbFile, 'utf-8');
  
  if (dbContent.includes('TASK_APPROVED') && dbContent.includes('task-test-999')) {
    Logger.info(`\n[Test] ✅ Orchestrator successfully woke up, routed the task, and wrote to physical WAL!`);
  } else {
    throw new Error('Orchestrator failed to process and log the task to WAL.');
  }

  Logger.info('\n--- All Orchestrator Tests Passed ---');
  process.exit(0);
}

main().catch(console.error);
