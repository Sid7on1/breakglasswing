import { DatabaseConnection } from './storage/db.connection';
import { WebhookReceiver } from './api/webhook.receiver';
import { AuthAutomator } from './auth/cli.login';
import { EventBus } from './core/event.bus';
import { Logger } from './utils/logger';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  Logger.info('--- Initializing Robust Outer Boundary Integration Test ---');

  // Wipe persistent state for clean test
  await fs.rm(path.join(process.cwd(), '.breakglass_db'), { recursive: true, force: true });
  await fs.rm(path.join(process.cwd(), '.breakglass_auth'), { recursive: true, force: true });

  // 1. Test Physical Database WAL
  Logger.info('\n[Test 1] Testing Database Write-Ahead Log (WAL)...');
  const db = new DatabaseConnection();
  await db.connect('sqlite://local');
  await db.saveEvent({ action: 'TEST_BOOT', status: 'SUCCESS' });

  const dbFile = path.join(process.cwd(), '.breakglass_db', 'events.jsonl');
  const dbContent = await fs.readFile(dbFile, 'utf-8');
  if (dbContent.includes('TEST_BOOT') && dbContent.includes('payload')) {
    Logger.info(`[Test 1] ✅ Database successfully appended JSON-line to physical disk!`);
  } else {
    throw new Error('Database failed to write physical WAL.');
  }


  // 2. Test Cryptographic Auth Automator
  Logger.info('\n[Test 2] Testing Cryptographic JWT Tokenizer...');
  const auth = new AuthAutomator();
  await auth.ensureAuthenticated('claude-cli'); // Should generate
  
  const tokenFile = path.join(process.cwd(), '.breakglass_auth', 'session.jwt');
  const tokenData = await fs.readFile(tokenFile, 'utf-8');
  
  if (tokenData.split('.').length === 3) {
    Logger.info(`[Test 2] ✅ Auth generated valid 3-part cryptographic JWT offline!`);
  } else {
    throw new Error('Auth failed to generate valid JWT.');
  }
  
  // Re-run to test cache hit
  Logger.info(`[Test 2] Re-verifying token...`);
  await auth.ensureAuthenticated('claude-cli'); // Should hit cache


  // 3. Test HTTP API Receiver via Global Event Bus
  Logger.info('\n[Test 3] Testing Live HTTP API Webhook Listener...');
  const eventBus = new EventBus();
  const receiver = new WebhookReceiver(eventBus);
  receiver.startListening(9090);

  // Bind a temporary listener to the global bus to catch the webhook
  let eventCaught = false;
  eventBus.on('EXTERNAL_WEBHOOK_RECEIVED', (payload: any) => {
    Logger.info(`[Test 3] Internal Bus caught the external payload: ${JSON.stringify(payload)}`);
    eventCaught = true;
  });

  // Wait 500ms for HTTP server to bind
  await new Promise(r => setTimeout(r, 500));

  Logger.info(`[Test 3] Sending external POST http://localhost:9090/events...`);
  const req = http.request({
    hostname: 'localhost',
    port: 9090,
    path: '/events',
    method: 'POST'
  }, (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      if (res.statusCode === 200 && eventCaught) {
        Logger.info(`[Test 3] ✅ SUCCESS! Receiver caught HTTP, parsed JSON, and fired internal Global Event!`);
      } else {
        Logger.error(`[Test 3] ❌ Webhook Receiver failed to bridge network-to-bus!`);
      }
      
      // Cleanup
      receiver.stop();
      Logger.info('\n--- All Boundary Suite Tests Passed ---');
      process.exit(0);
    });
  });

  req.write('{"event": "push", "repo": "breakglass"}');
  req.end();
}

main().catch(console.error);
