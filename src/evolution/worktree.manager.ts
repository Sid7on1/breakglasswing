import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils';

const execFileAsync = promisify(execFile);

// `git worktree add`/`remove` mutate the shared per-repo `.git/worktrees/` registry. Running them
// concurrently races and corrupts it — surfaced by a real /beast run as
// "fatal: failed to read .git/worktrees/<id>/commondir: Undefined error: 0" when SwarmOrchestrator
// fired 4 parallel `git worktree add`s. Serialize all registry-mutating worktree ops process-wide
// through one promise chain. The sub-agents working INSIDE the worktrees still run fully parallel —
// only the (fast) create/remove is serialized.
let _worktreeLock: Promise<unknown> = Promise.resolve();
function serializeWorktreeOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = _worktreeLock.then(fn, fn);
  _worktreeLock = run.then(() => {}, () => {}); // keep the chain alive past success OR failure
  return run;
}

export class WorktreeManager {
  private baseWorktreePath: string;

  constructor(private projectRoot: string) {
    this.baseWorktreePath = path.join(this.projectRoot, '.evolution_worktrees');
  }

  /**
   * Run git with arguments passed as an array (no shell). Branch names, commit
   * messages and paths are LLM/user-derived, so they must never be interpolated
   * into a shell string — execFile keeps them as literal argv entries.
   */
  private async git(args: string[], cwd: string = this.projectRoot): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
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
    const worktreePath = path.join(this.baseWorktreePath, branchName);
    return serializeWorktreeOp(async () => {
      await this.ensureBaseDir();
      Logger.info(`[WorktreeManager] Creating new isolated worktree at ${worktreePath} on branch ${branchName}...`);
      try {
        // -b creates a new branch starting at baseCommit
        await this.git(['worktree', 'add', '-b', branchName, worktreePath, baseCommit]);
        Logger.info(`[WorktreeManager] Worktree created successfully.`);
        return { worktreePath };
      } catch (error: any) {
        Logger.error(`[WorktreeManager] Failed to create worktree: ${error.message}`);
        throw error;
      }
    });
  }

  /**
   * Removes the git worktree and deletes the branch. Used to clean up after evolution.
   */
  public async removeWorktree(branchName: string, force: boolean = false): Promise<void> {
    const worktreePath = path.join(this.baseWorktreePath, branchName);
    return serializeWorktreeOp(async () => {
      Logger.info(`[WorktreeManager] Removing worktree at ${worktreePath}...`);
      try {
        const removeArgs = force ? ['worktree', 'remove', '--force', worktreePath] : ['worktree', 'remove', worktreePath];
        await this.git(removeArgs);

        await this.git(['branch', force ? '-D' : '-d', branchName]);

        Logger.info(`[WorktreeManager] Worktree and branch removed successfully.`);
      } catch (error: any) {
        Logger.warn(`[WorktreeManager] Failed to remove worktree cleanly: ${error.message}. Attempting fallback prune...`);
        // Fallback: manually delete the directory and prune git worktrees
        try {
          await fs.rm(worktreePath, { recursive: true, force: true });
          await this.git(['worktree', 'prune']);
          await this.git(['branch', '-D', branchName]);
        } catch (fallbackError) {
          // Ignore fallback errors
        }
      }
    });
  }

  /**
   * Checks if there are any uncommitted changes inside the worktree workspace.
   */
  public async hasChanges(worktreePath: string): Promise<boolean> {
    try {
      const stdout = await this.git(['status', '--porcelain'], worktreePath);
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
      await this.git(['add', '-A'], worktreePath);
      await this.git(['commit', '-m', message], worktreePath);
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
      await this.git(['merge', branchName]);
      Logger.info(`[WorktreeManager] Merge successful.`);
    } catch (error: any) {
      Logger.error(`[WorktreeManager] Merge failed: ${error.message}`);
      throw error;
    }
  }
}
