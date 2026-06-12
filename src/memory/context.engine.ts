import { ShortTermMemory } from './short.term';
import { LongTermMemory } from './long.term';
import { Logger } from '../utils';

export class ContextEngine {
  private readonly MAX_TOKENS = 4000;
  private readonly CHARS_PER_TOKEN = 4; // Rough heuristic

  constructor(
    private shortTerm: ShortTermMemory,
    private longTerm: LongTermMemory
  ) {}

  /**
   * The master filter. Constructs the final prompt by injecting
   * immediate conversation context AND historical vector-searched solutions,
   * completely protected by a strict token budget optimizer.
   */
  async buildContextAwarePrompt(currentTask: string): Promise<string> {
    Logger.info(`\n[ContextEngine] Assembling unified memory context...`);
    
    // 1. Query Long-Term Memory (Semantic Search)
    const historicalSolutions = await this.longTerm.recallSimilarBugs(currentTask);
    let longTermStr = 'No relevant historical solutions found.';
    
    if (historicalSolutions.length > 0) {
      longTermStr = historicalSolutions.join('\n\n---\n\n');
      Logger.info(`[ContextEngine] Retreived ${historicalSolutions.length} highly-relevant historical memories.`);
    }

    // 2. Budget Calculation
    const taskTokens = Math.ceil(currentTask.length / this.CHARS_PER_TOKEN);
    const ltTokens = Math.ceil(longTermStr.length / this.CHARS_PER_TOKEN);
    const fixedPromptTokens = 100; // The structural text
    
    const availableTokensForShortTerm = this.MAX_TOKENS - (taskTokens + ltTokens + fixedPromptTokens);
    
    // 3. Slice Short-Term Context to fit budget
    const recentMessages = this.shortTerm.getRecentContext(50);
    let shortTermTokens = 0;
    const allowedMessages = [];

    // Traverse from newest to oldest
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      const msgStr = `[${msg.role.toUpperCase()}]: ${msg.content}\n`;
      const tokens = Math.ceil(msgStr.length / this.CHARS_PER_TOKEN);
      
      if (shortTermTokens + tokens > availableTokensForShortTerm) {
        Logger.warn(`[ContextEngine] Context firewall triggered! Truncating older messages to protect LLM (Max: ${this.MAX_TOKENS} tokens).`);
        break; // Budget exhausted
      }
      
      shortTermTokens += tokens;
      allowedMessages.unshift(msgStr); // Prepend to maintain chronological order
    }

    const shortTermStr = allowedMessages.length > 0 
      ? allowedMessages.join('') 
      : 'No recent context fits in budget.';

    // 4. Assemble Final Payload
    return `
=== SYSTEM PROMPT ===
You are an advanced agent. Solve the current task using the context below.

=== HISTORICAL SOLUTIONS (Long-Term Memory) ===
${longTermStr}

=== RECENT CONVERSATION (Short-Term Memory) ===
${shortTermStr}

=== CURRENT TASK ===
${currentTask}
`;
  }
}
