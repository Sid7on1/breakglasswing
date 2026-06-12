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
  private readonly spendFilePath: string;
  private budgetMutex = new Mutex();

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
    const today = new Date().toISOString().split('T')[0];
    const data = {
      date: today,
      spend: this.currentDailySpend
    };
    fsSync.writeFileSync(this.spendFilePath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async savePersistentSpendAsync() {
    const today = new Date().toISOString().split('T')[0];
    const data = {
      date: today,
      spend: this.currentDailySpend
    };
    await fs.writeFile(this.spendFilePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async recordSpend(actualCostUsd: number, estimatedCostUsd: number = 0): Promise<void> {
    await this.budgetMutex.runExclusive(async () => {
      this.reservedSpend = Math.max(0, this.reservedSpend - estimatedCostUsd);
      this.currentDailySpend += actualCostUsd;
      await this.savePersistentSpendAsync();
      Logger.info(`[Governor] Budget updated: $${this.currentDailySpend.toFixed(2)} / $${SafetyPolicy.maxDailySpendUsd.toFixed(2)}`);
    });
  }

  async checkVeto(estimatedCostUsd: number): Promise<void> {
    await this.budgetMutex.runExclusive(async () => {
      if (this.currentDailySpend + this.reservedSpend + estimatedCostUsd > SafetyPolicy.maxDailySpendUsd) {
        Logger.error(`[Governor: Veto] API call blocked. Exceeds daily limit of $${SafetyPolicy.maxDailySpendUsd}`);
        throw new GovernorVetoError('Budget limit exceeded.');
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
      if (this.currentDailySpend + this.reservedSpend + estimatedCostUsd > SafetyPolicy.maxDailySpendUsd) {
        Logger.error(`[Governor: Veto] API call blocked. Exceeds daily limit of $${SafetyPolicy.maxDailySpendUsd}`);
        throw new GovernorVetoError('Budget limit exceeded.');
      }
      
      const { actualCostUsd, result } = await action();
      this.currentDailySpend += actualCostUsd;
      await this.savePersistentSpendAsync();
      Logger.info(`[Governor] Budget updated: $${this.currentDailySpend.toFixed(2)} / $${SafetyPolicy.maxDailySpendUsd.toFixed(2)}`);
      return result;
    });
  }
}
