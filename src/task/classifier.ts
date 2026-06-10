import { SubTask, ClassifiedTask, ClassifiedTaskSchema, TaskTypeEnum } from './types';
import { LlmAdapter } from '../core/llm.adapter';
import { Logger } from '../utils';

export class TaskClassifier {
  constructor(private llm: LlmAdapter) {}

  async classify(task: SubTask, maxRetries = 3): Promise<ClassifiedTask> {
    Logger.info(`[Classifier] Classifying node: ${task.id}`);
    
    let lastError = "";

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const systemPrompt = `You are a strict task classifier. Analyze the following task description and classify it into exactly ONE of these types:
"trigger", "cron", "webhook", "cli", "agent"

Respond with a JSON object:
{ "type": "the_type" }

${lastError ? `\nWARNING: Your previous attempt failed validation. Fix this error:\n${lastError}` : ''}`;

      const result = await this.llm.generateTinyPlans(task.description, systemPrompt);

      if (result.status !== 200 || !result.data) {
        await new Promise(r => setTimeout(r, (result.retryAfter || 2) * 1000));
        continue;
      }

      try {
        if (!result.data.type) throw new Error("Missing 'type' field in JSON response.");
        
        const typeValue = TaskTypeEnum.parse(result.data.type);

        const classifiedTask: ClassifiedTask = {
          ...task,
          type: typeValue,
          metadata: { classifiedAt: Date.now() }
        };

        // Final sanity check
        ClassifiedTaskSchema.parse(classifiedTask);

        Logger.info(`[Classifier] ✅ Node ${task.id} classified as [${typeValue}]`);
        return classifiedTask;

      } catch (e: any) {
        Logger.warn(`[Classifier] ⚠ Classification failed. Auto-correcting...`);
        lastError = e.message;
      }
    }

    throw new Error(`[Classifier] FATAL: Failed to classify task ${task.id}.`);
  }
}
