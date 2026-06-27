import { exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { WorktreeManager } from './worktree.manager';
import { SubAgentManager } from '../core/subagent.manager';
import { LlmAdapter } from '../core/llm.adapter';
import { buildAgentContextBlock } from './agent.context';

const execAsync = promisify(exec);

export interface SpeculativeArm {
  index: number;
  approach: string;
  branch?: string;
  ran: boolean;
  changed: boolean;
  filesChanged: number;
  testsPassed: boolean;
  detail: string;
}

export interface SpeculativeReport {
  task: string;
  testCommand: string;
  arms: SpeculativeArm[];
  recommended?: number; // index of the recommended arm
}

export type SpecLogger = (level: 'info' | 'success' | 'error' | 'warn', msg: string) => void;

/**
 * Speculative Multi-Solution. For a hard problem, generates a few DISTINCT approaches,
 * implements each in parallel in its own git worktree, tests each, and presents the
 * trade-offs so the user (or a follow-up step) can choose. Unlike the swarm it does
 * not merge — it surfaces competing options on separate branches.
 */
export class SpeculativeSolver {
  private readonly worktrees: WorktreeManager;
  private readonly subagents = new SubAgentManager();
  private readonly stamp = Date.now().toString(36);

  constructor(
    private projectRoot: string,
    private llmAdapter: LlmAdapter,
    private parentMode: string,
    private log: SpecLogger = () => {}
  ) {
    this.worktrees = new WorktreeManager(projectRoot);
  }

  private git(args: string[], cwd = this.projectRoot): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }).trim();
  }

  private isGitRepo(): boolean {
    try { return this.git(['rev-parse', '--is-inside-work-tree']) === 'true'; } catch { return false; }
  }

  private resolveTestCommand(override?: string): string {
    if (override) return override;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf-8'));
      if (pkg.scripts && pkg.scripts.test) return 'npm test';
    } catch { /* none */ }
    return 'npm test';
  }

  private async testsPass(cwd: string, cmd: string): Promise<boolean> {
    try { await execAsync(cmd, { cwd, timeout: 300000, maxBuffer: 32 * 1024 * 1024 }); return true; } catch { return false; }
  }

  /** Ask the model for N genuinely different strategies. Falls back to generic ones. */
  async proposeApproaches(task: string, n: number): Promise<string[]> {
    const system = `You are a senior engineer. Propose exactly ${n} GENUINELY DIFFERENT high-level approaches to the task. Each must be one concise line (no numbering, no extra prose). They should differ in strategy/architecture, not just wording.`;
    try {
      const out = await this.llmAdapter.chatCompletion([{ role: 'user', content: `Task: ${task}` }], system);
      const lines = out
        .split('\n')
        .map(l => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
        .filter(Boolean);
      const uniq = Array.from(new Set(lines)).slice(0, n);
      if (uniq.length >= 2) return uniq;
    } catch { /* fall through to defaults */ }
    return Array.from({ length: n }, (_, i) => `Approach ${i + 1}: solve the task using a distinct strategy from the others.`);
  }

  async run(task: string, opts?: { count?: number; testCommand?: string }): Promise<SpeculativeReport> {
    const testCommand = this.resolveTestCommand(opts?.testCommand);
    const count = Math.max(2, Math.min(opts?.count ?? 3, 4));
    const report: SpeculativeReport = { task, testCommand, arms: [] };

    if (!this.isGitRepo()) {
      this.log('error', 'Speculative solving needs a git repository (each approach runs in its own worktree).');
      return report;
    }

    this.log('info', `Proposing ${count} distinct approaches…`);
    const approaches = await this.proposeApproaches(task, count);
    approaches.forEach((a, i) => this.log('info', `  ${i + 1}. ${a}`));

    const arms = await Promise.all(approaches.map(async (approach, i): Promise<SpeculativeArm> => {
      const branch = `spec/${this.stamp}/${i + 1}`;
      let wt = '';
      try {
        wt = (await this.worktrees.createWorktree(branch, 'HEAD')).worktreePath;
        const ctx = await buildAgentContextBlock({ goal: task, subtask: approach });
        const prompt = `${ctx}Task: ${task}\n\nImplement it using THIS specific approach (do not switch to a different one):\n${approach}\n\nWork only inside this worktree. Make the changes directly; do not commit.`;
        this.log('info', `▶ Approach ${i + 1} working…`);
        try {
          await this.subagents.spawnWorker(`spec-${this.stamp}-${i + 1}`, { agentType: 'OpenCode', prompt, cwd: wt, parentMode: this.parentMode });
        } catch (e: any) {
          this.log('warn', `Approach ${i + 1} agent error: ${(e.message || '').slice(0, 80)}`);
        }
        const changed = await this.worktrees.hasChanges(wt);
        let filesChanged = 0;
        try { filesChanged = this.git(['status', '--porcelain'], wt).split('\n').filter(Boolean).length; } catch { /* ignore */ }
        if (changed) await this.worktrees.commitChanges(wt, `spec(${i + 1}): ${approach.slice(0, 50)}`);
        const testsPassed = changed ? await this.testsPass(wt, testCommand) : false;
        this.log(testsPassed ? 'success' : 'info', `Approach ${i + 1}: changed=${changed} files=${filesChanged} tests=${testsPassed ? 'PASS' : 'fail'}`);
        return { index: i + 1, approach, branch, ran: true, changed, filesChanged, testsPassed, detail: changed ? (testsPassed ? 'tests pass' : 'tests fail') : 'no changes' };
      } catch (e: any) {
        return { index: i + 1, approach, branch, ran: false, changed: false, filesChanged: 0, testsPassed: false, detail: e.message };
      } finally {
        if (wt) { try { this.git(['worktree', 'remove', '--force', wt]); } catch { /* ignore */ } try { if (fs.existsSync(wt)) fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ } }
      }
    }));

    report.arms = arms;

    // Recommend: prefer passing tests, then fewest files changed (smallest viable change).
    const ranked = arms
      .filter(a => a.changed)
      .sort((a, b) => (Number(b.testsPassed) - Number(a.testsPassed)) || (a.filesChanged - b.filesChanged));
    if (ranked[0]) report.recommended = ranked[0].index;

    // Drop branches that produced nothing usable; keep the ones with changes for review.
    for (const a of arms) {
      if (a.branch && !a.changed) { try { this.git(['branch', '-D', a.branch]); a.branch = undefined; } catch { /* ignore */ } }
    }

    return report;
  }
}
