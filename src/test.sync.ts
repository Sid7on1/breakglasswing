import { StateSyncEngine } from './storage/state.sync';
import { Logger } from './utils';
import * as fs from 'fs/promises';
import * as path from 'path';

async function main() {
  Logger.info('--- Initializing Advanced State Sync Engine Test ---');
  
  const testDir = path.join(__dirname, 'sync_test_dir');
  await fs.mkdir(testDir, { recursive: true });

  const syncEngine = new StateSyncEngine(testDir);

  try {
    // 1. Create 3 initial files
    Logger.info('\n[Test] Creating 3 new files...');
    await fs.writeFile(path.join(testDir, 'file1.txt'), 'content 1');
    await fs.writeFile(path.join(testDir, 'file2.txt'), 'content 2');
    await fs.writeFile(path.join(testDir, 'file3.txt'), 'content 3');
    
    // Create an ignored file
    await fs.writeFile(path.join(testDir, '.env'), 'SECRET=123');
    
    // 2. First Sync (Should upload all 3, ignore .env)
    Logger.info('\n[Test] Executing First Sync...');
    await syncEngine.syncUploadChanged();

    // 3. Wait a moment so mtime differs
    await new Promise(r => setTimeout(r, 1000));

    // 4. Modify exactly 1 file
    Logger.info('\n[Test] Modifying file2.txt...');
    await fs.writeFile(path.join(testDir, 'file2.txt'), 'content 2 modified');

    // 5. Second Sync (Should only upload file2.txt)
    Logger.info('\n[Test] Executing Incremental Sync...');
    await syncEngine.syncUploadChanged();

  } finally {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
    Logger.info('\n[Test] Cleanup complete.');
  }
}

main().catch(console.error);
