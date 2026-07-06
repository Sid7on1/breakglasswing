import { Logger } from '../utils';
import { SafetyPolicy } from './policy.engine';
import { GovernorVetoError } from '../core/errors';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Mutex } from 'async-mutex';

export class BudgetVeto {
  private currentDailySpend: number = 0;
  private reservedSpend: number = 0;
  // The day `currentDailySpend` belongs to. A long-running process (day-long autonomous loops)
  // crosses midnight, so the reset can't live only in the constructor — it's re-checked on every
  // spend/veto via rolloverIfNewDay(), otherwise yesterday's spend carries into today (tripping the
  // cap early) and gets persisted stamped with today's date.
  private spendDate: string = new Date().toISOString().split('T')[0];
  private readonly spendFilePath: string;
  private budgetMutex = new Mutex();
  // When the governor is bypassed (/governor off), the budget stops vetoing — it still TRACKS spend
  // so the running total stays accurate, but it never blocks a call. The adapter holds this instance
  // directly (container.setBudgetVeto), so without this flag disabling the governor left the daily
  // cap silently killing every LLM response ("Budget limit exceeded" with no output). The Governor
  // keeps this in sync with its mode.
  public enabled: boolean = true;

  constructor() {
    const creditsDir = path.join(process.cwd(), '.breakglass/credits');
    this.spendFilePath = path.join(creditsDir, 'spend.json');

    // Use sync fs here because constructor cannot be async easily
    if (!fsSync.existsSync(creditsDir)) {
      fsSync.mkdirSync(creditsDir, { recursive: true });
    }

    this.loadPersistentSpendSync();
  }

  private loadPersistentSpendSync() {
    try {
      if (fsSync.existsSync(this.spendFilePath)) {
        const data = JSON.parse(fsSync.readFileSync(this.spendFilePath, 'utf8'));
        
        // Reset budget if it's a new day
        const today = new Date().toISOString().split('T')[0];
        this.spendDate = today;
        if (data.date !== today) {
          this.currentDailySpend = 0;
          this.savePersistentSpendSync();
          Logger.info(`[Governor] New day detected. Budget reset to $0.00.`);
        } else {
          this.currentDailySpend = data.spend || 0;
          Logger.info(`[Governor] Loaded physical budget: $${this.currentDailySpend.toFixed(2)} / $${SafetyPolicy.maxDailySpendUsd.toFixed(2)}`);
        }
      } else {
        this.savePersistentSpendSync();
      }
    } catch (e: any) {
      Logger.error(`[Governor] Failed to load spend.json: ${e.message}`);
    }
  }

  private savePersistentSpendSync() {
    const data = {
      date: this.spendDate,
      spend: this.currentDailySpend
    };
    fsSync.writeFileSync(this.spendFilePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async savePersistentSpendAsync() {
    const data = {
      date: this.spendDate,
      spend: this.currentDailySpend
    };
    await fs.writeFile(this.spendFilePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Roll the daily counters over when the wall-clock day has advanced since the last spend was
   * recorded. Called inside the budget mutex at the top of every spend/veto path so a process that
   * outlives midnight resets exactly once, instead of carrying yesterday's total into today.
   */
  private rolloverIfNewDay() {
    const today = new Date().toISOString().split('T')[0];
    if (this.spendDate !== today) {
      this.currentDailySpend = 0;
      this.reservedSpend = 0;
      this.spendDate = today;
      Logger.info(`[Governor] New day detected mid-session. Budget reset to $0.00.`);
    }
  }

  async recordSpend(actualCostUsd: number, estimatedCostUsd: number = 0): Promise<void> {
    await this.budgetMutex.runExclusive(async () => {
      this.rolloverIfNewDay();
      this.reservedSpend = Math.max(0, this.reservedSpend - estimatedCostUsd);
      this.currentDailySpend += actualCostUsd;
      await this.savePersistentSpendAsync();
      Logger.info(`[Governor] Budget updated: $${this.currentDailySpend.toFixed(2)} / $${SafetyPolicy.maxDailySpendUsd.toFixed(2)}`);
    });
  }

  async checkVeto(estimatedCostUsd: number): Promise<void> {
    await this.budgetMutex.runExclusive(async () => {
      this.rolloverIfNewDay();
      // Bypassed governor → reserve (to keep the running estimate honest) but never veto.
      if (this.enabled && this.currentDailySpend + this.reservedSpend + estimatedCostUsd > SafetyPolicy.maxDailySpendUsd) {
        Logger.error(`[Governor: Veto] API call blocked. Exceeds daily limit of $${SafetyPolicy.maxDailySpendUsd}`);
        throw new GovernorVetoError(`Daily budget of $${SafetyPolicy.maxDailySpendUsd.toFixed(2)} reached (spent $${this.currentDailySpend.toFixed(2)}). Disable the cap with /governor off, or raise it via MAX_DAILY_SPEND.`);
      }
      this.reservedSpend += estimatedCostUsd;
    });
  }

  async releaseReservation(estimatedCostUsd: number): Promise<void> {
    await this.budgetMutex.runExclusive(async () => {
      this.reservedSpend = Math.max(0, this.reservedSpend - estimatedCostUsd);
    });
  }

  async executeWithBudget<T>(estimatedCostUsd: number, action: () => Promise<{ actualCostUsd: number, result: T }>): Promise<T> {
    return await this.budgetMutex.runExclusive(async () => {
      this.rolloverIfNewDay();
      if (this.enabled && this.currentDailySpend + this.reservedSpend + estimatedCostUsd > SafetyPolicy.maxDailySpendUsd) {
        Logger.error(`[Governor: Veto] API call blocked. Exceeds daily limit of $${SafetyPolicy.maxDailySpendUsd}`);
        throw new GovernorVetoError(`Daily budget of $${SafetyPolicy.maxDailySpendUsd.toFixed(2)} reached (spent $${this.currentDailySpend.toFixed(2)}). Disable the cap with /governor off, or raise it via MAX_DAILY_SPEND.`);
      }

      const { actualCostUsd, result } = await action();
      this.currentDailySpend += actualCostUsd;
      await this.savePersistentSpendAsync();
      Logger.info(`[Governor] Budget updated: $${this.currentDailySpend.toFixed(2)} / $${SafetyPolicy.maxDailySpendUsd.toFixed(2)}`);
      return result;
    });
  }
}
