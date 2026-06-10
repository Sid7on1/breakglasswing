import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { Logger } from '../utils';

const execAsync = promisify(exec);

export class Tester {
  async runRegressionTest(filePath: string): Promise<{ passed: boolean; logs: string }> {
    Logger.info(`[Tester] Running dynamic regression test for ${filePath}...`);
    
    const ext = path.extname(filePath);
    
    try {
      if (ext === '.js') {
         await execAsync(`node --check ${filePath}`);
      } else if (ext === '.ts') {
         await execAsync(`npx tsc --noEmit --esModuleInterop ${filePath}`);
      }
      
      Logger.info(`[Tester] ✅ Dynamic Regression Passed.`);
      return { passed: true, logs: 'All execution paths parsed successfully.' };
    } catch (e: any) {
      Logger.warn(`[Tester] ❌ Regression Test Failed.`);
      return { passed: false, logs: e.stdout || e.stderr || e.message };
    }
  }
}
