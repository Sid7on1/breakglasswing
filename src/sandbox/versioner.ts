import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils';

export class Versioner {
  private readonly BACKUP_DIR = '.breakglass/backup';

  async snapshot(filePath: string): Promise<string> {
    await fs.mkdir(this.BACKUP_DIR, { recursive: true });
    
    // Hash the filepath to create a unique backup name
    const backupName = Buffer.from(filePath).toString('base64').replace(/\//g, '_') + '.bak';
    const backupPath = path.join(this.BACKUP_DIR, backupName);

    try {
      await fs.copyFile(filePath, backupPath);
      Logger.info(`[Versioner] Physical snapshot taken: ${backupPath}`);
      return backupPath;
    } catch (e) {
      Logger.warn(`[Versioner] File ${filePath} does not exist yet. Snapshotting as empty marker.`);
      await fs.writeFile(backupPath, '__EMPTY_MARKER__', 'utf-8');
      return backupPath;
    }
  }

  async clearSnapshot(backupPath: string): Promise<void> {
    try {
      await fs.unlink(backupPath);
    } catch (e) {}
  }
}
