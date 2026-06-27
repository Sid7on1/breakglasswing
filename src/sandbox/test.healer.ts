import { exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { WorktreeManager } from '../evolution/worktree.manager';
import { SubAgentManager } from '../core/subagent.manager';
import { buildAgentContextBlock } from '../evolution/agent.context';

const execAsync = promisify(exec);

export interface HealReport {
  testCommand: string;
  initiallyGreen: boolean;
  healed: boolean;
  branch?: string;
  diffStat?: string;
  beforeFailure?: string;
  afterOutput?: string;
}

export type HealLogger = (level: 'info' | 'success' | 'error' | 'warn', msg: string) => void;

/**
 * Self-Healing Test Loop. Runs the test suite; if it is red, it spins up a fix agent
 * in an isolated git worktree, lets it edit and re-run until (hopefully) green,
 * verifies the result, and surfaces the patch on a branch for the user to approve.
 * The user's working tree is never modified.
 */
export class TestHealer {
  private readonly worktrees: WorktreeManager;
  private readonly subagents = new SubAgentManager();
  private readonly stamp = Date.now().toString(36);

  constructor(
    private projectRoot: string,
    private parentMode: string,
    private log: HealLogger = () => {}
  ) {
    this.worktrees = new WorktreeManager(projectRoot);
  }

  /** Best test command: explicit override, else package.json "test" script, else npm test. */
  resolveTestCommand(override?: string): string {
    if (override) return override;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf-8'));
      if (pkg.scripts && pkg.scripts.test) return 'npm test';
    } catch { /* no package.json */ }
    return 'npm test';
  }

  private async runTests(cwd: string, cmd: string): Promise<{ passed: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
      return { passed: true, output: (stdout || '') + (stderr || '') };
    } catch (e: any) {
      return { passed: false, output: ((e.stdout || '') + '\n' + (e.stderr || '') + '\n' + (e.message || '')).trim() };
    }
  }

  private git(args: string[], cwd = this.projectRoot): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }).trim();
  }

  private isGitRepo(): boolean {
    try { return this.git(['rev-parse', '--is-inside-work-tree']) === 'true'; } catch { return false; }
  }

  async heal(opts?: { testCommand?: string; maxRounds?: number; baseRef?: string; goal?: string }): Promise<HealReport> {
    const testCommand = this.resolveTestCommand(opts?.testCommand);
    const report: HealReport = { testCommand, initiallyGreen: false, healed: false };
    // baseRef lets a caller (e.g. /beast) heal a specific branch — the swarm integration branch —
    // rather than the user's working tree. When set, even the initial test must run against that ref,
    // so we create the worktree up-front and test inside it.
    const baseRef = opts?.baseRef;

    if (!this.isGitRepo()) {
      // Without git we can still report the (untouched-tree) state but can't heal in a worktree.
      this.log('info', `Running tests: ${testCommand}`);
      const only = await this.runTests(this.projectRoot, testCommand);
      report.initiallyGreen = only.passed;
      if (!only.passed) { report.beforeFailure = only.output.slice(-4000); this.log('error', 'Self-healing needs a git repository (the fix runs in a worktree).'); }
      return report;
    }

    const branch = `heal/${this.stamp}`;
    const { worktreePath } = await this.worktrees.createWorktree(branch, baseRef || 'HEAD');

    // Initial test: in the baseRef worktree when targeting a branch, else the user's tree.
    this.log('info', `Running tests: ${testCommand}${baseRef ? ` (on ${baseRef})` : ''}`);
    const first = await this.runTests(baseRef ? worktreePath : this.projectRoot, testCommand);
    if (first.passed) {
      report.initiallyGreen = true;
      this.log('success', 'Tests are already green — nothing to heal.');
      await this.worktrees.removeWorktree(branch, true).catch(() => {});
      return report;
    }
    report.beforeFailure = first.output.slice(-4000);
    report.branch = branch;
    this.log('warn', 'Tests are red. Spinning up a fix agent in an isolated worktree…');

    try {
      const maxRounds = Math.max(1, Math.min(opts?.maxRounds ?? 2, 3));
      let lastOutput = first.output;
      for (let round = 1; round <= maxRounds; round++) {
        this.log('info', `Fix round ${round}/${maxRounds}…`);
        const ctx = await buildAgentContextBlock({ goal: opts?.goal || 'make the failing test suite pass', subtask: lastOutput.slice(-1200) });
        const prompt = `${ctx}The test suite is failing. Make it pass.\n\nTest command: ${testCommand}\nRun it yourself with BashTool to see failures and to verify your fix.\n\nMost recent failing output:\n${lastOutput.slice(-3500)}\n\nFix the underlying cause in the source (do not delete or skip tests to make them pass). Work only inside this worktree.`;
        try {
          await this.subagents.spawnWorker(`heal-${this.stamp}-${round}`, {
            agentType: 'OpenClaw',
            prompt,
            cwd: worktreePath,
            parentMode: this.parentMode,
          });
        } catch (e: any) {
          this.log('error', `Fix agent error: ${e.message}`);
        }

        const verify = await this.runTests(worktreePath, testCommand);
        report.afterOutput = verify.output.slice(-4000);
        if (verify.passed) {
          report.healed = true;
          this.log('success', `Tests pass after round ${round}.`);
          break;
        }
        lastOutput = verify.output;
        this.log('warn', `Still red after round ${round}.`);
      }

      const hasChanges = await this.worktrees.hasChanges(worktreePath);
      if (hasChanges) {
        await this.worktrees.commitChanges(worktreePath, `heal: fix failing tests (${this.stamp})`);
        try { report.diffStat = this.git(['diff', '--stat', 'HEAD', branch]); } catch { /* ignore */ }
      }
    } finally {
      // Keep the branch (it holds the patch); remove only the worktree directory.
      try { this.git(['worktree', 'remove', '--force', worktreePath]); } catch { /* best effort */ }
      try { if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
      if (!report.healed) {
        // Nothing worth keeping if the patch didn't fix anything and made no changes.
        if (!report.diffStat) { try { this.git(['branch', '-D', branch]); report.branch = undefined; } catch { /* ignore */ } }
      }
    }

    return report;
  }
}
