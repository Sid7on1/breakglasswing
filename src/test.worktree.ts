import { WorktreeManager } from './evolution/worktree.manager';
import { Logger } from './utils';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function main() {
  Logger.info('--- Initializing Git Worktree Integration Test ---');
  const projectRoot = process.cwd();
  
  // Ensure the project is a git repo and has at least one commit
  try {
    await execAsync('git status', { cwd: projectRoot });
  } catch (e) {
    Logger.error('Project is not a git repository. Please run `git init` and commit something first.');
    return;
  }

  const manager = new WorktreeManager(projectRoot);
  const testBranch = `evolution-test-${Date.now()}`;

  // 1. Create a Worktree
  Logger.info(`\n[Test] Creating worktree for branch ${testBranch}...`);
  const { worktreePath } = await manager.createWorktree(testBranch);
  
  // Verify it exists
  const stat = await fs.stat(worktreePath);
  if (stat.isDirectory()) {
    Logger.info(`[Test] ✅ Worktree directory verified at ${worktreePath}`);
  } else {
    Logger.error(`[Test] ❌ Worktree directory not found.`);
  }

  // 2. Check for changes (should be false initially)
  let hasChanges = await manager.hasChanges(worktreePath);
  Logger.info(`[Test] Initial hasChanges: ${hasChanges} (Expected: false)`);

  // 3. Mutate the graph (create a dummy file)
  const dummyFile = path.join(worktreePath, 'evolution.dummy.txt');
  await fs.writeFile(dummyFile, 'I am a self-evolved file in an isolated worktree.');
  Logger.info(`[Test] Wrote dummy file to ${dummyFile}`);

  // 4. Check for changes (should be true now)
  hasChanges = await manager.hasChanges(worktreePath);
  Logger.info(`[Test] After mutation hasChanges: ${hasChanges} (Expected: true)`);
  if (hasChanges) {
    Logger.info(`[Test] ✅ Mutation successfully detected in worktree.`);
  }

  // 5. Commit changes
  Logger.info(`[Test] Committing changes to worktree...`);
  await manager.commitChanges(worktreePath, 'Add dummy file for evolution test');

  // 6. Cleanup Worktree (Simulation of Rollback or Cleanup after merge)
  Logger.info(`\n[Test] Cleaning up worktree (Force deleting)...`);
  await manager.removeWorktree(testBranch, true);

  // Verify deletion
  try {
    await fs.stat(worktreePath);
    Logger.error(`[Test] ❌ Worktree directory still exists!`);
  } catch (e) {
    Logger.info(`[Test] ✅ Worktree directory successfully deleted.`);
  }

  Logger.info('\n--- Git Worktree Integration Test Complete ---');
}

main().catch(console.error);
