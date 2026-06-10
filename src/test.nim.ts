import { ApiKeyManager } from './credits/api.key.manager';
import { Logger } from './utils';

async function main() {
  Logger.info('--- Initializing Advanced NVIDIA NIM Routing Test ---');
  
  // Initialize with 3 dummy keys
  const manager = new ApiKeyManager(['nim-key-1', 'nim-key-2', 'nim-key-3']);

  // Simulate rapidly firing 10 concurrent tasks
  for (let i = 1; i <= 10; i++) {
    Logger.info(`\n--- Task #${i} ---`);
    
    // 1. Get next best key
    const { keyStr, idx, waitTimeSecs } = manager.getNextKey();
    
    if (waitTimeSecs > 0) {
      Logger.info(`[Task ${i}] ALL KEYS ON COOLDOWN. Must intelligently sleep for ${waitTimeSecs.toFixed(2)}s before proceeding.`);
    }

    Logger.info(`[Task ${i}] Selected Key #${(idx as number) + 1} (${keyStr})`);
    
    // 2. We mock the HTTP call since we don't want to actually hit Nvidia 10 times in a second with fake keys
    // For tasks 1-5, we simulate a 429 Rate Limit error.
    let simulatedStatus = 200;
    if (i <= 5) simulatedStatus = 429;
    
    if (simulatedStatus === 429) {
      Logger.info(`[Task ${i}] -> 💥 SIMULATED 429 RATE LIMIT`);
      manager.reportKeyResult(idx as number, 429, null);
    } else {
      Logger.info(`[Task ${i}] -> ✅ SIMULATED 200 OK`);
      manager.reportKeyResult(idx as number, 200, null);
    }
  }

  Logger.info('\n--- Final Key States ---');
  console.dir(manager.getStates(), { depth: null });
}

main().catch(console.error);
