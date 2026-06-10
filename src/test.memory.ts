import { VectorStore } from './memory/vector.store';
import { LongTermMemory } from './memory/long.term';
import { ShortTermMemory } from './memory/short.term';
import { ContextEngine } from './memory/context.engine';
import { Logger } from './utils';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  Logger.info('--- Initializing Robust Vector Memory Engine Test ---');
  
  // Wipe persistent state for clean test
  const memoryPath = path.join(process.cwd(), '.breakglass_memory');
  await fs.rm(memoryPath, { recursive: true, force: true });

  const vectorStore = new VectorStore();
  const longTerm = new LongTermMemory(vectorStore);
  const shortTerm = new ShortTermMemory();
  const engine = new ContextEngine(shortTerm, longTerm);
  
  // 1. Seed the Long-Term Memory with distinct historical bugs
  Logger.info('\n[Test 1] Writing historical memories to local vector database...');
  
  await longTerm.rememberSolution(
    'bug-docker-001',
    'The Docker container crashes immediately upon boot. Exit code 137. It says killed.',
    'Increase the memory limit in docker-compose.yml. Deploy: "deploy.resources.limits.memory: 2G".'
  );

  await longTerm.rememberSolution(
    'bug-css-002',
    'The navbar is overflowing on mobile devices and hiding the logo. Z-index is weird.',
    'Add media queries for max-width: 768px. Change flex-wrap: nowrap to flex-wrap: wrap. Fix the z-index to 999.'
  );

  await longTerm.rememberSolution(
    'bug-db-003',
    'Postgres connection is throwing Too Many Clients. Prisma is crashing on queries.',
    'In the .env file, add ?connection_limit=5 to the DATABASE_URL. Update the Prisma client instantiation to use a global object in development to prevent hot-reloading from creating zombie connections.'
  );

  // 2. Simulate Semantic Search
  Logger.info('\n[Test 2] Querying Vector Database using natural language Cosine Similarity...');
  const currentTask = 'My database is throwing errors. It seems like Prisma is creating too many hot-reload connections and blowing up Postgres.';
  
  const prompt = await engine.buildContextAwarePrompt(currentTask);
  
  // We expect the Vector Database to naturally surface the Postgres/Prisma solution 
  // via local TF-IDF mathematics, not string matching.
  if (prompt.includes('?connection_limit=5')) {
    Logger.info(`[Test 2] ✅ SUCCESS! Cosine Similarity engine mathematically mapped the query to the Database bug.`);
  } else {
    throw new Error("Cosine Similarity failed to rank the correct historical solution!");
  }

  if (!prompt.includes('docker-compose') && !prompt.includes('navbar')) {
    Logger.info(`[Test 2] ✅ SUCCESS! Irrelevant memories were correctly filtered out by the math engine.`);
  } else {
    throw new Error("Vector Store returned irrelevant noise!");
  }

  // 3. Test Token Budget
  Logger.info('\n[Test 3] Testing Context Firewall (Token Budget)...');
  
  // Spam short-term memory with massive text
  const massiveText = "A".repeat(10000); // 10,000 chars = ~2,500 tokens. Two of these = 5,000 tokens (Over budget)
  shortTerm.addMessage('user', massiveText);
  shortTerm.addMessage('user', massiveText);
  
  const optimizedPrompt = await engine.buildContextAwarePrompt('Fix it');
  const estimatedTokens = Math.ceil(optimizedPrompt.length / 4);
  
  Logger.info(`[Test 3] Prompt sliced successfully. Final estimated token size: ${estimatedTokens}`);
  if (estimatedTokens > 4500) {
     throw new Error("Token Optimizer failed! Prompt is massive.");
  }

  Logger.info('\n--- All Memory Engine Tests Passed ---');
  process.exit(0);
}

main().catch(console.error);
