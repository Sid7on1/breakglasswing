import { SubTask, SubTaskArraySchema } from './types';
import { LlmAdapter } from '../core/llm.adapter';
import { Logger } from '../utils';

export class TaskDecomposer {
  constructor(private llm: LlmAdapter) {}

  async decompose(prompt: string, maxRetries = 3): Promise<SubTask[]> {
    Logger.info(`[Decomposer] Initiating robust decomposition for: "${prompt}"`);
    
    let lastError = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const systemPrompt = `You are a strict task decomposer. Break down the user's prompt into a Directed Acyclic Graph of sub-tasks.
You MUST respond with a JSON array of objects. 
Each object MUST match this schema:
{
  "id": "string", // A unique local id like task-1
  "description": "string", // Clear action to perform
  "dependencies": ["string"] // Array of task ids that must be completed first
}

${lastError ? `\nWARNING: Your previous attempt failed validation. Please correct this exact error:\n${lastError}` : ''}`;

      Logger.info(`[Decomposer] LLM Attempt ${attempt}/${maxRetries}...`);
      const result = await this.llm.generateTinyPlans(prompt, systemPrompt);

      if (result.status !== 200 || !result.data) {
        Logger.error(`[Decomposer] LLM Network Error. Retry after: ${result.retryAfter}s`);
        await new Promise(r => setTimeout(r, (result.retryAfter || 2) * 1000));
        continue;
      }

      try {
        // Attempt strict Zod validation
        let rawData = result.data;
        if (rawData.tasks && Array.isArray(rawData.tasks)) {
           rawData = rawData.tasks;
        } else if (!Array.isArray(rawData)) {
           throw new Error("Expected a JSON array of tasks.");
        }

        const validTasks = SubTaskArraySchema.parse(rawData);
        
        // CYCLE DETECTION DFS (TASK-002)
        const checkCycles = (tasks: SubTask[]) => {
          const visited = new Set<string>();
          const recursionStack = new Set<string>();
          const taskMap = new Map(tasks.map(t => [t.id, t]));

          const dfs = (nodeId: string) => {
            if (recursionStack.has(nodeId)) return true;
            if (visited.has(nodeId)) return false;

            visited.add(nodeId);
            recursionStack.add(nodeId);

            const task = taskMap.get(nodeId);
            if (task && task.dependencies) {
              for (const dep of task.dependencies) {
                if (dfs(dep)) return true;
              }
            }
            recursionStack.delete(nodeId);
            return false;
          };

          for (const task of tasks) {
            if (dfs(task.id)) return true;
          }
          return false;
        };

        if (checkCycles(validTasks)) {
          throw new Error("DAG contains circular dependencies. SubTasks must form a valid acyclic graph.");
        }

        Logger.info(`[Decomposer] ✅ Schema validated successfully. Generated ${validTasks.length} DAG nodes.`);
        return validTasks;

      } catch (e: any) {
        Logger.warn(`[Decomposer] ⚠ Validation Failed on attempt ${attempt}. Injecting auto-correction.`);
        lastError = e.message;
        if (attempt >= maxRetries) {
          throw new Error(`[Decomposer] FATAL: Failed to generate valid task graph after ${maxRetries} attempts. Last error: ${lastError}`);
        }
      }
    }

    throw new Error(`[Decomposer] FATAL: Exceeded maximum retries (${maxRetries}).`);
  }
}
