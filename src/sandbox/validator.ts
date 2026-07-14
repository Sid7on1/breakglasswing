import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils';

// Use execFile (no shell) so file paths can never be interpreted as shell
// syntax. Arguments are passed as an array, eliminating command injection.
const execFileAsync = promisify(execFile);

export class Validator {
  async validate(code: string, originalFilePath: string): Promise<{ valid: boolean; reason?: string }> {
    Logger.info(`[Validator] Running AST Static Analysis via TypeScript Compiler...`);

    if (!code || code.trim() === '') {
      return { valid: false, reason: 'Code cannot be empty.' };
    }

    const ext = path.extname(originalFilePath) || '.ts';
    const dir = path.dirname(originalFilePath);
    // Unique per-invocation name (randomUUID) so concurrent validations in the
    // same millisecond can't clobber or prematurely delete each other's file.
    const stagingFile = path.join(dir, `evolve_staging_${crypto.randomUUID()}${ext}`);

    try {
      await fs.writeFile(stagingFile, code, 'utf-8');

      if (ext === '.ts' || ext === '.tsx') {
        await execFileAsync('npx', ['tsc', '--noEmit', '--strict', '--esModuleInterop', '--skipLibCheck', stagingFile]);
      } else if (ext === '.js' || ext === '.jsx') {
        await execFileAsync('node', ['--check', stagingFile]);
      }

      Logger.info(`[Validator] AST Validation Passed.`);
      return { valid: true };
    } catch (e: any) {
      Logger.warn(`[Validator] AST Validation Failed.`);
      const errorLog = e.stdout || e.stderr || e.message;
      return { valid: false, reason: `Compiler Error: ${errorLog}` };
    } finally {
      try { await fs.unlink(stagingFile); } catch { /* ignore cleanup errors */ }
    }
  }
}
