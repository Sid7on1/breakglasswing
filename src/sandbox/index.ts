import * as fs from 'fs/promises';
import { Versioner } from './versioner';
import { Validator } from './validator';
import { Tester } from './tester';
import { Rollback } from './rollback';
import { Logger } from '../utils';

export class SandboxManager {
  private versioner = new Versioner();
  private rollback = new Rollback();
  private validator = new Validator();
  private tester = new Tester();

  /**
   * Safely applies a code modification with physical atomicity.
   */
  async safelyModify(filePath: string, newCode: string): Promise<boolean> {
    Logger.info(`\n--- [Sandbox] Attempting safe modification on ${filePath} ---`);
    
    // 1. Static AST Validation before doing anything
    const validation = await this.validator.validate(newCode, filePath);
    if (!validation.valid) {
      Logger.error(`[Sandbox] AST Validation Failed:\n${validation.reason}`);
      Logger.warn(`[Sandbox] Modification aborted before file system touch.`);
      return false;
    }

    // 2. Physical Snapshot
    const backupPath = await this.versioner.snapshot(filePath);

    // 3. Apply modification
    try {
      await fs.writeFile(filePath, newCode, 'utf-8');
      Logger.info(`[Sandbox] Code applied to ${filePath}.`);
    } catch (e: any) {
      Logger.error(`[Sandbox] Failed to apply code: ${e.message}`);
      return false;
    }

    // 4. Run Dynamic Regression Tests
    const testResult = await this.tester.runRegressionTest(filePath);
    
    if (!testResult.passed) {
      Logger.error(`[Sandbox] Regression Test Failed:\n${testResult.logs}`);
      
      // 5. Atomic Physical Rollback on failure
      await this.rollback.revert(filePath, backupPath);
      return false;
    }

    Logger.info('[Sandbox] ✅ Modification successful and permanently committed.');
    await this.versioner.clearSnapshot(backupPath); // clean up
    return true;
  }
}

export * from './versioner';
export * from './validator';
export * from './tester';
export * from './rollback';
