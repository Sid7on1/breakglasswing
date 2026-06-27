import { exec, execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { WorktreeManager } from './worktree.manager';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface Candidate {
  name: string;       // display / branch name
  bin: string;        // binary to probe on PATH
  // Headless invocation as an argv array ([bin, ...args]) — run with execFile (no shell), so the
  // task prompt is always a single argument and can never inject shell metacharacters.
  build: (prompt: string) => string[];
}

export interface CouncilMemberResult {
  name: string;
  available: boolean;
  ran: boolean;
  changed: boolean;
  testsPassed: boolean;
  filesChanged: number;
  branch?: string;
  detail: string;
}

export interface CouncilReport {
  task: string;
  testCommand: string;
  members: CouncilMemberResult[];
  winner?: string;        // member name
  winnerBranch?: string;
}

export type CouncilLogger = (level: 'info' | 'success' | 'error' | 'warn', msg: string) => void;

/** Built-in external CLIs we know how to drive headlessly. Pruned to those installed. */
export const DEFAULT_COUNCIL: Candidate[] = [
  { name: 'claude', bin: 'claude', build: p => ['claude', '-p', p] },
  { name: 'gemini', bin: 'gemini', build: p => ['gemini', '-p', p] },
  { name: 'opencode', bin: 'opencode', build: p => ['opencode', 'run', p] },
  { name: 'bimax', bin: 'bimax', build: p => ['bimax', '-p', p] },
];

/**
 * Council of Models. Sends one task to every installed external AI CLI, each working
 * in its own isolated git worktree, then judges the candidates by running the test
 * suite against each and keeps the winner on a branch for the user to merge.
 */
export class CouncilOrchestrator {
  private readonly worktrees: WorktreeManager;
  private readonly stamp = Date.now().toString(36);

  constructor(
    private projectRoot: string,
    private candidates: Candidate[] = DEFAULT_COUNCIL,
    private log: CouncilLogger = () => {}
  ) {
    this.worktrees = new WorktreeManager(projectRoot);
  }

  private git(args: string[], cwd = this.projectRoot): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }).trim();
  }

  private isGitRepo(): boolean {
    try { return this.git(['rev-parse', '--is-inside-work-tree']) === 'true'; } catch { return false; }
  }

  private async available(bin: string): Promise<boolean> {
    // `bin` as a positional arg ($1), never interpolated into the script — so it can't inject.
    try { await execFileAsync('sh', ['-c', 'command -v "$1"', '_', bin], { cwd: this.projectRoot }); return true; } catch { return false; }
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

  async run(task: string, opts?: { testCommand?: string; timeoutMs?: number }): Promise<CouncilReport> {
    const testCommand = this.resolveTestCommand(opts?.testCommand);
    const report: CouncilReport = { task, testCommand, members: [] };

    if (!this.isGitRepo()) {
      this.log('error', 'Council needs a git repository (each model works in its own worktree).');
      return report;
    }

    // Prune to installed CLIs.
    const live: Candidate[] = [];
    for (const c of this.candidates) {
      if (await this.available(c.bin)) live.push(c);
      else report.members.push({ name: c.name, available: false, ran: false, changed: false, testsPassed: false, filesChanged: 0, detail: 'not installed' });
    }
    if (live.length === 0) {
      this.log('error', `None of the council CLIs are installed (${this.candidates.map(c => c.bin).join(', ')}).`);
      return report;
    }
    this.log('info', `Council members available: ${live.map(c => c.name).join(', ')}. Judging by: ${testCommand}`);

    const timeout = opts?.timeoutMs ?? 600000;
    const results = await Promise.all(live.map(async (c): Promise<CouncilMemberResult> => {
      const branch = `council/${this.stamp}/${c.name}`;
      let wt = '';
      try {
        wt = (await this.worktrees.createWorktree(branch, 'HEAD')).worktreePath;
        this.log('info', `▶ ${c.name} working…`);
        try {
          const [argvBin, ...argvRest] = c.build(task);
          await execFileAsync(argvBin, argvRest, { cwd: wt, timeout, maxBuffer: 64 * 1024 * 1024, env: process.env });
        } catch (e: any) {
          // CLI may exit non-zero yet still have made useful edits — judge by tests/changes.
          this.log('warn', `${c.name} exited non-zero: ${(e.message || '').slice(0, 80)}`);
        }
        const changed = await this.worktrees.hasChanges(wt);
        let filesChanged = 0;
        try { filesChanged = this.git(['status', '--porcelain'], wt).split('\n').filter(Boolean).length; } catch { /* ignore */ }
        if (changed) await this.worktrees.commitChanges(wt, `council(${c.name}): ${task.slice(0, 50)}`);
        const passed = changed ? await this.testsPass(wt, testCommand) : false;
        this.log(passed ? 'success' : 'info', `${c.name}: changed=${changed} files=${filesChanged} tests=${passed ? 'PASS' : 'fail'}`);
        return { name: c.name, available: true, ran: true, changed, testsPassed: passed, filesChanged, branch, detail: changed ? (passed ? 'tests pass' : 'tests fail') : 'no changes' };
      } catch (e: any) {
        return { name: c.name, available: true, ran: false, changed: false, testsPassed: false, filesChanged: 0, detail: e.message };
      } finally {
        // Worktree dir removed; branches kept until we pick a winner below.
        if (wt) { try { this.git(['worktree', 'remove', '--force', wt]); } catch { /* ignore */ } try { if (fs.existsSync(wt)) fs.rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ } }
      }
    }));

    report.members.push(...results);

    // Judge: prefer a candidate whose tests pass; tie-break by most files changed.
    const ranked = results
      .filter(r => r.changed)
      .sort((a, b) => (Number(b.testsPassed) - Number(a.testsPassed)) || (b.filesChanged - a.filesChanged));
    const winner = ranked[0];
    if (winner) {
      report.winner = winner.name;
      report.winnerBranch = winner.branch;
      this.log('success', `Winner: ${winner.name} (${winner.detail}).`);
    } else {
      this.log('warn', 'No council member produced usable changes.');
    }

    // Drop the losing branches; keep only the winner's.
    for (const r of results) {
      if (r.branch && r.name !== report.winner) {
        try { this.git(['branch', '-D', r.branch]); } catch { /* ignore */ }
      }
    }

    return report;
  }
}
