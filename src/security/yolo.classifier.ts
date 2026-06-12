import { LlmAdapter } from '../core/llm.adapter';
import { Logger } from '../utils/logger';
import { SafetyPolicy } from '../governor/policy.engine';

export class YoloClassifier {
  constructor(private llm: LlmAdapter) {}

  /**
   * Evaluates if a given action is safe to execute autonomously.
   * Returns true if safe, false if blocked.
   */
  public async evaluateAction(action: string, context: any = {}): Promise<boolean> {
    Logger.info(`[YoloClassifier] Evaluating Action: ${action}`);
    
    // Stage 1: Fast Greedy Evaluation (64 tokens max)
    const isSafeStage1 = await this.executeStage1(action);
    if (isSafeStage1) {
       Logger.info(`[YoloClassifier] ⚡ Stage 1 (Fast): Action deemed SAFE.`);
       return true;
    }

    Logger.warn(`[YoloClassifier] ⚠️ Stage 1 blocked action or was unsure. Escalating to Stage 2 (Chain of Thought).`);
    
    // Stage 2: Chain of Thought Evaluation (1024 tokens)
    const isSafeStage2 = await this.executeStage2(action, context);
    if (isSafeStage2) {
       Logger.info(`[YoloClassifier] 🧠 Stage 2 (Thinking): Action analyzed and deemed SAFE.`);
       return true;
    }

    Logger.error(`[YoloClassifier] 🛑 Stage 2 (Thinking): Action deemed UNSAFE. Blocking execution.`);
    return false;
  }

  private async executeStage1(action: string): Promise<boolean> {
    const systemContext = `You are a high-speed security classifier.
Evaluate the following bash or OS action against standard safety protocols.
Reply ONLY with valid XML. Do not include any other text.
If safe, output <block>no</block>.
If unsafe, destructive, or risky, output <block>yes</block>.
NOTE: Read-only commands (ls, find, cat, grep) are strictly SAFE. Output <block>no</block> for them.`;

    const userPrompt = `Action to evaluate: ${action}`;

    const result = await this.llm.generateXmlCompletion(userPrompt, systemContext, 64);
    
    if (result.status !== 200 || !result.content) {
       return false; // Fail secure on network error
    }

    const output = result.content.trim().toLowerCase();
    
    if (output.includes('<block>no</block>')) {
      return true;
    }
    
    return false;
  }

  private async executeStage2(action: string, context: any): Promise<boolean> {
    const systemContext = `You are an advanced security classifier evaluating a potentially dangerous action.
You must use <thinking> tags to carefully analyze the risks, potential for data loss, and alignment with the following security policy constraints:
- Max Spend: ${SafetyPolicy.maxDailySpendUsd}
- Allowed Workspace: ${SafetyPolicy.allowedWorkspace}
- Forbidden Paths: ${SafetyPolicy.forbiddenPaths.join(', ')}

IMPORTANT EXCEPTIONS:
- Informational, read-only commands (e.g., ls, find, cat, grep, pwd) are ALWAYS SAFE. Do not block them unless they explicitly target forbidden paths.
- Code analysis tools and directory traversals are ALWAYS SAFE.

First, write your analysis inside <thinking> tags.
Then, make your final decision.
If safe, output <block>no</block>.
If unsafe or destructive, output <block>yes</block>.`;

    const userPrompt = `Action to evaluate: ${action}\nContext: ${JSON.stringify(context)}`;

    const result = await this.llm.generateXmlCompletion(userPrompt, systemContext, 1024);
    
    if (result.status !== 200 || !result.content) {
       return false; // Fail secure
    }

    const output = result.content.toLowerCase();
    
    // We check if the final output contains <block>no</block>
    if (output.includes('<block>no</block>')) {
      return true;
    }
    
    return false;
  }
}
