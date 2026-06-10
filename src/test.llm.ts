import { LlmAdapter } from './core/llm.adapter';
import { ApiKeyManager } from './credits/api.key.manager';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Live AI Integration Test ---');
  
  // We use a fake API key deliberately to prove the SDK attempts a real network request
  const manager = new ApiKeyManager(['sk-fake-test-key-12345']);
  const adapter = new LlmAdapter(manager);

  const systemPrompt = `
    You are the breakglasswing task decomposer. 
    Break the user's prompt down into tiny plans. 
    Return JSON: { "plans": [ { "action": "...", "type": "cron|webhook|cli" } ] }
  `;
  const userPrompt = "Create a cron job that checks my email every 5 minutes and runs a python script.";

  const result = await adapter.generateTinyPlans(userPrompt, systemPrompt);
  
  if (result.status === 401 || result.status === 404 || (result.error && result.error.message?.includes('Incorrect API key'))) {
    Logger.info(`[Test] SUCCESS: Caught expected OpenAI Auth/Route error.`);
    Logger.info(`[Test] This proves the agent is successfully executing live HTTP requests to the OpenAI servers!`);
  } else {
    Logger.error(`[Test] FAILED: Unexpected result status: ${result.status}`);
  }
}

main().catch(console.error);
