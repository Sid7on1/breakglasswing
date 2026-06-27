import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { WorktreeManager } from './worktree.manager';
import { TaskDecomposer } from '../task/decomposer';
import { SubTask } from '../task/types';
import { SubAgentManager } from '../core/subagent.manager';
import { LlmAdapter } from '../core/llm.adapter';
import { buildAgentContextBlock } from './agent.context';

export interface SwarmNodeResult {
  id: string;
  description: string;
  status: 'completed' | 'failed' | 'skipped' | 'conflict';
  detail: string;
}

export interface SwarmReport {
  goal: string;
  integrationBranch: string;
  nodes: SwarmNodeResult[];
  merged: boolean;
  baseBranch: string;
}

export type SwarmLogger = (level: 'info' | 'success' | 'error' | 'warn', msg: string) => void;

/**
 * Parallel Worktree Swarm. Decomposes a goal into a DAG, then executes it in
 * topological waves: every node in a wave is independent, so each runs as a
 * sub-agent in its own git worktree — zero file collisions. After each wave the
 * finished branches are merged into a single integration branch, which becomes
 * the base for the next wave. The user's working tree is never touched until the
 * final, optional merge.
 */
export class SwarmOrchestrator {
  private readonly worktrees: WorktreeManager;
  private readonly subagents = new SubAgentManager();
  private readonly stamp = Date.now().toString(36);
  private readonly maxParallel = 4;

  constructor(
    private projectRoot: string,
    private llmAdapter: LlmAdapter,
    private parentMode: string,
    private log: SwarmLogger = () => {}
  ) {
    this.worktrees = new WorktreeManager(projectRoot);
  }

