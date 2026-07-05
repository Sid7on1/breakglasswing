import { ToolDef, buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { ToolRegistry } from '../tool.registry';
import { LlmAdapter } from '../../core/llm.adapter';
import { HermesPersona, OpenCodePersona, OpenClawPersona, BiMaxPersona } from '../../cli/personas/implementations';
import { SkillLoader, DynamicPersona } from '../../cli/skills.loader';
import { Logger } from '../../utils/logger';
import { SubAgentManager, globalSubAgentManager } from '../../core/subagent.manager';
import { globalSubAgentBlackboard } from '../../core/subagent.blackboard';
import { cliEvents } from '../../cli/events';
import { randomUUID } from 'crypto';

export function createSpawnSubagentTool(governor: IGovernor, registry: ToolRegistry, llmAdapter: LlmAdapter): BuiltTool {
  return buildTool({
    name: 'SpawnSubagentTool',
    description: `Spawns an asynchronous, parallel sub-agent as a native WorkerThread to handle a delegated task.

Use this tool when a user request is too massive or complex to be completed in a single sequential thought process.

# Instructions
- **Decomposition:** Mentally break the user's goal into isolated sub-tasks.
- **Specific Prompts:** The sub-agent boots with a BLANK short-term memory. The prompt must contain everything it needs to know.
- **Asynchronous:** You get a \`TASK_QUEUED\` confirmation immediately. The sub-agent runs in the background; when it finishes, its result is posted into the conversation as a system message (visible to you and the user). It is NOT injected silently into your context mid-turn — so if you need to act on the output, finish your current turn and the result will be waiting.`,
    isDestructive: false,
    schema: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          enum: ['BiMax', 'Hermes', 'OpenCode', 'OpenClaw', ...Object.keys(SkillLoader.getAllSkills())],
          description: 'The sub-agent persona. Default and standard is "BiMax" — a full copy of yourself with the same tools and reasoning; omit this to spawn BiMax. The others are legacy specialized personas — only use one if the task specifically calls for it.'
        },
        prompt: {
          type: 'string',
          description: 'The highly detailed prompt/task for the sub-agent.'
        },
        scope: {
          type: 'string',
          description: 'What this sub-agent OWNS — the files, directories, or topic it covers (e.g. "src/graph, src/mind" or "the auth flow"). Give each parallel sub-agent a DISJOINT scope so two agents never read/redo the same thing. Overlaps are flagged back to you.'
        },
        isolation: {
          type: 'string',
          enum: ['worktree'],
          description: 'Set to "worktree" to run the sub-agent in its own git worktree + branch (under .bimax/worktrees/). Use this whenever the sub-agent will EDIT files and siblings run in parallel — isolated agents can never clobber each other. The worktree is auto-removed if the agent changes nothing; otherwise its path and branch are reported for review/merge.'
        },
      },
      required: ['prompt']
    },
    execute: async (args: { agentType?: string, prompt: string, scope?: string, isolation?: 'worktree' }, context?: any) => {
      // Default to a BiMax sub-agent (a copy of ourselves) — never a stray legacy persona.
      const agentType = args.agentType || 'BiMax';
      const scope = args.scope || '';
      // Coordination: warn (don't block) if this scope collides with an already-running sibling, so
      // the orchestrator can re-partition instead of two agents grinding the same files.
      const collisions = globalSubAgentBlackboard.overlapping(scope);
      // Hard cap — NOT model-controllable. Keeping this as a constant (not an arg) prevents
      // the model from passing maxSubAgents:100 and spawning 100 worker threads.
      const MAX_CONCURRENT = 5;
      if (globalSubAgentManager.activeCount() >= MAX_CONCURRENT) {
        return `Error: Concurrent sub-agent limit reached (${MAX_CONCURRENT}). Wait for running sub-agents to finish before spawning more.`;
      }

      const currentCwd = context?.cwd || process.cwd();
      const parentMode = (governor as any).mode; // Pass the permission bridge

      const taskId = `subagent-${randomUUID()}`;

      // We don't await the worker here. We fire and forget.
      globalSubAgentManager.spawnWorker(taskId, {
        agentType,
        prompt: args.prompt,
        cwd: currentCwd,
        parentMode: parentMode,
        scope,
        ...(args.isolation === 'worktree' ? { isolation: 'worktree' as const } : {}),
      }).then(result => {
        Logger.info(`[SpawnSubagentTool] Sub-agent ${taskId} finished successfully.`);
        // Surface the result instead of discarding it (the prior code only logged). Posted as a
        // system message so it's visible to the user and captured in the transcript.
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        cliEvents.emit('message', {
          id: `subagent-result-${taskId}`,
          role: 'system',
          level: 'success',
          content: `✓ Sub-agent ${agentType} (${taskId}) finished:\n\n${text.slice(0, 4000)}`,
          timestamp: new Date(),
        });
      }).catch(err => {
        Logger.error(`[SpawnSubagentTool] Sub-agent ${taskId} failed: ${err.message}`);
        cliEvents.emit('message', {
          id: `subagent-result-${taskId}`,
          role: 'system',
          level: 'error',
          content: `✗ Sub-agent ${agentType} (${taskId}) failed: ${err.message}`,
          timestamp: new Date(),
        });
      });

      const overlapNote = collisions.length > 0
        ? ` ⚠ scope overlaps running sibling(s): ${collisions.map(c => `${c.agentType}[${c.scope}]`).join(', ')} — consider a disjoint scope so they don't redo the same work.`
        : '';
      return `TASK_QUEUED: Sub-agent ${agentType} spawned${scope ? ` (scope: ${scope})` : ''}${args.isolation === 'worktree' ? ' in an isolated git worktree' : ''} as ${taskId}.${overlapNote}`;
    }
  }, governor);
}
