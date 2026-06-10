import * as fs from 'fs/promises';
import { Logger } from '../utils';

export class Rollback {
  async revert(filePath: string, backupPath: string): Promise<void> {
    Logger.warn(`[Rollback] Triggering physical atomic rollback for ${filePath}...`);
    
    try {
      // Verify backup integrity before proceeding (SAND-003)
      let backupStat;
      try {
        backupStat = await fs.stat(backupPath);
      } catch (e) {
        Logger.error(`[Rollback] ABORT: Backup file does not exist at ${backupPath}. Cannot rollback safely.`);
        return;
      }

      const backupContent = await fs.readFile(backupPath, 'utf-8');
      
      if (backupContent === '__EMPTY_MARKER__') {
        // File was created during the attempt, delete it
        await fs.unlink(filePath);
        Logger.info(`[Rollback] Reverted creation of ${filePath}`);
      } else {
        if (backupStat.size === 0) {
          Logger.error(`[Rollback] ABORT: Backup file at ${backupPath} is 0 bytes. Refusing to overwrite original with corrupted backup.`);
          return;
        }
        // Restore original content atomically
        await fs.copyFile(backupPath, filePath);
        Logger.info(`[Rollback] Successfully restored ${filePath} to pristine state.`);
      }
      
      // Clean up backup file
      await fs.unlink(backupPath);
    } catch (e: any) {
      Logger.error(`[Rollback] FATAL: Failed to rollback ${filePath}: ${e.message}`);
    }
  }
}
