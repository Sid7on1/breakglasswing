const { AgentPersona } = require('./dist/cli/personas/base.persona.js');
const { AgentLoop } = require('./dist/core/agent.loop.js');

// Mock dependencies
const mockAdapter = {
  chat: async function*(messages) {
    yield { type: 'token', text: 'Hello! I am the fixed AI. How can I assist you today?' };
  }
};

const mockContextManager = {
  checkAndCompact: async (msgs) => msgs
};

const mockTools = {
  getAllSchemas: () => []
};

// Override the constructor to inject our mocks directly instead of importing heavy dependencies
const loop = new AgentLoop(mockAdapter, mockTools, null);
loop.contextManager = mockContextManager;

async function test() {
  const initialMessages = [{ role: 'user', content: 'hi' }];
  console.log('--- AgentLoop.execute START ---');
  const generator = loop.execute(initialMessages, "System Prompt", { maxIterations: 1 });
  
  let output = '';
  for await (const token of generator) {
    output += token;
  }
  
  console.log('Streamed Output:', output);
  console.log('Loop Messages After:', loop.messages);
  console.log('--- PASS ---');
}

test().catch(console.error);
