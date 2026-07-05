import { execFileSync } from 'child_process';
import * as path from 'path';
import { Logger } from '../utils/logger';

/**
 * Git-worktree isolation for parallel sub-agents (the Cursor 2.0 / Claude Code
 * `isolation: "worktree"` pattern): each isolated agent gets its own checkout of the repo on its
 * own branch under .bimax/worktrees/<taskId>, so parallel agents can never clobber each other's
 * edits. Worktrees share the object store with the main checkout — creating one is near-instant
 * and costs no re-clone.
 *
 * Lifecycle: create → agent works inside it → settle. Settle removes the worktree AND its branch
 * when the agent changed nothing (no dirty files, no commits); otherwise both are kept and the
 * caller surfaces the path + branch so the user (or the orchestrator) can review/merge.
 *
 * Distinct from evolution/worktree.manager.ts on purpose: that one serves swarm/evolution waves
 * (async ops that NEED explicit serialization because they fire in Promise.all, throw on failure,
 * commit/merge helpers, .evolution_worktrees/). This one is the spawn-path primitive: synchronous
 * (execFileSync blocks the event loop, so calls can never interleave with each other), falls back
 * to unisolated instead of throwing, and detects "did the agent change anything" against the base
 * commit. git arguments are always argv arrays — never shell strings — since taskIds pass through.
 */

export interface WorktreeInfo {
  /** Absolute path of the worktree checkout the agent should use as cwd. */
  path: string;
  /** The branch created for this worktree (bimax/sub-…). */
  branch: string;
  /** Commit the worktree was created from — the baseline for "did anything change?". */
  baseCommit: string;
  /** The main checkout the worktree belongs to (where `git worktree` bookkeeping lives). */
  repoRoot: string;
}

export interface WorktreeSettle {
  /** True when the worktree was deleted (agent changed nothing). */
  removed: boolean;
  /** True when edits or commits were found and the worktree/branch were kept. */
  changed: boolean;
  /** Human-readable note for the sub-agent result ('' when removed cleanly). */
  note: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Create an isolated worktree for a task. Returns null (with a warning) when the cwd isn't a git
 * repo or creation fails — callers fall back to running the sub-agent unisolated, which is the
 * pre-worktree behavior, never a hard failure.
 */
export function createWorktree(cwd: string, taskId: string): WorktreeInfo | null {
  try {
    const repoRoot = git(cwd, 'rev-parse', '--show-toplevel');
    const baseCommit = git(repoRoot, 'rev-parse', 'HEAD');
    // taskId is "subagent-<uuid>" — the uuid tail keeps branch/dir names short but unique.
    const shortId = taskId.replace(/^subagent-/, '').slice(0, 8) || taskId;
    const branch = `bimax/sub-${shortId}`;
    const wtPath = path.join(repoRoot, '.bimax', 'worktrees', shortId);
    git(repoRoot, 'worktree', 'add', '-b', branch, wtPath, 'HEAD');
    Logger.info(`[Worktree] Created ${wtPath} (branch ${branch}) for ${taskId}`);
    return { path: wtPath, branch, baseCommit, repoRoot };
  } catch (e: any) {
    Logger.warn(`[Worktree] Could not create worktree for ${taskId}: ${e?.message?.split('\n')[0]} — running unisolated.`);
    return null;
  }
}

/**
 * Settle a worktree after its agent finished: remove it (and its branch) when nothing changed,
 * keep both and describe them when something did.
 */
export function settleWorktree(info: WorktreeInfo): WorktreeSettle {
  let changed = false;
  try {
    const dirty = git(info.path, 'status', '--porcelain');
    const head = git(info.path, 'rev-parse', 'HEAD');
    changed = dirty.length > 0 || head !== info.baseCommit;
  } catch {
    // Worktree already gone (agent or user deleted it) — treat as settled.
    try { git(info.repoRoot, 'worktree', 'prune'); } catch { /* best-effort */ }
    return { removed: true, changed: false, note: '' };
  }

  if (changed) {
    return {
      removed: false,
      changed: true,
      note: `Worktree kept — the sub-agent made changes in ${info.path} on branch ${info.branch}. Review and merge (or discard with \`git worktree remove --force ${info.path}\`).`,
    };
  }

  try {
    git(info.repoRoot, 'worktree', 'remove', '--force', info.path);
    git(info.repoRoot, 'branch', '-D', info.branch);
    Logger.info(`[Worktree] Removed unchanged worktree ${info.path}`);
  } catch (e: any) {
    Logger.warn(`[Worktree] Cleanup of ${info.path} failed: ${e?.message?.split('\n')[0]}`);
  }
  return { removed: true, changed: false, note: '' };
}
