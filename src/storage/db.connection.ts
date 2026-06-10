import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { Mutex } from 'async-mutex';
import { DatabaseError } from '../core/errors';
import { IDatabase } from '../core/interfaces';

export class DatabaseConnection implements IDatabase {
  private connected = false;
  private readonly DB_DIR = path.join(process.cwd(), '.breakglass_db');
  private readonly WAL_FILE = path.join(this.DB_DIR, 'events.jsonl');
  private readonly MAX_WAL_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  private mutex = new Mutex();

  async connect(uri: string) {
    const maskedUri = uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
    Logger.info(`[Database] Connecting to local physical storage (${maskedUri})...`);
    
    try {
      await fs.mkdir(this.DB_DIR, { recursive: true });
      // Ensure file exists
      await fs.appendFile(this.WAL_FILE, '');
      this.connected = true;
      Logger.info(`[Database] Write-Ahead Log (WAL) successfully mounted at .breakglass_db/events.jsonl`);
    } catch (e: any) {
      Logger.error(`[Database] FATAL: Failed to mount local storage: ${e.message}`);
      throw new DatabaseError(`Failed to mount local storage: ${e.message}`, false);
    }
  }

  async saveEvent(eventPayload: any) {
    if (!this.connected) throw new DatabaseError('Cannot save, DB is not connected.');
    
    const record = JSON.stringify({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      payload: eventPayload
    }) + '\n';
    
    await this.mutex.runExclusive(async () => {
      try {
        const stats = await fs.stat(this.WAL_FILE).catch(() => ({ size: 0 }));
        if (stats.size > this.MAX_WAL_SIZE_BYTES) {
          const rotatedFile = path.join(this.DB_DIR, `events-${Date.now()}.jsonl`);
          await fs.rename(this.WAL_FILE, rotatedFile);
          Logger.info(`[Database] Rotated WAL file to ${rotatedFile}`);
        }
        await fs.appendFile(this.WAL_FILE, record, 'utf-8');
        Logger.info(`[Database] Physically persisted event to storage.`);
      } catch (e: any) {
        Logger.error(`[Database] Failed to write to WAL: ${e.message}`);
      }
    });
  }
}
