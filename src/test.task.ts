import { TaskDecomposer } from './task/decomposer';
import { TaskClassifier } from './task/classifier';
import { TaskMapper } from './task/mapper';
import { Logger } from './utils';

class MockLlmAdapter {
  private decomposeCalls = 0;
  private classifyCalls = 0;

  async generateTinyPlans(userPrompt: string, systemContext: string) {
    if (systemContext.includes('decomposer')) {
      this.decomposeCalls++;
      // Attempt 1: Hallucinate bad JSON (missing dependencies array)
      if (this.decomposeCalls === 1) {
        return { status: 200, data: { tasks: [ { id: 't1', description: 'Setup repo' } ] }, retryAfter: null };
      }
      // Attempt 2: Correct JSON
      return { status: 200, data: [
        { id: 't1', description: 'Initialize the git repository', dependencies: [] },
        { id: 't2', description: 'Build daily scraper cron job', dependencies: ['t1'] }
      ], retryAfter: null };
    } 
    
    if (systemContext.includes('classifier')) {
      this.classifyCalls++;
      // Attempt 1: Hallucinate bad enum value
      if (this.classifyCalls === 1) {
        return { status: 200, data: { type: 'magic_wand' }, retryAfter: null };
      }
      // Attempt 2: Correct enum
      const t = userPrompt.includes('cron') ? 'cron' : 'cli';
      return { status: 200, data: { type: t }, retryAfter: null };
    }

    return { status: 500, data: null, retryAfter: null };
  }
}

async function main() {
  Logger.info('--- Initializing Robust Task Pipeline Test ---');
  
  const mockLlm = new MockLlmAdapter() as any;
  
  const decomposer = new TaskDecomposer(mockLlm);
  const classifier = new TaskClassifier(mockLlm);
  const mapper = new TaskMapper();

  const prompt = "I need a web app. Set up the repo, build a cron job to scrape data daily.";
  
  Logger.info('\n[1] Testing Decomposer Auto-Correct...');
  const subTasks = await decomposer.decompose(prompt);
  
  Logger.info('\n[2] Testing Classifier Auto-Correct...');
  const classified = [];
  for (const task of subTasks) {
    // Note: classifier mock hallucinated on the first call, so task t1 should trigger a retry.
    classified.push(await classifier.classify(task));
  }

  Logger.info('\n[3] Testing Mapper UUID Injection...');
  const mapped = classified.map(t => mapper.map(t));

  Logger.info('\n--- FINAL DAG ---');
  console.dir(mapped, { depth: null });
}

main().catch(console.error);
