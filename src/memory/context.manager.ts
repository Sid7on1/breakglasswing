import { LLMProvider, Message } from '../core/llm.provider';
import { encode } from 'gpt-tokenizer';
import { Logger } from '../utils/logger';

export class ContextManager {
  private readonly MAX_TOKENS: number;
  private readonly COMPACT_THRESHOLD = 0.7; // Compact when reaching 70% of max window
  private currentTokens: number = 0;

  constructor(private llm: LLMProvider, maxTokens: number = 60000) {
    this.MAX_TOKENS = maxTokens;
  }

  /**
   * Called by the AgentLoop when the LLM returns token usage
   */
  updateTokens(promptTokens: number) {
    this.currentTokens = promptTokens;
  }

  /**
   * Checks token limits and compacts messages if necessary
   */
  async checkAndCompact(messages: Message[]): Promise<Message[]> {
    const estimated = this.currentTokens || this.estimateTokens(messages);
    
    if (estimated / this.MAX_TOKENS > this.COMPACT_THRESHOLD) {
      Logger.warn(`[ContextManager] Context at ${Math.round((estimated / this.MAX_TOKENS) * 100)}% capacity (${estimated} tokens). Compacting...`);
      return await this.compact(messages);
    }
    
    return messages;
  }

  /**
   * A `tool` message is only valid immediately after the assistant `tool_calls`
   * that produced it. When a compaction window starts partway through a tool
   * exchange, the leading `tool` messages are orphaned and the API rejects the
   * request — so drop them until the window begins on a user/assistant message.
   */
  private dropLeadingOrphanToolMessages(messages: Message[]): Message[] {
    let start = 0;
    while (start < messages.length && messages[start].role === 'tool') start++;
    return messages.slice(start);
  }

  private estimateTokens(messages: Message[]): number {
    try {
      const text = messages.map(m => m.content).join('\n');
      return encode(text).length;
    } catch {
      // Fallback
      return Math.ceil(JSON.stringify(messages).length / 4);
    }
  }

  /**
   * Compacts the message history by summarizing older messages
   */
  async compact(messages: Message[]): Promise<Message[]> {
    const systemMessages = messages.filter(m => m.role === 'system');

    // Preserve the last 15 messages (recent context, tool calls, results). Trim any
    // leading orphan tool results so the window can't begin with a `tool` message
    // whose parent assistant tool_calls was cut — the API rejects that pairing.
    const recentMessages = this.dropLeadingOrphanToolMessages(
      messages.filter(m => m.role !== 'system').slice(-15)
    );

    // Identify messages to summarize (anything not kept, including trimmed orphans)
    const olderMessages = messages.filter(m =>
      m.role !== 'system' && !recentMessages.includes(m)
    );

    if (olderMessages.length === 0) {
      return messages; 
    }

    Logger.info(`[ContextManager] Summarizing ${olderMessages.length} older messages...`);

    const summaryPrompt: Message[] = [
      { role: 'system', content: 'You are an AI tasked with summarizing a long conversation history. Extract the key context, tools used, results, and what has been accomplished so far. Be extremely concise. Keep important paths and error details.' },
      { role: 'user', content: `Please summarize these older messages:\n${JSON.stringify(olderMessages)}` }
    ];

    let summaryText = '';
    try {
      const generator = this.llm.chat(summaryPrompt, {});
      for await (const event of generator) {
        if (event.type === 'token') summaryText += event.text;
      }
    } catch (e: any) {
      Logger.error(`[ContextManager] Failed to summarize context: ${e.message}`);
      summaryText = '[Older conversation history dropped due to context limits]';
    }

    const summaryMsg: Message = { 
      role: 'system', 
      content: `[Previous Context Summary]\n${summaryText}` 
    };

    const compacted = [...systemMessages, summaryMsg, ...recentMessages];
    
    this.currentTokens = this.estimateTokens(compacted);
    
    return compacted;
  }

  /**
   * More aggressively compacts when an API limit is hit
   */
  async reactiveCompact(messages: Message[], error: any): Promise<Message[]> {
    if (error?.message?.includes('too long') || error?.code === 'prompt_too_long' || error?.message?.includes('maximum context length')) {
      Logger.warn(`[ContextManager] Reactive compact triggered by API error: ${error.message}`);
      // Cut window more aggressively
      this.currentTokens = this.MAX_TOKENS; // force it
      const systemMessages = messages.filter(m => m.role === 'system');
      // Keep last 5 instead of 15, but never begin on an orphaned tool result.
      const recentMessages = this.dropLeadingOrphanToolMessages(
        messages.filter(m => m.role !== 'system').slice(-5)
      );

      const compacted = [...systemMessages, { role: 'system', content: '[Older messages aggressively compacted due to API context limits]' } as Message, ...recentMessages];
      return compacted;
    }
    throw error;
  }
}
