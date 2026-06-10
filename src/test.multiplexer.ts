import { TerminalMultiplexer } from './terminal/multiplexer';
import { ClaudeAdapter } from './terminal/adapters/claude.adapter';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Robust CLI Multiplexer Test ---');
  
  const mux = new TerminalMultiplexer(2); // Max 2 sessions

  // Boot 2 adapters
  const adapter1 = new ClaudeAdapter('sess-1');
  const adapter2 = new ClaudeAdapter('sess-2');
  
  await mux.registerSession(adapter1);
  await mux.registerSession(adapter2);

  Logger.info('\n[Test] Blasting 5 concurrent bash commands at a 2-session pool...\n');
  
  const promises = [];

  // Task 1: Fast
  promises.push(mux.routeCommand('ClaudeCode', 'echo "hello from bash"').then(o => Logger.info(`[Result 1] \n${o}`)));
  
  // Task 2: Fast
  promises.push(mux.routeCommand('ClaudeCode', 'pwd').then(o => Logger.info(`[Result 2] \n${o}`)));
  
  // Task 3: SLOW - Will trigger queueing, but finish before deadlock (sleep 2)
  promises.push(mux.routeCommand('ClaudeCode', 'sleep 2 && echo "sleep finished"').then(o => Logger.info(`[Result 3] \n${o}`)));
  
  // Task 4: Fast
  promises.push(mux.routeCommand('ClaudeCode', 'whoami').then(o => Logger.info(`[Result 4] \n${o}`)));
  
  // Task 5: DEADLOCK - Infinite loop
  promises.push(mux.routeCommand('ClaudeCode', 'while true; do sleep 1; done').then(o => Logger.info(`[Result 5] \n${o}`)));

  await Promise.all(promises);

  Logger.info('\n[Test] All commands processed (including deadlock recoveries). Shutting down...');
  await mux.shutdownAll();
}

main().catch(console.error);
