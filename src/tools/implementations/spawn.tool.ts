import { ToolDef, buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { ToolRegistry } from '../tool.registry';
import { LlmAdapter } from '../../core/llm.adapter';
import { HermesPersona, OpenCodePersona, OpenClawPersona, BiMaxPersona } from '../../cli/personas/implementations';
import { SkillLoader, DynamicPersona } from '../../cli/skills.loader';
import { Logger } from '../../utils/logger';
import { SubAgentManager, globalSubAgentManager } from '../../core/subagent.manager';
import { randomUUID } from 'crypto';

export function createSpawnSubagentTool(governor: IGovernor, registry: ToolRegistry, llmAdapter: LlmAdapter): BuiltTool {
  let spawnCount = 0;

  return buildTool({
    name: 'SpawnSubagentTool',
    description: `Spawns an asynchronous, parallel sub-agent as a native WorkerThread to handle a delegated task.

Use this tool when a user request is too massive or complex to be completed in a single sequential thought process.

# Instructions
- **Decomposition:** Mentally break the user's goal into isolated sub-tasks.
- **Specific Prompts:** The sub-agent boots with a BLANK short-term memory. The prompt must contain everything it needs to know.
- **Fire and Forget:** You will receive a \`TASK_QUEUED\` confirmation. The system notifies you once it completes.`,
    isDestructive: false,
    schema: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          enum: ['Hermes', 'OpenCode', 'OpenClaw', 'BiMax', ...Object.keys(SkillLoader.getAllSkills())],
          description: 'The type of sub-agent to spawn.'
        },
        prompt: {
          type: 'string',
          description: 'The highly detailed prompt/task for the sub-agent.'
        },
        maxSubAgents: {
          type: 'number',
          description: 'Maximum number of sub-agents allowed per turn (default 5).'
        }
      },
      required: ['agentType', 'prompt']
    },
    execute: async (args: { agentType: string, prompt: string, maxSubAgents?: number }, context?: any) => {
      const maxSpawns = args.maxSubAgents || 5;
      if (spawnCount >= maxSpawns) {
        return `Error: Spawn limit reached for this turn (${maxSpawns}). Wait for results before spawning more.`;
      }

      spawnCount++;

      const currentCwd = context?.cwd || process.cwd();
      const parentMode = (governor as any).mode; // Pass the permission bridge

      const taskId = `subagent-${randomUUID()}`;

      // We don't await the worker here. We fire and forget.
      globalSubAgentManager.spawnWorker(taskId, {
        agentType: args.agentType,
        prompt: args.prompt,
        cwd: currentCwd,
        parentMode: parentMode
      }).then(result => {
        Logger.info(`[SpawnSubagentTool] Sub-agent ${taskId} finished successfully.`);
      }).catch(err => {
        Logger.error(`[SpawnSubagentTool] Sub-agent ${taskId} failed: ${err.message}`);
      });

      return `TASK_QUEUED: Sub-agent ${args.agentType} spawned successfully as WorkerThread ${taskId}.`;
    }
  }, governor);
}
