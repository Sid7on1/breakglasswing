import { TaskPipeline } from './task';
import { EventBus } from './core/event.bus';

async function main() {
  const eventBus = new EventBus();
  const pipeline = new TaskPipeline(eventBus);
  const prompt = "I need a system that initializes a repository, sets up a daily cron job for builds, and fires a webhook when done.";
  
  console.log(`--- User Prompt ---\n"${prompt}"\n`);
  
  const result = await pipeline.process(prompt);
  
  console.log('--- Pipeline Final Result ---');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
