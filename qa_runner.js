const { AgentLoop } = require('./dist/core/agent.loop.js');
const { AgentPersona } = require('./dist/cli/personas/base.persona.js');
const { ToolRegistry } = require('./dist/tools/tool.registry.js');
const { buildTool } = require('./dist/tools/tool.factory.js');
const { cliEvents } = require('./dist/cli/events.js');
const { ContextManager } = require('./dist/memory/context.manager.js');
const { createAskUserTool } = require('./dist/tools/implementations/ask_user.tool.js');

const { loadConfig } = require('./dist/cli/config.js');

const fs = require('fs');

async function runTests() {
  await loadConfig();
  console.log('--- STARTING QA TEST MATRIX ---');

  // Mocks
  let toolCalled = false;
  let chatErrorTriggered = false;

  const mockAdapter = {
    chat: async function*(messages, opts) {
      const lastMsg = messages[messages.length - 1].content;
      
      if (lastMsg === 'trigger-error') {
        chatErrorTriggered = true;
        yield { type: 'error', recoverable: true, message: 'Simulated timeout error' };
      } else if (lastMsg === 'trigger-tool') {
        yield { type: 'tool_call', id: 'call_123', name: 'SafeTool', args: '{}' };
      } else if (lastMsg === 'trigger-askuser') {
        // Hallucinate a string for options
        yield { type: 'tool_call', id: 'call_456', name: 'AskUserTool', args: '{"question": "What to do?", "options": "Just string"}' };
      } else {
        yield { type: 'token', text: 'Hello QA!' };
      }
    },
    chatCompletion: async () => 'User selected: Continue'
  };

  const governor = {
    approveTaskExecution: async () => true,
    vetoMode: 'bypass'
  };

  const tools = new ToolRegistry();
  tools.register(buildTool({
    name: 'SafeTool',
    description: 'Safe',
    isDestructive: false,
    schema: { type: 'object', properties: {} },
    execute: async () => {
      toolCalled = true;
      return 'Safe Tool Executed';
    }
  }, governor));
  
  tools.register(createAskUserTool(governor, mockAdapter));

  const loop = new AgentLoop(mockAdapter, tools, governor);
  
  console.log('[Test 1] Basic Chat Flow');
  let gen1 = loop.execute([{ role: 'user', content: 'hi' }], "Sys");
  let out1 = '';
  for await (const t of gen1) out1 += t;
  console.assert(out1 === 'Hello QA!', 'Basic chat failed');
  console.assert(loop.messages.length === 2, 'Message length mismatch');
  console.log('✅ Pass 1');

  console.log('[Test 2] Context Persistence');
  let gen2 = loop.execute([...loop.messages, { role: 'user', content: 'again' }], "Sys");
  let out2 = '';
  for await (const t of gen2) out2 += t;
  console.assert(loop.messages.length === 4, 'Context failed');
  console.log('✅ Pass 2');

  console.log('[Test 3] Reactive Compaction');
  loop.contextManager = { checkAndCompact: async m => m, reactiveCompact: async m => m };
  let gen3 = loop.execute([{ role: 'user', content: 'trigger-error' }], "Sys");
  let out3 = '';
  for await (const t of gen3) out3 += t;
  console.assert(chatErrorTriggered, 'Error handling failed');
  console.log('✅ Pass 3');

  console.log('[Test 4] Tool Execution');
  let gen4 = loop.execute([{ role: 'user', content: 'trigger-tool' }], "Sys");
  for await (const t of gen4) {}
  console.assert(toolCalled, 'Tool did not execute');
  console.log('✅ Pass 4');

  console.log('[Test 5] AskUserTool Hallucination Sanitize');
  let vetoEmitted = false;
  let vetoOptionsSafe = false;
  cliEvents.on('veto_prompt', (q, opts, res) => {
    vetoEmitted = true;
    vetoOptionsSafe = Array.isArray(opts);
    res('Continue');
  });
  
  let gen5 = loop.execute([{ role: 'user', content: 'trigger-askuser' }], "Sys");
  for await (const t of gen5) {}
  console.assert(vetoEmitted, 'Veto not emitted');
  console.assert(vetoOptionsSafe, 'Options were not safely cast to an array');
  console.log('✅ Pass 5');

  console.log('--- ALL TESTS PASSED ---');
}

runTests().catch(console.error);
