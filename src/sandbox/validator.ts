import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils';

const execAsync = promisify(exec);

export class Validator {
  private readonly STAGING_DIR = '.breakglass_backup';

  async validate(code: string, originalFilePath: string): Promise<{ valid: boolean; reason?: string }> {
    Logger.info(`[Validator] Running AST Static Analysis via TypeScript Compiler...`);
    
    if (!code || code.trim() === '') {
      return { valid: false, reason: 'Code cannot be empty.' };
    }

    await fs.mkdir(this.STAGING_DIR, { recursive: true });
    
    // Create a staging file with the correct extension
    const ext = path.extname(originalFilePath) || '.ts';
    const stagingFile = path.join(this.STAGING_DIR, `staging_${Date.now()}${ext}`);
    
    try {
      await fs.writeFile(stagingFile, code, 'utf-8');
      
      // If it's a TS file, run strict tsc validation
      if (ext === '.ts' || ext === '.tsx') {
        // We run tsc --noEmit to parse the AST and check types without building
        await execAsync(`npx tsc --noEmit --esModuleInterop ${stagingFile}`);
      } else if (ext === '.js' || ext === '.jsx') {
        // For JS, we can use node --check to verify syntax
        await execAsync(`node --check ${stagingFile}`);
      }

      Logger.info(`[Validator] ✅ AST Validation Passed.`);
      return { valid: true };
    } catch (e: any) {
      Logger.warn(`[Validator] ❌ AST Validation Failed.`);
      // Extract stdout from child_process error
      const errorLog = e.stdout || e.stderr || e.message;
      return { valid: false, reason: `Compiler Error: ${errorLog}` };
    } finally {
      // Clean up staging file
      try { await fs.unlink(stagingFile); } catch (_) {}
    }
  }
}
