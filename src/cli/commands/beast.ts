import { execFileSync } from 'child_process';
import { globalCommandRegistry } from './registry';
import { SwarmOrchestrator } from '../../evolution/swarm.orchestrator';
import { SpeculativeSolver } from '../../evolution/speculative.solver';
import { TestHealer } from '../../sandbox/test.healer';
import { globalSubAgentManager } from '../../core/subagent.manager';
import { globalCheckpointManager } from '../../sandbox/checkpoint.manager';
import { globalProjectMemory } from '../../memory/project.memory';
import { getGoalManager } from '../../memory/goal.manager';
import { buildAgentContextBlock } from '../../evolution/agent.context';
import { WorktreeManager } from '../../evolution/worktree.manager';

function isGitRepo(cwd: string): boolean {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf-8' }).trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * /beast <goal> — the mega-pipeline. Choreographs the existing orchestrators end-to-end, autonomously,
 * leaving the result on a review branch (no auto-merge). Every sub-agent it spawns is graph-aware (via
 * buildAgentContextBlock — same enrichment that now flows through /swarm, /speculate, /heal).
 *
 * Chain: recall goals+memory → [optional speculate] → swarm (decompose+parallel worktrees) → heal the
 * integration branch → self-critic review pass → checkpoint → record a memory of the outcome.
 *
 * Flags: --speculate N  (propose N approaches first and refine the goal with the recommended one).
 */
globalCommandRegistry.register({
  name: '/beast',
  description: 'Autonomous mega-pipeline: graph-aware swarm → heal → self-critic → checkpoint, on a review branch',
  category: 'Code & Intelligence',
  execute: async (args, context) => {
    // Parse --speculate N out of the args, rest is the goal.
    let speculateN = 0;
    const rest: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--speculate') { speculateN = Math.max(2, Math.min(parseInt(args[++i] || '3', 10) || 3, 5)); continue; }
      rest.push(args[i]);
    }
    const goal = rest.join(' ').trim();
    if (!goal) {
      return { type: 'message', level: 'error', content: 'Usage: /beast <goal> [--speculate N]. Example: /beast add rate limiting to the API' };
    }
    if (!isGitRepo(context.cwd)) {
      return { type: 'message', level: 'error', content: 'Beast needs a git repository (sub-agents work in isolated worktrees). Run `git init` first.' };
    }
    const llmAdapter = context.options.llmAdapter;
    if (!llmAdapter) return { type: 'message', level: 'error', content: 'LLM adapter unavailable in this context.' };
    const mode = context.options.governor?.mode || 'interactive';
    const log = (level: 'info' | 'success' | 'error' | 'warn', msg: string) =>
      context.addSystemMessage(level === 'warn' ? 'info' : level, msg);

    const sections: string[] = [];
    context.addSystemMessage('info', `🦾 Beast engaged for: "${goal}"`);

    try {
      // 1. Recall standing context (for the header + to confirm the loop is memory-fed).
      try {
        const activeGoals = getGoalManager().getActiveGoals();
        if (activeGoals.length) log('info', `Aligning with ${activeGoals.length} active goal(s).`);
      } catch { /* goals optional */ }

      // 2. Optional speculate — propose distinct approaches, adopt the recommended one.
      let workingGoal = goal;
      if (speculateN > 0) {
        log('info', `🔭 Speculating ${speculateN} approaches…`);
        const solver = new SpeculativeSolver(context.cwd, llmAdapter, mode, log);
        const spec = await solver.run(goal, { count: speculateN });
        const pick = spec.recommended != null ? spec.arms[spec.recommended] : undefined;
        if (pick) {
          workingGoal = `${goal}\n\nPreferred approach (from speculation): ${pick.approach}`;
          sections.push(`🔭 Speculation: ${spec.arms.length} approaches tried; adopted #${pick.index + 1}${pick.testsPassed ? ' (tests passed)' : ''}.`);
        } else {
          sections.push(`🔭 Speculation: no clearly-better approach; proceeding with the raw goal.`);
        }
      }

      // 3. Swarm — decompose + parallel graph-aware sub-agents → integration branch.
      log('info', '🐝 Swarming…');
      const swarm = new SwarmOrchestrator(context.cwd, llmAdapter, mode, log);
      const report = await swarm.run(workingGoal, { autoMerge: false });
      const ok = report.nodes.filter(n => n.status === 'completed').length;
      const nodeLines = report.nodes.map(n => {
        const icon = n.status === 'completed' ? '✔' : n.status === 'conflict' ? '⚠' : n.status === 'skipped' ? '·' : '✖';
        return `  ${icon} ${n.id} — ${n.status}${n.detail ? ` (${n.detail})` : ''}`;
      });
      sections.push(`🐝 Swarm: ${ok}/${report.nodes.length} task(s) succeeded.\n${nodeLines.join('\n')}`);
      const branch = report.integrationBranch;

      // 4. Heal — run the test suite against the integration branch; auto-fix in a worktree if red.
      log('info', '🩺 Healing the integration branch…');
      const healer = new TestHealer(context.cwd, mode, log);
      const heal = await healer.heal({ baseRef: branch, goal: `make tests pass for: ${goal}` });
      sections.push(
        heal.initiallyGreen ? '🩺 Heal: tests already green.'
        : heal.healed ? `🩺 Heal: tests were red, auto-fixed on \`${heal.branch}\` (merge that into the integration branch).`
        : '🩺 Heal: tests red and not fully fixed — review needed.',
      );

      // 5. Self-critic — one review/fix pass over the integration diff in its own worktree.
      log('info', '🔎 Self-critic review pass…');
      try {
        const wm = new WorktreeManager(context.cwd);
        const critBranch = `beast/critic/${Date.now().toString(36)}`;
        const { worktreePath } = await wm.createWorktree(critBranch, branch);
        const ctx = await buildAgentContextBlock({ goal, subtask: `review the changes for goal: ${goal}` });
        const prompt = `${ctx}Review the work done toward this goal and FIX any real problems you find — correctness bugs, missed cases, inconsistencies with the codebase. Do NOT add new scope.\n\nGoal: ${goal}\n\nInspect the diff with git/BashTool, then fix in place. Work only inside this worktree; do not commit.`;
        await globalSubAgentManager.spawnWorker(`beast-critic-${Date.now().toString(36)}`, { agentType: 'OpenClaw', prompt, cwd: worktreePath, parentMode: mode });
        const changed = await wm.hasChanges(worktreePath);
        if (changed) {
          await wm.commitChanges(worktreePath, 'beast: self-critic fixes');
          sections.push(`🔎 Self-critic: applied fixes on \`${critBranch}\` (merge into the integration branch if you want them).`);
        } else {
          await wm.removeWorktree(critBranch, true).catch(() => {});
          sections.push('🔎 Self-critic: no issues found.');
        }
      } catch (e: any) {
        sections.push(`🔎 Self-critic: skipped (${(e.message || 'error').slice(0, 60)}).`);
      }

      // 6. Checkpoint — lightweight snapshot so the run is anchored in the time machine.
      const cp = globalCheckpointManager.create(`beast: ${goal.slice(0, 60)}`, false);
      if (cp) sections.push(`📌 Checkpoint ${cp.id} recorded.`);

      // 7. Memory-fed close — record the outcome so the next run/session carries it forward.
      try {
        await globalProjectMemory.remember(
          `Beast run for "${goal}": swarm ${ok}/${report.nodes.length} ok on ${branch}; heal ${heal.initiallyGreen ? 'green' : heal.healed ? 'fixed' : 'needs review'}.`,
          'note', ['beast'],
        );
      } catch { /* memory optional */ }

      const summary =
        `🦾 Beast complete for: "${goal}"\n\n` +
        sections.join('\n\n') +
        `\n\nResult is on branch \`${branch}\`. Review it, then merge with:\n  git merge ${branch}`;
      return { type: 'message', level: ok === report.nodes.length ? 'success' : 'info', content: summary };
    } catch (e: any) {
      return { type: 'message', level: 'error', content: `Beast failed: ${e.message}` };
    }
  },
});
