import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { globalSubAgentBlackboard, SubAgentClaim } from '../../core/subagent.blackboard';
import { globalSubAgentManager } from '../../core/subagent.manager';

// Task management — inspect and control the sub-agents (background tasks) spawned via
// SpawnSubagentTool. Sub-agents are otherwise fire-and-forget: the orchestrator could spawn a swarm
// but had no way to LIST who's running, GET one finished agent's output on demand, or STOP a runaway.
// This exposes the parent-side blackboard (status/coverage) + manager (lifecycle) to the agent,
// completing the map→reduce loop. (Parity with Claude Code's TaskList/TaskGet/TaskStop family,
// consolidated into one action-dispatched tool in the BiMax style.)

/** A stable, compact age string for a claim (running → since start; finished → total runtime). */
function ageOf(c: SubAgentClaim): string {
  const ms = (c.endedAt ?? Date.now()) - c.startedAt;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

const ICON: Record<SubAgentClaim['status'], string> = { running: '◍', done: '✓', failed: '✗' };

function fmtRow(c: SubAgentClaim): string {
  const scope = c.scope && c.scope !== '(unscoped)' ? ` · ${c.scope}` : '';
  return `${ICON[c.status]} ${c.taskId} — ${c.agentType} [${c.status}]${scope} · ${c.toolCalls} tools · ${ageOf(c)}\n    ${c.prompt}`;
}

export const createTasksTool = (governor: IGovernor) => buildTool({
  name: 'TasksTool',
  description: `Inspect and control the sub-agents (background tasks) you spawned with SpawnSubagentTool.

# Actions (pass as \`action\`)
- \`list\` — every sub-agent this session: id, type, scope, status (running/done/failed), tool count, age. Use this to coordinate a swarm and see coverage before spawning more.
- \`get\` — the full result (or error) of ONE sub-agent by \`taskId\`. Use after \`list\` to pull a specific finished agent's output on demand, without waiting for it to re-post.
- \`wait\` — efficiently wait for one running agent to settle (up to \`timeout_seconds\`, max 60) instead of polling or burning model turns.
- \`stop\` — terminate a running sub-agent by \`taskId\` (e.g. one that's stuck, looping, or now redundant).`,
  isDestructive: false, // control-plane, not a code mutation — but 'stop' is real, so keep it un-batched
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'get', 'wait', 'stop'], description: 'list | get | wait | stop' },
      taskId: { type: 'string', description: 'The sub-agent id (from `list`). Required for `get` and `stop`.' },
      timeout_seconds: { type: 'number', description: 'For wait: 1-60 seconds. Defaults to 30.' },
    },
    required: ['action'],
  },
  execute: async (args: { action: string; taskId?: string; timeout_seconds?: number }) => {
    const bb = globalSubAgentBlackboard;
    const action = (args.action || '').toLowerCase();

    if (action === 'list') {
      bb.prune();
      const all = bb.all();
      if (all.length === 0) return 'No sub-agents spawned this session.';
      const running = all.filter(c => c.status === 'running').length;
      return `Sub-agents — ${running} running · ${all.length} total\n\n` + all.map(fmtRow).join('\n');
    }

    if (action === 'get') {
      if (!args.taskId) return 'Error: `get` requires a `taskId` (run `list` to see ids).';
      const c = bb.all().find(x => x.taskId === args.taskId);
      if (!c) return `Error: no sub-agent with id ${args.taskId} (it may have been pruned — results older than a few minutes are dropped).`;
      const header = `${ICON[c.status]} ${c.agentType} [${c.status}] · ${c.toolCalls} tools · ${ageOf(c)}`;
      if (c.status === 'running') return `${header}\n\nStill running — no result yet. Re-check with \`get\` shortly, or \`list\` for live status.`;
      if (c.status === 'failed') return `${header}\n\n✗ Failed: ${c.error || 'unknown error'}`;
      return `${header}\n\n${c.result || '(finished with no textual result)'}`;
    }

    if (action === 'wait') {
      const before = new Map(bb.active().map(claim => [claim.taskId, claim.status]));
      if (before.size === 0) return 'No sub-agents are running.';
      const timeoutMs = Math.max(1, Math.min(60, Number(args.timeout_seconds) || 30)) * 1000;
      const deadline = Date.now() + timeoutMs;
      await new Promise<void>(resolve => {
        const check = () => {
          const changed = bb.all().some(claim => before.has(claim.taskId) && claim.status !== 'running');
          if (changed || Date.now() >= deadline || bb.active().length === 0) {
            resolve();
            return;
          }
          const timer = setTimeout(check, 200);
          timer.unref?.();
        };
        check();
      });
      const settled = bb.all().filter(claim => before.has(claim.taskId) && claim.status !== 'running');
      if (settled.length) return `Agent update:\n\n${settled.map(fmtRow).join('\n')}`;
      return `Wait timed out after ${Math.round(timeoutMs / 1000)}s; ${bb.active().length} sub-agent(s) still running.`;
    }

    if (action === 'stop') {
      if (!args.taskId) return 'Error: `stop` requires a `taskId` (run `list` to see ids).';
      const c = bb.all().find(x => x.taskId === args.taskId);
      if (!c) return `Error: no sub-agent with id ${args.taskId}.`;
      if (c.status !== 'running') return `Sub-agent ${args.taskId} is already ${c.status} — nothing to stop.`;
      globalSubAgentManager.killWorker(args.taskId);
      bb.markFailed(args.taskId, 'stopped by the orchestrator');
      return `Stopped sub-agent ${args.taskId} (${c.agentType}).`;
    }

    return `Error: unknown action "${args.action}". Use one of: list, get, wait, stop.`;
  },
}, governor);
