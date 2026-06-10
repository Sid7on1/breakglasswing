import { PoolManager } from './credits/pool.manager';
import { Logger } from './utils';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  Logger.info('--- Initializing Robust Credits Router Test ---');
  
  // Wipe persistent state for clean test
  const creditsPath = path.join(process.cwd(), '.breakglass_credits');
  await fs.rm(creditsPath, { recursive: true, force: true });

  const manager = new PoolManager();
  
  // 1. Burn through 10 free credits rapidly
  Logger.info('\n[Test 1] Exhausting Free Tier Quota...');
  for (let i = 0; i < 10; i++) {
    const auth = await manager.authorizeExecution();
    if (auth.type !== 'free') throw new Error("Expected free tier!");
  }
  
  // 2. Fall back to paid keys (should get Alpha)
  Logger.info('\n[Test 2] Testing Paid Fallback...');
  const authAlpha = await manager.authorizeExecution();
  if (authAlpha.type !== 'paid' || authAlpha.key !== 'sk-paid-key-1-alpha') throw new Error("Expected Alpha key!");

  // 3. Simulate 429 Rate Limit on Alpha
  Logger.info('\n[Test 3] Simulating 429 Rate Limit on Alpha...');
  manager.reportFailure(authAlpha.keyIdx!, 429);
  
  // Next request should route to Beta
  const authBeta = await manager.authorizeExecution();
  if (authBeta.key !== 'sk-paid-key-2-beta') throw new Error("Expected Beta key to load-balance!");

  // 4. Simulate 429 Rate Limit on Beta (Now ALL keys are rate limited)
  Logger.info('\n[Test 4] Simulating 429 Rate Limit on Beta (Total Pool Exhaustion)...');
  manager.reportFailure(authBeta.keyIdx!, 429);

  // Next request MUST sleep the thread
  Logger.info('\n[Test 5] Validating Intelligent Thread Sleep...');
  const startWait = Date.now();
  const throttledAuth = await manager.authorizeExecution();
  const elapsed = (Date.now() - startWait) / 1000;
  
  Logger.info(`[Test 5] Thread slept for ${elapsed.toFixed(2)}s, recovered using ${throttledAuth.key}`);
  
  if (elapsed < 1.0) throw new Error("Pool Manager failed to sleep thread!");

  Logger.info('\n--- All Credits Tests Passed ---');
  process.exit(0);
}

main().catch(console.error);
