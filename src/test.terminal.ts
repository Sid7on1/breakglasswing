import { TerminalMultiplexer } from './terminal/multiplexer';
import { ClaudeAdapter } from './terminal/adapters/claude.adapter';

async function main() {
  const multiplexer = new TerminalMultiplexer();

  console.log('--- Spinning up 3 concurrent Claude Code sessions ---');
  await multiplexer.registerSession(new ClaudeAdapter('claude-session-1'));
  await multiplexer.registerSession(new ClaudeAdapter('claude-session-2'));
  await multiplexer.registerSession(new ClaudeAdapter('claude-session-3'));

  console.log('\n--- Routing concurrent commands ---');
  
  // Send 3 commands concurrently without them blocking each other
  const commands = ['Refactor the auth module', 'Analyze the task decomposer', 'Generate unit tests for the multiplexer'];
  
  const promises = commands.map(cmd => multiplexer.routeCommand('ClaudeCode', cmd));
  
  const results = await Promise.all(promises);
  
  console.log('\n--- Execution Results ---');
  results.forEach(res => console.log(res));

  console.log('\n--- Shutting down ---');
  await multiplexer.shutdownAll();
}

main().catch(console.error);
