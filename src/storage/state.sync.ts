import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils';
import { Mutex } from 'async-mutex';

export interface FileStat {
  size: number;
  mtime: number;
}

export class StateSyncEngine {
  private readonly SYNC_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.DS_Store']);
  private readonly SYNC_EXCLUDE_SUFFIXES = new Set(['.env', '.log', '.tmp', '.pyc']);
  
  private syncManifest: Record<string, FileStat> = {};
  private syncMutex = new Mutex();

  constructor(private workspaceRoot: string) {}

  private shouldSync(relativePath: string): boolean {
    const parts = relativePath.split(path.sep);
    // Ignore excluded directories
    if (parts.some(part => this.SYNC_EXCLUDE_DIRS.has(part))) {
      return false;
    }
    // Ignore excluded suffixes
    const basename = path.basename(relativePath);
    if (basename === '.env' || basename.startsWith('.env.')) {
      return false;
    }
    const ext = path.extname(relativePath);
    if (this.SYNC_EXCLUDE_SUFFIXES.has(ext)) {
      return false;
    }
    return true;
  }

  private async getLocalFiles(dir: string, baseDir: string, result: Record<string, FileStat> = {}): Promise<Record<string, FileStat>> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (!this.shouldSync(relativePath)) continue;

      if (entry.isDirectory()) {
        await this.getLocalFiles(fullPath, baseDir, result);
      } else {
        const stats = await fs.stat(fullPath);
        result[relativePath] = {
          size: stats.size,
          mtime: stats.mtimeMs
        };
      }
    }
    return result;
  }

  private async uploadFile(relativePath: string): Promise<boolean> {
    // In a real system, this would push bytes to a Supabase bucket or AWS S3.
    // For this simulation, we simulate network latency.
    return new Promise(resolve => {
      setTimeout(() => resolve(true), 150); // Simulate 150ms upload time
    });
  }

  public async syncUploadChanged(): Promise<void> {
    await this.syncMutex.runExclusive(async () => {
      try {
        const currentFiles = await this.getLocalFiles(this.workspaceRoot, this.workspaceRoot);
        const toUpload: string[] = [];

        // Diff against previous manifest
        for (const [relPath, info] of Object.entries(currentFiles)) {
          const prev = this.syncManifest[relPath];
          if (prev && prev.mtime === info.mtime && prev.size === info.size) {
            continue; // Unchanged
          }
          toUpload.push(relPath);
        }

        if (toUpload.length === 0) {
          Logger.info(`[StateSync] 📤 Incremental: 0 files changed. Skipped upload.`);
          return;
        }

        Logger.info(`[StateSync] 📤 Detected ${toUpload.length} modified files. Initiating concurrent uploads...`);

        // Upload concurrently
        const uploadPromises = toUpload.map(async (relPath) => {
          Logger.info(`[StateSync] Uploading: ${relPath}`);
          const success = await this.uploadFile(relPath);
          if (success) {
            // Update manifest only on success
            this.syncManifest[relPath] = currentFiles[relPath];
          }
          return success;
        });

        await Promise.all(uploadPromises);
        Logger.info(`[StateSync] 📤 Incremental sync complete for ${toUpload.length} files.`);

      } catch (error: any) {
        Logger.error(`[StateSync] Sync failed: ${error.message}`);
      }
    });
  }
}
