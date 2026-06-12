import { SubTask, SubTaskArraySchema } from './types';
import { LlmAdapter } from '../core/llm.adapter';
import { Logger } from '../utils';

export class TaskDecomposer {
  constructor(private llm: LlmAdapter) {}

  async decompose(prompt: string, maxRetries = 3): Promise<SubTask[]> {
    Logger.info(`[Decomposer] Initiating robust decomposition for: "${prompt}"`);
    
    let lastError = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const systemPrompt = `You are the Mythos Decomposer, the master planner of BreakGlassWing. 
Your role is to translate high-level user requests into a Directed Acyclic Graph (DAG) of asynchronous SubTasks.

You MUST respond with a JSON array of objects. 

## The Law of the DAG
- Tasks must be hyper-focused and isolated. A WorkerAgent should be able to execute a task using ONLY the context provided in its description.
- Identify parallelization opportunities. If two files can be refactored independently, they must not depend on each other.
- The \`dependencies\` array defines execution order. Use it strictly to prevent race conditions.

## The Governor Verification Step
- Always schedule a final Verification Task at the end of the DAG. The WorkerAgent assigned to this task must run the test suite or syntax checker so the Governor can stamp the execution as safe.

Each object MUST match this schema:
{
  "id": "string", // A unique local id like task-1
  "description": "string", // Clear action to perform. Provide absolute paths and exact targets.
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
          throw new Error(`[Decomposer] FATAL: Failed to generate valid task graph after ${maxRetries} attempts. Last error: ${lastError}`, { cause: e });
        }
      }
    }

    throw new Error(`[Decomposer] FATAL: Exceeded maximum retries (${maxRetries}).`);
  }
}
