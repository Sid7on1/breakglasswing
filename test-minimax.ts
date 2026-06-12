import { ApiKeyManager } from './src/credits/api.key.manager';
import { LlmAdapter } from './src/core/llm.adapter';

async function main() {
  const km = new ApiKeyManager();
  const adapter = new LlmAdapter(km);


  const tools = [
    {
      name: 'BashTool',
      description: 'Executes a bash command and returns stdout/stderr. Reserve for actual shell operations like deleting files.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command' }
        },
        required: ['command']
      }
    }
  ];

  const messages: any[] = [
    { role: 'user', content: 'delete the godsplan folder' }
  ];

  const system = 'You are an agent. You must use tools.';

  try {
    const generator = adapter.chat(messages, { system, tools });
    for await (const chunk of generator) {
      console.log('Got chunk:', chunk);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
