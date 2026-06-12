import dotenv from 'dotenv';
import { loadGlobalEnv } from './env.loader';
loadGlobalEnv();
dotenv.config();

import { createContainer } from '../core/container';
import { HermesPersona, OpenCodePersona, OpenClawPersona, BiMaxPersona } from './personas/implementations';
import { Logger } from '../utils';
import * as readline from 'readline';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error(`Usage: npx tsx src/cli/index.ts <persona> [optional_prompt]`);
    console.error(`Personas: bimax, hermes, opencode, openclaw`);
    process.exit(1);
  }

  const personaArg = args[0].toLowerCase();
  const prompt = args[1];

  Logger.info(`[CLI] Booting BreakGlassWing Engine for Persona: ${personaArg}...`);
  const container = await createContainer();
  const { bootloader, toolRegistry, llmAdapter } = container as any;
  await bootloader.ignite();

  let agent;

  switch (personaArg) {
    case 'hermes':
      agent = new HermesPersona(toolRegistry, llmAdapter);
      break;
    case 'opencode':
      agent = new OpenCodePersona(toolRegistry, llmAdapter);
      break;
    case 'openclaw':
      agent = new OpenClawPersona(toolRegistry, llmAdapter);
      break;
    case 'bimax':
      agent = new BiMaxPersona(toolRegistry, llmAdapter);
      break;
    default:
      console.error(`[CLI] Unknown persona: ${personaArg}`);
      process.exit(1);
  }

  if (prompt) {
    await agent.execute(prompt);
    console.log('\n[CLI] Execution finished. Exiting.');
    process.exit(0);
  } else {
    // Interactive Chat Mode
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log(`\n=================================================`);
    console.log(`🤖 Welcome to the ${agent.config.name} Interactive Terminal!`);
    console.log(`Type 'exit' or 'quit' to end the session.`);
    console.log(`=================================================\n`);

    const ask = () => {
      rl.question(`\n[User] > `, async (input: string) => {
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          console.log('\n[CLI] Exiting interactive session. Goodbye!');
          rl.close();
          // Let the ShutdownCoordinator handle the actual exit if we emit SIGINT, or we can just process.exit(0)
          process.emit('SIGINT' as any);
          return;
        }
        
        if (input.trim()) {
          await agent.execute(input);
        }
        
        ask(); // Loop
      });
    };

    rl.on('SIGINT', () => {
      console.log('\n[CLI] Caught Ctrl+C in readline. Initiating graceful shutdown...');
      rl.close();
      process.emit('SIGINT' as any);
    });

    ask();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
