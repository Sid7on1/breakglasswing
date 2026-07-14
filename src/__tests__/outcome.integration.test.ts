import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OutcomeManager } from '../outcome/outcome.manager';
import { createWorktree, inspectWorktreeChanges } from '../core/worktree.manager';
import { SubAgentResultEnvelope } from '../core/subagent.result';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

describe('delegated worktree integration gate', () => {
  let repo: string;
  let state: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-integration-'));
    state = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-integration-state-'));
    git(repo, 'init');
    git(repo, 'config', 'user.email', 'test@bimax.local');
    git(repo, 'config', 'user.name', 'Bimax Test');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'value.ts'), 'export const value = 1;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'base');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
  });

  it('requires actual parent integration followed by fresh trusted verification', () => {
    const worktree = createWorktree(repo, 'subagent-integration1');
    expect(worktree).not.toBeNull();
    fs.writeFileSync(path.join(worktree!.path, 'src', 'value.ts'), 'export const value = 2;\n');
    const changed = inspectWorktreeChanges(worktree!);

    const manager = new OutcomeManager({ sessionId: () => 'integration-session', directory: () => state, silent: true });
    manager.syncSession();
    manager.define('Integrate delegated change', [{ id: 'tests', description: 'Tests pass', verification: 'build_test' }]);
    manager.setTasks([{ id: 'build', title: 'Build change', execution: 'agent', scope: 'src', criterionIds: ['tests'] }]);
    manager.assignTask('build', 'worker-1');
    const result: SubAgentResultEnvelope = {
      version: 1, taskId: 'worker-1', outcomeTaskId: 'build', agentType: 'BiMax',
      report: 'implemented', claimedScope: 'src', observedChangedFiles: changed,
      startedAt: Date.now() - 100, endedAt: Date.now(), toolCalls: 3,
      isolation: { kind: 'worktree', repoRoot: worktree!.repoRoot, path: worktree!.path,
        branch: worktree!.branch, baseCommit: worktree!.baseCommit, state: 'pending_integration' },
    };
    manager.settleAssignment('build', 'worker-1', true, result);
    manager.onBuildEvidence({ command: 'npm test before merge', ok: true });

    expect(manager.task('build')?.assignment?.integrationStatus).toBe('pending');
    expect(() => manager.validateTask('build')).toThrow(/pending integration/i);
    expect(fs.readFileSync(path.join(repo, 'src', 'value.ts'), 'utf8')).toContain('value = 1');
    expect(fs.readFileSync(path.join(worktree!.path, 'src', 'value.ts'), 'utf8')).toContain('value = 2');
    expect(manager.task('build')?.assignment?.observedChangedFiles).toEqual(['src/value.ts']);
    expect(fs.realpathSync(manager.task('build')!.assignment!.isolation!.repoRoot)).toBe(fs.realpathSync(repo));
    expect(fs.readFileSync(path.join(repo, 'src', 'value.ts')).equals(
      fs.readFileSync(path.join(worktree!.path, 'src', 'value.ts'))
    )).toBe(false);
    expect(() => manager.confirmTaskIntegration('build')).toThrow(/not integrated/i);

    // A merge/cherry-pick/equivalent parent operation happens outside the confirmation action.
    fs.copyFileSync(path.join(worktree!.path, 'src', 'value.ts'), path.join(repo, 'src', 'value.ts'));
    // The first failed confirmation records a conflict, but a corrected parent may be rechecked.
    manager.confirmTaskIntegration('build');
    expect(manager.task('build')?.assignment?.integrationStatus).toBe('integrated');
    expect(manager.current()?.criteria[0].status).toBe('pending');

    manager.onBuildEvidence({ command: 'npm test after merge', ok: true, repoWide: true });
    expect(manager.validateTask('build').status).toBe('verified');
    manager.shutdown();
  });

  it('automatically integrates reviewed in-scope changes and rejects partial verification', () => {
    const worktree = createWorktree(repo, 'subagent-integration2')!;
    fs.writeFileSync(path.join(worktree.path, 'src', 'value.ts'), 'export const value = 3;\n');
    const manager = new OutcomeManager({ sessionId: () => 'auto-integration-session', directory: () => state, silent: true });
    manager.syncSession();
    manager.define('Safely integrate delegated change', [{ id: 'tests', description: 'Tests pass', verification: 'build_test' }]);
    manager.setTasks([{ id: 'build', title: 'Build change', execution: 'agent', scope: 'src', criterionIds: ['tests'] }]);
    manager.assignTask('build', 'worker-2');
    manager.settleAssignment('build', 'worker-2', true, {
      version: 1, taskId: 'worker-2', outcomeTaskId: 'build', agentType: 'BiMax', report: 'implemented',
      claimedScope: 'src', observedChangedFiles: inspectWorktreeChanges(worktree),
      startedAt: Date.now() - 100, endedAt: Date.now(), toolCalls: 2,
      isolation: { kind: 'worktree', ...worktree, state: 'pending_integration' },
    });

    const receipt = manager.integrateTask('build');
    expect(receipt.integrationStatus).toBe('integrated');
    expect(receipt.integrationCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(fs.readFileSync(path.join(repo, 'src', 'value.ts'), 'utf8')).toContain('value = 3');
    expect(fs.existsSync(worktree.path)).toBe(false);

    manager.onBuildEvidence({ command: 'npx jest src/other.test.ts', ok: true, coveredFiles: ['src/other.ts'], repoWide: false });
    expect(() => manager.validateTask('build')).toThrow(/covering: src\/value\.ts/i);
    manager.onBuildEvidence({ command: 'npm test', ok: true, repoWide: true });
    expect(manager.validateTask('build').status).toBe('verified');
    manager.shutdown();
  });

  it('keeps the isolated branch when parent work overlaps the assignment', () => {
    const worktree = createWorktree(repo, 'subagent-integration3')!;
    fs.writeFileSync(path.join(worktree.path, 'src', 'value.ts'), 'export const value = 4;\n');
    fs.writeFileSync(path.join(repo, 'src', 'value.ts'), 'export const value = 99;\n');
    const manager = new OutcomeManager({ sessionId: () => 'conflict-session', directory: () => state, silent: true });
    manager.syncSession();
    manager.define('Reject conflicting integration', ['Parent work is preserved']);
    manager.setTasks([{ id: 'build', title: 'Build change', execution: 'agent', scope: 'src' }]);
    manager.assignTask('build', 'worker-3');
    manager.settleAssignment('build', 'worker-3', true, {
      version: 1, taskId: 'worker-3', outcomeTaskId: 'build', agentType: 'BiMax', report: 'implemented',
      claimedScope: 'src', observedChangedFiles: inspectWorktreeChanges(worktree),
      startedAt: Date.now() - 100, endedAt: Date.now(), toolCalls: 2,
      isolation: { kind: 'worktree', ...worktree, state: 'pending_integration' },
    });
    expect(() => manager.integrateTask('build')).toThrow(/uncommitted changes overlapping/i);
    expect(manager.task('build')?.assignment?.integrationStatus).toBe('conflict');
    expect(fs.readFileSync(path.join(repo, 'src', 'value.ts'), 'utf8')).toContain('value = 99');
    expect(fs.existsSync(worktree.path)).toBe(true);
    manager.shutdown();
  });
});