  private git(args: string[], cwd = this.projectRoot): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }).trim();
  }

  private isClean(): boolean {
    try {
      return this.git(['status', '--porcelain']).length === 0;
    } catch {
      return true;
    }
  }

  private currentBranch(): string {
    try { return this.git(['rev-parse', '--abbrev-ref', 'HEAD']); } catch { return 'HEAD'; }
  }

  /** Kahn's algorithm: returns nodes grouped into dependency waves, or null on cycle. */
  private toWaves(tasks: SubTask[]): SubTask[][] | null {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const indeg = new Map<string, number>();
    for (const t of tasks) {
      // Ignore dependencies that reference unknown ids so a bad DAG can't deadlock.
      const deps = t.dependencies.filter(d => byId.has(d));
      indeg.set(t.id, deps.length);
    }
    const waves: SubTask[][] = [];
    let frontier = tasks.filter(t => (indeg.get(t.id) || 0) === 0);
    const done = new Set<string>();
    while (frontier.length > 0) {
      waves.push(frontier);
      frontier.forEach(t => done.add(t.id));
      const next: SubTask[] = [];
      for (const t of tasks) {
        if (done.has(t.id)) continue;
        const deps = t.dependencies.filter(d => byId.has(d));
        if (deps.every(d => done.has(d)) && !next.includes(t)) next.push(t);
      }
      frontier = next;
    }
    return done.size === tasks.length ? waves : null;
  }

  private async runWithPool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workers = new Array(Math.min(this.maxParallel, items.length)).fill(0).map(async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async run(goal: string, opts?: { autoMerge?: boolean }): Promise<SwarmReport> {
    const baseBranch = this.currentBranch();
    const integrationBranch = `swarm/${this.stamp}/integration`;
    const report: SwarmReport = { goal, integrationBranch, nodes: [], merged: false, baseBranch };

    // Decompose.
    this.log('info', 'Decomposing goal into a task DAG…');
    const decomposer = new TaskDecomposer(this.llmAdapter);
    const tasks = await decomposer.decompose(goal);
    this.log('success', `Decomposed into ${tasks.length} task(s).`);

    const waves = this.toWaves(tasks);
    if (!waves) throw new Error('Task graph has a cycle; cannot schedule.');

    // Integration worktree — merges happen here so the user's tree is untouched.
    const integrationPath = await this.worktrees
      .createWorktree(integrationBranch, 'HEAD')
      .then(r => r.worktreePath);

    const completed = new Set<string>();
    try {
      for (let w = 0; w < waves.length; w++) {
        const wave = waves[w];
        this.log('info', `Wave ${w + 1}/${waves.length}: ${wave.length} parallel task(s).`);

        // Skip nodes whose dependencies failed.
        const runnable = wave.filter(t => t.dependencies.filter(d => tasks.some(x => x.id === d)).every(d => completed.has(d)));
        for (const t of wave) {
          if (!runnable.includes(t)) {
            report.nodes.push({ id: t.id, description: t.description, status: 'skipped', detail: 'a dependency failed' });
            this.log('warn', `Skipping ${t.id} — a dependency failed.`);
          }
        }

        const waveResults = await this.runWithPool(runnable, async (node) => {
          // Sanitize the LLM-supplied id before it reaches shell-interpolated git commands.
          const safeId = (node.id || 'node').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'node';
          const branch = `swarm/${this.stamp}/${safeId}`;
          const wt = await this.worktrees.createWorktree(branch, integrationBranch);
          const ctx = await buildAgentContextBlock({ goal, subtask: node.description });
          const prompt = `${ctx}Overall goal: ${goal}\n\nYour isolated sub-task (${node.id}): ${node.description}\n\nWork only within this worktree at ${wt.worktreePath}. Make the changes directly; do not commit — the orchestrator handles commits and merges.`;
          const taskId = `swarm-${this.stamp}-${node.id}`;
          try {
            this.log('info', `▶ ${node.id}: ${node.description.slice(0, 70)}`);
            await this.subagents.spawnWorker(taskId, {
              agentType: 'OpenCode',
              prompt,
              cwd: wt.worktreePath,
              parentMode: this.parentMode,
            });
            return { node, branch, worktreePath: wt.worktreePath };
          } catch (e: any) {
            return { node, branch, worktreePath: wt.worktreePath, error: e.message };
          }
        });

        // Commit each successful worktree, then merge sequentially into integration.
        for (const res of waveResults) {
          const { node, branch, worktreePath } = res as any;
          if ((res as any).error) {
            report.nodes.push({ id: node.id, description: node.description, status: 'failed', detail: (res as any).error });
            this.log('error', `✖ ${node.id} failed: ${(res as any).error}`);
            await this.cleanupBranch(branch, worktreePath);
            continue;
          }

          const hasChanges = await this.worktrees.hasChanges(worktreePath);
          if (!hasChanges) {
            report.nodes.push({ id: node.id, description: node.description, status: 'completed', detail: 'no file changes' });
            completed.add(node.id);
            await this.cleanupBranch(branch, worktreePath);
            continue;
          }

          // commitChanges interpolates the message into a shell command; strip shell-significant chars.
          const safeMsg = `swarm(${node.id}): ${node.description}`.replace(/["`$\\\n\r]/g, ' ').slice(0, 80);
          await this.worktrees.commitChanges(worktreePath, safeMsg);
          try {
            this.git(['merge', '--no-ff', '-m', `merge ${node.id}`, branch], integrationPath);
            report.nodes.push({ id: node.id, description: node.description, status: 'completed', detail: 'merged' });
            completed.add(node.id);
            this.log('success', `✔ ${node.id} merged.`);
          } catch (e: any) {
            try { this.git(['merge', '--abort'], integrationPath); } catch { /* nothing to abort */ }
            report.nodes.push({ id: node.id, description: node.description, status: 'conflict', detail: 'merge conflict — left on its branch ' + branch });
            this.log('error', `✖ ${node.id} conflicted on merge; branch ${branch} kept for manual review.`);
            await this.cleanupWorktreeOnly(worktreePath);
            continue;
          }
          await this.cleanupBranch(branch, worktreePath);
        }
      }

      // Optional final merge into the user's branch.
      if (opts?.autoMerge) {
        if (this.isClean()) {
          this.git(['merge', '--no-ff', '-m', `swarm: ${goal.slice(0, 60)}`, integrationBranch]);
          report.merged = true;
          this.log('success', `Merged swarm result into ${baseBranch}.`);
        } else {
          this.log('warn', `Working tree is dirty — left result on ${integrationBranch} instead of auto-merging.`);
        }
      }
    } finally {
      await this.cleanupWorktreeOnly(integrationPath);
      // Keep the integration branch so the user can inspect/merge it.
    }

    return report;
  }

  private async cleanupWorktreeOnly(worktreePath: string) {
    try { this.git(['worktree', 'remove', '--force', worktreePath]); } catch { /* best effort */ }
    try { if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  private async cleanupBranch(branch: string, worktreePath: string) {
    await this.cleanupWorktreeOnly(worktreePath);
    try { this.git(['branch', '-D', branch]); } catch { /* best effort */ }
  }
}
