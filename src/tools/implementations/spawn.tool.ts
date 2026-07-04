import { ToolDef, buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { ToolRegistry } from '../tool.registry';
import { LlmAdapter } from '../../core/llm.adapter';
import { HermesPersona, OpenCodePersona, OpenClawPersona, BiMaxPersona } from '../../cli/personas/implementations';
import { SkillLoader, DynamicPersona } from '../../cli/skills.loader';
import { Logger } from '../../utils/logger';
import { SubAgentManager, globalSubAgentManager } from '../../core/subagent.manager';
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
      },
      required: ['prompt']
    },
    execute: async (args: { agentType?: string, prompt: string }, context?: any) => {
      // Default to a BiMax sub-agent (a copy of ourselves) — never a stray legacy persona.
      const agentType = args.agentType || 'BiMax';
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
        parentMode: parentMode
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

      return `TASK_QUEUED: Sub-agent ${agentType} spawned successfully as WorkerThread ${taskId}.`;
    }
  }, governor);
}
