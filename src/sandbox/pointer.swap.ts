import { Logger } from '../utils';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IArchitectureGuardian } from '../genome/guardian';

export class EvolutionPointerSwap {
  constructor(private projectRoot: string, private guardian: IArchitectureGuardian) {}

  public async swap(componentName: string, candidateFilePath: string, targetFilePath: string): Promise<boolean> {
    Logger.info(`[Evolution] Initiating Pointer Swap for ${componentName}...`);

    const fullCandidatePath = path.join(this.projectRoot, candidateFilePath);
    const fullTargetPath = path.join(this.projectRoot, targetFilePath);

    // 1. Architecture Guardian Validation
    const isValid = await this.guardian.validateCandidate(componentName, fullCandidatePath);
    if (!isValid) {
      Logger.error(`[Evolution] 🛑 Pointer Swap Rejected by Architecture Guardian.`);
      return false;
    }

    // 2. Backup Current State
    const backupPath = `${fullTargetPath}.backup_${Date.now()}`;
    try {
      await fs.copyFile(fullTargetPath, backupPath);
      Logger.info(`[Evolution] Created cold storage backup: ${backupPath}`);
    } catch (e) {
      Logger.warn(`[Evolution] No existing target to backup or backup failed.`);
    }

    // 3. Execute Swap
    try {
      await fs.copyFile(fullCandidatePath, fullTargetPath);
      Logger.info(`[Evolution] ✅ Pointer Swap Successful. ${componentName} has been evolved.`);
      return true;
    } catch (e: any) {
      Logger.error(`[Evolution] ❌ Swap Failed: ${e.message}`);
      // Rollback
      try {
        await fs.copyFile(backupPath, fullTargetPath);
        Logger.info(`[Evolution] 🔄 Rollback successful.`);
      } catch (rbError) {}
      return false;
    }
  }
}
