import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils';

const execAsync = promisify(exec);

export class Validator {
  async validate(code: string, originalFilePath: string): Promise<{ valid: boolean; reason?: string }> {
    Logger.info(`[Validator] Running AST Static Analysis via TypeScript Compiler...`);

    if (!code || code.trim() === '') {
      return { valid: false, reason: 'Code cannot be empty.' };
    }

    const ext = path.extname(originalFilePath) || '.ts';
    const dir = path.dirname(originalFilePath);
    const stagingFile = path.join(dir, `evolve_staging_${Date.now()}${ext}`);

    try {
      await fs.writeFile(stagingFile, code, 'utf-8');

      if (ext === '.ts' || ext === '.tsx') {
        await execAsync(`npx tsc --noEmit --strict --esModuleInterop --skipLibCheck "${stagingFile}"`);
      } else if (ext === '.js' || ext === '.jsx') {
        await execAsync(`node --check "${stagingFile}"`);
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
