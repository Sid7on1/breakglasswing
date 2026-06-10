import { FreeCreditsTracker } from './credits.free';
import { ApiKeyManager } from './api.key.manager';
import { SessionTracker } from './session.tracker';
import { Logger } from '../utils';

export class PoolManager {
  private freeCredits = new FreeCreditsTracker();
  private keyManager = new ApiKeyManager(['sk-paid-key-1-alpha', 'sk-paid-key-2-beta']);
  private sessionTracker = new SessionTracker();

  /**
   * Authorizes an execution by finding the most economical resource available.
   * Prioritizes free-tier over paid API keys.
   */
  async authorizeExecution(): Promise<{ type: 'free' | 'paid', key?: string, keyIdx?: number }> {
    Logger.info(`\n[PoolManager] Requesting authorization for task execution...`);
    
    if (await this.freeCredits.canUseFreeTier()) {
      await this.freeCredits.recordUsage();
      
      if (!this.sessionTracker.hasActiveSessions()) {
         this.sessionTracker.startSession('cli-instance-free');
      }
      return { type: 'free' };
    }

    Logger.info(`[PoolManager] Free tier quota exhausted. Attempting fallback to Paid API Keys.`);
    
    // Pass 1: Get the next available key (could be ready now, or we might need to sleep)
    const { keyStr, idx, waitTimeSecs } = this.keyManager.getNextKey();
    
    if (keyStr === null || idx === null) {
      throw new Error('[PoolManager] FATAL: No API keys configured in the pool.');
    }

    if (waitTimeSecs > 0) {
      Logger.warn(`[PoolManager] ALL API keys rate-limited. Throttling thread for ${waitTimeSecs.toFixed(2)} seconds...`);
      await new Promise(r => setTimeout(r, waitTimeSecs * 1000));
      Logger.info(`[PoolManager] Resuming execution after cooldown.`);
    }

    Logger.info(`[PoolManager] Authorized via paid key: ${keyStr.substring(0, 10)}... (Index: ${idx})`);
    return { type: 'paid', key: keyStr, keyIdx: idx };
  }

  reportFailure(idx: number, statusCode: number, retryAfterSecs: number | null = null) {
    this.keyManager.reportKeyResult(idx, statusCode, retryAfterSecs);
  }
  
  reportSuccess(idx: number) {
    this.keyManager.reportKeyResult(idx, 200);
  }
}
