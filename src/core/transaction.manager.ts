import * as fs from 'fs/promises';
import { Logger } from '../utils/logger';

interface EditRecord {
  absPath: string;
  originalContent: string;
}

export class TransactionManager {
  private openTx: { id: string; edits: EditRecord[] } | null = null;

  isOpen(): boolean {
    return this.openTx !== null;
  }

  currentId(): string | null {
    return this.openTx?.id ?? null;
  }

  begin(id: string): string {
    if (this.openTx) {
      return `Transaction ${this.openTx.id} is already open. Commit or rollback it first.`;
    }
    this.openTx = { id, edits: [] };
    Logger.info(`[TX] Opened transaction ${id}`);
    return `Transaction ${id} opened. All file edits until /tx commit are tracked for atomic rollback.`;
  }

  /** Called by EditFileTool before writing — records original content for possible rollback. */
  async trackEdit(absPath: string): Promise<void> {
    if (!this.openTx) return;
    // Only record the first pre-edit snapshot for each path in this transaction.
    if (this.openTx.edits.some(e => e.absPath === absPath)) return;
    try {
      const originalContent = await fs.readFile(absPath, 'utf8');
      this.openTx.edits.push({ absPath, originalContent });
    } catch {
      // New file — record empty string so rollback deletes it.
      this.openTx.edits.push({ absPath, originalContent: '' });
    }
  }

  commit(): string {
    if (!this.openTx) return 'No open transaction to commit.';
    const id = this.openTx.id;
    const count = this.openTx.edits.length;
    this.openTx = null;
    Logger.info(`[TX] Committed ${id} (${count} file(s))`);
    return `Transaction ${id} committed (${count} file(s) changed).`;
  }

  async rollback(): Promise<string> {
    if (!this.openTx) return 'No open transaction to roll back.';
    const { id, edits } = this.openTx;
    this.openTx = null;

    const restored: string[] = [];
    const failed: string[] = [];

    for (const { absPath, originalContent } of [...edits].reverse()) {
      try {
        if (originalContent === '') {
          // File didn't exist before — delete it
          await fs.rm(absPath, { force: true });
        } else {
          await fs.writeFile(absPath, originalContent, 'utf8');
        }
        restored.push(absPath);
      } catch (e: any) {
        failed.push(`${absPath}: ${e.message}`);
        Logger.error(`[TX] Rollback failed for ${absPath}: ${e.message}`);
      }
    }

    const msg = [`Transaction ${id} rolled back — restored ${restored.length} file(s).`];
    if (restored.length) msg.push(`Restored: ${restored.join(', ')}`);
    if (failed.length) msg.push(`Failed to restore: ${failed.join('; ')}`);
    return msg.join('\n');
  }

  /** Called on EditFileTool failure when a transaction is open — auto-rollback. */
  async autoRollback(failedPath: string, reason: string): Promise<string> {
    if (!this.openTx) return '';
    const txId = this.openTx.id;
    const rollbackMsg = await this.rollback();
    return `Edit to ${failedPath} failed (${reason}). Auto-rolled back transaction ${txId}.\n${rollbackMsg}`;
  }
}

export const globalTransactionManager = new TransactionManager();
