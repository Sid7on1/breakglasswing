import { exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { WorktreeManager } from './worktree.manager';
import { SubAgentManager } from '../core/subagent.manager';
import { GenomeRepository } from '../genome/genome.repository';
import { ArchitectureGuardian } from '../genome/guardian';

const execAsync = promisify(exec);

export interface EvolveReport {
  component: string;
  improvement: string;
  changed: boolean;
  guardianPassed: boolean;
  testsPassed: boolean;
  typecheckPassed: boolean;
  branch?: string;
  detail: string;
}

export type EvolveLogger = (level: 'info' | 'success' | 'error' | 'warn', msg: string) => void;

/**
 * Genome Self-Evolution (gated). The agent proposes an improvement to one of BiMax's
 * own genome components, implements it in an isolated worktree, and validates it
 * against the genome's architectural contracts via the ArchitectureGuardian. The
 * candidate is only kept (on a branch, for explicit human review) if the guardian
 * passes; it is NEVER auto-merged into the user's branch. Tests/typecheck are reported
 * as additional signal.
 */
export class GenomeEvolver {
  private readonly worktrees: WorktreeManager;
  private readonly subagents = new SubAgentManager();
  private readonly genome: GenomeRepository;
  private readonly stamp = Date.now().toString(36);

  constructor(
    private projectRoot: string,
    private parentMode: string,
    private log: EvolveLogger = () => {}
  ) {
    this.worktrees = new WorktreeManager(projectRoot);
    this.genome = new GenomeRepository(projectRoot);
  }

  private git(args: string[], cwd = this.projectRoot): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }).trim();
  }

  private isGitRepo(): boolean {
    try { return this.git(['rev-parse', '--is-inside-work-tree']) === 'true'; } catch { return false; }
  }

  async listComponents(): Promise<string[]> {
    const names: string[] = [];
    for (const n of ['CognitiveLoop', 'ActionRouter', 'ContextEngine', 'Governor']) {
      if (await this.genome.getComponent(n)) names.push(n);
    }
    return names;
  }

  private async ok(cmd: string, cwd: string): Promise<boolean> {
    try { await execAsync(cmd, { cwd, timeout: 300000, maxBuffer: 32 * 1024 * 1024 }); return true; } catch { return false; }
  }

  async evolve(component: string, improvement: string): Promise<EvolveReport> {
    const report: EvolveReport = { component, improvement, changed: false, guardianPassed: false, testsPassed: false, typecheckPassed: false, detail: '' };

    if (!this.isGitRepo()) { report.detail = 'Self-evolution needs a git repository.'; this.log('error', report.detail); return report; }

    const comp = await this.genome.getComponent(component);
    if (!comp) {
      const list = (await this.listComponents()).join(', ');
      report.detail = `Unknown genome component "${component}". Known: ${list}`;
      this.log('error', report.detail);
      return report;
    }

    const branch = `evolve/${this.stamp}/${component}`;
    report.branch = branch;
    const { worktreePath } = await this.worktrees.createWorktree(branch, 'HEAD');

    try {
      const targetFile = path.join(worktreePath, comp.path);
      const prompt = `You are improving BiMax's own source — the ${component} component (${comp.purpose}, risk: ${comp.riskLevel}).\n\nFile: ${comp.path}\nImprovement requested: ${improvement}\n\nConstraints:\n- Preserve the component's public behavior and any events it emits (its architectural contract is enforced after you finish).\n- Make a focused, minimal change. Do not refactor unrelated code.\n- Work only inside this worktree.`;

      this.log('info', `Implementing improvement to ${component} (${comp.path})…`);
      try {
        await this.subagents.spawnWorker(`evolve-${this.stamp}`, { agentType: 'OpenCode', prompt, cwd: worktreePath, parentMode: this.parentMode });
      } catch (e: any) {
        this.log('warn', `Evolution agent error: ${(e.message || '').slice(0, 100)}`);
      }

      report.changed = await this.worktrees.hasChanges(worktreePath);
      if (!report.changed) {
        report.detail = 'The agent made no changes.';
        this.log('warn', report.detail);
        // Remove the worktree BEFORE deleting the branch — git refuses to delete a
        // branch that is still checked out by a worktree.
        try { this.git(['worktree', 'remove', '--force', worktreePath]); } catch { /* ignore */ }
        try { this.git(['branch', '-D', branch]); report.branch = undefined; } catch { /* ignore */ }
        return report;
      }

      // Hard gate: architectural contract must still hold.
      this.log('info', 'Validating against genome contract (ArchitectureGuardian)…');
      const guardian = new ArchitectureGuardian(worktreePath, new GenomeRepository(this.projectRoot));
      try {
        report.guardianPassed = await guardian.validateCandidate(component, targetFile);
      } catch (e: any) {
        report.guardianPassed = false;
        this.log('warn', `Guardian threw: ${e.message}`);
      }

      // Additional signal (not a hard gate — this repo's baseline may be red).
      this.log('info', 'Running typecheck and tests for signal…');
      report.typecheckPassed = await this.ok('npx tsc --noEmit', worktreePath);
      report.testsPassed = await this.ok('npm test', worktreePath);

      await this.worktrees.commitChanges(worktreePath, `evolve(${component}): ${improvement.slice(0, 50)}`);

      if (!report.guardianPassed) {
        report.detail = 'Guardian REJECTED the candidate (contract violation). Branch discarded.';
        this.log('error', report.detail);
        // Remove worktree then drop the rejected branch.
        try { this.git(['worktree', 'remove', '--force', worktreePath]); } catch { /* ignore */ }
        try { this.git(['branch', '-D', branch]); } catch { /* ignore */ }
        report.branch = undefined;
        return report;
      }

      report.detail = `Guardian passed. Candidate kept on branch ${branch} for review (never auto-merged). typecheck=${report.typecheckPassed ? 'pass' : 'fail'}, tests=${report.testsPassed ? 'pass' : 'fail'}.`;
      this.log('success', report.detail);
      return report;
    } finally {
      // Always remove the worktree directory; branch retention is decided above.
      try { this.git(['worktree', 'remove', '--force', worktreePath]); } catch { /* ignore */ }
      try { if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}
