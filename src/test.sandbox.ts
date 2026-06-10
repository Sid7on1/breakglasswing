import { SandboxManager } from './sandbox';
import { Logger } from './utils';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  Logger.info('--- Initializing Robust Sandbox Safe-Box Test ---');
  
  const sandbox = new SandboxManager();
  const dummyFile = path.join(__dirname, 'dummy.ts');
  
  // 1. Setup a pristine dummy file
  const pristineCode = `export const hello: string = "world";\nconsole.log(hello);`;
  await fs.writeFile(dummyFile, pristineCode, 'utf-8');
  Logger.info(`[Test] Created pristine file: ${dummyFile}`);

  // Test 1: Validator catching AST Error
  Logger.info('\n[Test 1] Injecting Malformed AST Code...');
  const badCode = `export const hello: string = 5; // Type error! AST should catch this.\nconsole.log(hello);`;
  
  const success1 = await sandbox.safelyModify(dummyFile, badCode);
  if (!success1) {
    Logger.info(`[Test 1] ✅ SUCCESS: Sandbox correctly blocked the AST type error before touching the disk.`);
  }

  // Ensure file is still pristine
  const current1 = await fs.readFile(dummyFile, 'utf-8');
  if (current1 !== pristineCode) throw new Error("File was corrupted by AST check!");

  // Test 2: Tester catching runtime logic failure & Rollback
  Logger.info('\n[Test 2] Injecting Valid Syntax but Logic Error (Forcing Tester fail)...');
  // We'll write a code that has valid syntax but throws an error during execution/loading.
  // We can just use an unresolved import that fails the dynamic execution parse phase.
  const badLogicCode = `import { FakeModule } from './does-not-exist';\nexport const hello: string = "world";`;
  
  const success2 = await sandbox.safelyModify(dummyFile, badLogicCode);
  if (!success2) {
    Logger.info(`[Test 2] ✅ SUCCESS: Sandbox dynamically rolled back the bad logic.`);
  }

  // Ensure file is perfectly restored
  const current2 = await fs.readFile(dummyFile, 'utf-8');
  if (current2 === pristineCode) {
    Logger.info(`[Test 2] ✅ SUCCESS: Physical atomic rollback completely restored the file byte-for-byte!`);
  } else {
    throw new Error("Rollback failed to restore file!");
  }

  // Cleanup
  await fs.unlink(dummyFile);
  Logger.info('\n--- All Sandbox Tests Passed ---');
}

main().catch(console.error);
