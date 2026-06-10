import { Logger } from '../utils/logger';
export class CognitiveLoop {
  async processTask(payload: any) {
    Logger.info("Processing task but forgetting to emit TASK_FAILED on error...");
    throw new Error("Broken");
  }
}