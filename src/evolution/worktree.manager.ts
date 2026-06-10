import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils';

const execAsync = promisify(exec);

export class WorktreeManager {
  private baseWorktreePath: string;

  constructor(private projectRoot: string) {
    this.baseWorktreePath = path.join(this.projectRoot, '.evolution_worktrees');
  }

  private async ensureBaseDir() {
    try {
      await fs.mkdir(this.baseWorktreePath, { recursive: true });
    } catch (e) {
      // Ignore if exists
    }
  }

  /**
   * Creates an isolated git worktree for a subagent to work in without disrupting the main branch.
   */
  public async createWorktree(branchName: string, baseCommit: string = 'HEAD'): Promise<{ worktreePath: string }> {
    await this.ensureBaseDir();
    const worktreePath = path.join(this.baseWorktreePath, branchName);
    
    Logger.info(`[WorktreeManager] Creating new isolated worktree at ${worktreePath} on branch ${branchName}...`);
    
    try {
      // -b creates a new branch starting at baseCommit
      await execAsync(`git worktree add -b ${branchName} "${worktreePath}" ${baseCommit}`, { cwd: this.projectRoot });
      Logger.info(`[WorktreeManager] Worktree created successfully.`);
      return { worktreePath };
    } catch (error: any) {
      Logger.error(`[WorktreeManager] Failed to create worktree: ${error.message}`);
      throw error;
    }
  }

  /**
   * Removes the git worktree and deletes the branch. Used to clean up after evolution.
   */
  public async removeWorktree(branchName: string, force: boolean = false): Promise<void> {
    const worktreePath = path.join(this.baseWorktreePath, branchName);
    Logger.info(`[WorktreeManager] Removing worktree at ${worktreePath}...`);

    try {
      const forceFlag = force ? '--force' : '';
      await execAsync(`git worktree remove ${forceFlag} "${worktreePath}"`, { cwd: this.projectRoot });
      
      const branchForceFlag = force ? '-D' : '-d';
      await execAsync(`git branch ${branchForceFlag} ${branchName}`, { cwd: this.projectRoot });
      
      Logger.info(`[WorktreeManager] Worktree and branch removed successfully.`);
    } catch (error: any) {
      Logger.warn(`[WorktreeManager] Failed to remove worktree cleanly: ${error.message}. Attempting fallback prune...`);
      // Fallback: manually delete the directory and prune git worktrees
      try {
        await fs.rm(worktreePath, { recursive: true, force: true });
        await execAsync(`git worktree prune`, { cwd: this.projectRoot });
        await execAsync(`git branch -D ${branchName}`, { cwd: this.projectRoot });
      } catch (fallbackError) {
        // Ignore fallback errors
      }
    }
  }

  /**
   * Checks if there are any uncommitted changes inside the worktree workspace.
   */
  public async hasChanges(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`git status --porcelain`, { cwd: worktreePath });
      return stdout.trim().length > 0;
    } catch (error: any) {
      Logger.error(`[WorktreeManager] Failed to check for changes: ${error.message}`);
      return false;
    }
  }

  /**
   * Commits all changes in the given worktree.
   */
  public async commitChanges(worktreePath: string, message: string): Promise<void> {
    try {
      await execAsync(`git add -A`, { cwd: worktreePath });
      await execAsync(`git commit -m "${message}"`, { cwd: worktreePath });
      Logger.info(`[WorktreeManager] Committed changes in ${worktreePath}`);
    } catch (error: any) {
      Logger.error(`[WorktreeManager] Failed to commit changes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Merges the evolution branch into the current HEAD of the main workspace.
   */
  public async mergeWorktree(branchName: string): Promise<void> {
    Logger.info(`[WorktreeManager] Merging worktree branch ${branchName} into main...`);
    try {
      await execAsync(`git merge ${branchName}`, { cwd: this.projectRoot });
      Logger.info(`[WorktreeManager] Merge successful.`);
    } catch (error: any) {
      Logger.error(`[WorktreeManager] Merge failed: ${error.message}`);
      throw error;
    }
  }
}
