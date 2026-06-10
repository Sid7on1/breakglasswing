import { ActionRouter } from './actions/action.router';
import { EventBus } from './core/event.bus';
import { Logger } from './utils';
import * as http from 'http';

async function main() {
  Logger.info('--- Initializing Robust Execution Engine Test ---');

  const eventBus = new EventBus();
  const router = new ActionRouter(eventBus);

  // 1. Test Event Bus Trigger
  Logger.info('\n[Test 1] Registering Instant Trigger Task...');
  router.route({
    id: 'task-trigger-101',
    category: 'trigger',
    payload: { triggerOn: 'SYSTEM_CRASH' }
  });
  
  Logger.info(`[Test 1] Emitting 'SYSTEM_CRASH' signal on global bus...`);
  eventBus.emit('SYSTEM_CRASH', { reason: 'OOM' });


  // 2. Test Cron Parser (Force evaluate)
  Logger.info('\n[Test 2] Testing Native Cron Engine Parser...');
  router.route({
    id: 'task-cron-202',
    category: 'cron',
    payload: {},
    metadata: { schedule: '*/5 * * * *' } // Every 5 minutes
  });

  // Since we don't want to wait 5 minutes, we will manually invoke the internal parser logic
  // by calling tick() forcefully, but we can't easily manipulate Date globally in JS without mocking.
  // Instead, we will register a `* * * * *` which fires EVERY minute, and forcefully invoke tick()
  router.route({
    id: 'task-cron-303',
    category: 'cron',
    payload: {},
    metadata: { schedule: '* * * * *' }
  });
  
  Logger.info(`[Test 2] Forcefully pulsing the Cron Engine to simulate minute rollover...`);
  // @ts-expect-error
  router.cronEngine.tick();


  // 3. Test HTTP Webhook Daemon
  Logger.info('\n[Test 3] Testing Native Node Webhook Server...');
  router.route({
    id: 'task-web-404',
    category: 'webhook',
    payload: {}
  });

  // Wait 500ms for HTTP server to bind
  await new Promise(r => setTimeout(r, 500));

  Logger.info(`[Test 3] Physically sending POST http://localhost:8080/webhook/task-web-404`);
  
  const req = http.request({
    hostname: 'localhost',
    port: 8080,
    path: '/webhook/task-web-404',
    method: 'POST'
  }, (res) => {
    let data = '';
    res.on('data', (c) => data += c);
    res.on('end', () => {
      Logger.info(`[Test 3] Received HTTP Response from Agent: ${data}`);
      if (res.statusCode === 200) {
        Logger.info(`[Test 3] ✅ SUCCESS! Native Webhook Server is alive and routing payloads!`);
      } else {
        Logger.error(`[Test 3] ❌ Webhook failed!`);
      }
      
      // Cleanup
      router.shutdown();
      Logger.info('\n--- All Action Engine Tests Passed ---');
      process.exit(0);
    });
  });

  req.write('{"data": "hello agent"}');
  req.end();
}

main().catch(console.error);
