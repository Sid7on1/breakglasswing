import OpenAI from 'openai';
import { Logger } from '../utils';
import { ApiKeyManager, KeyResult } from '../credits/api.key.manager';
import { LLMProvider, Message, ChatOptions, ChatEvent } from './llm.provider';

/**
 * Streaming filter that separates <think>...</think> spans from visible content.
 * Reasoning models (MiniMax, DeepSeek, QwQ...) interleave thinking inside content;
 * without this the internal monologue leaks into the user-facing reply.
 */
export class ThinkTagFilter {
  private pending = '';
  private inThink = false;
  private static readonly OPEN = '<think>';
  private static readonly CLOSE = '</think>';

  /** Returns visible text and thinking text extracted from this token. */
  process(token: string): { text: string; thinking: string } {
    this.pending += token;
    let text = '';
    let thinking = '';

    for (;;) {
      const tag = this.inThink ? ThinkTagFilter.CLOSE : ThinkTagFilter.OPEN;
      const idx = this.pending.indexOf(tag);
      if (idx !== -1) {
        const before = this.pending.slice(0, idx);
        if (this.inThink) thinking += before; else text += before;
        this.pending = this.pending.slice(idx + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // Hold back any suffix that could be the start of the tag split across chunks
      const hold = this.partialTagSuffix(this.pending, tag);
      const emit = this.pending.slice(0, this.pending.length - hold);
      if (this.inThink) thinking += emit; else text += emit;
      this.pending = this.pending.slice(this.pending.length - hold);
      break;
    }

    return { text, thinking };
  }

  /** Flush whatever is held back (call when the stream ends). */
  flush(): { text: string; thinking: string } {
    const rest = this.pending;
    this.pending = '';
    if (this.inThink) return { text: '', thinking: rest };
    return { text: rest, thinking: '' };
  }

  private partialTagSuffix(s: string, tag: string): number {
    const max = Math.min(s.length, tag.length - 1);
    for (let len = max; len > 0; len--) {
      if (s.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }
}

/** Remove <think> spans from a complete (non-streamed) response. */
export function stripThink(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim();
}

/**
 * Pull a JSON value out of a model response that may wrap it in a markdown code
 * fence or surrounding prose (e.g. "Here's a JSON array: ```json [...] ```").
 * Returns the first balanced array/object found, or the trimmed input unchanged.
 */
export function extractJson(content: string): string {
  let s = content.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) s = fenced[1].trim();
  const start = s.search(/[[{]/);
  if (start === -1) return s;
  const open = s[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(start, i + 1);
  }
  return s.slice(start);
}

export class LlmAdapter implements LLMProvider {
  public defaultModel = process.env.BGW_MODEL || 'meta/llama-3.1-70b-instruct';
  public requestTimeout = parseInt(process.env.BGW_TIMEOUT || '120000', 10);
  public temperature: number = parseFloat(process.env.BGW_TEMPERATURE || '0.1');
  public maxTokens: number = parseInt(process.env.BGW_MAX_TOKENS || '4096', 10);
  // How long to wait for the next streamed chunk before assuming the stream stalled.
  // Configurable because slow reasoning models (minimax) can legitimately pause between
  // chunks longer than the original hardcoded 60s.
  public streamReadTimeoutMs = parseInt(process.env.BGW_STREAM_TIMEOUT_MS || '60000', 10);
  // Optional reasoning budget for thinking models (e.g. minimax). Off by default —
  // when set ('low'|'medium'|'high'), sent as reasoning_effort to trade depth for speed.
  public reasoningEffort?: string = process.env.BGW_REASONING_EFFORT || undefined;

  private budgetVeto?: any; // Will be typed as BudgetVeto but avoiding circular imports or just use any here

  constructor(private apiKeyManager: ApiKeyManager) {}

  public setBudgetVeto(budgetVeto: any) {
    this.budgetVeto = budgetVeto;
  }

  public applyConfig(cfg: { model?: string; timeout?: number; temperature?: number; maxTokens?: number; reasoningEffort?: string }) {
    if (cfg.model) this.defaultModel = cfg.model;
    if (cfg.timeout) this.requestTimeout = cfg.timeout;
    if (cfg.temperature !== undefined) this.temperature = cfg.temperature;
    if (cfg.maxTokens) this.maxTokens = cfg.maxTokens;
    if (cfg.reasoningEffort !== undefined) this.reasoningEffort = cfg.reasoningEffort || undefined;
  }

  private createClient(keyResult: KeyResult): OpenAI {
    return new OpenAI({ apiKey: keyResult.keyStr || '', baseURL: keyResult.baseURL || 'https://integrate.api.nvidia.com/v1', maxRetries: 3 });
  }

  private pickModel(keyResult: KeyResult): string {
    return keyResult.model || this.defaultModel;
  }

  private async getKey(): Promise<KeyResult> {
    const kr = await this.apiKeyManager.getNextKey();
    if (!kr.keyStr || kr.idx === null) throw new Error(`[LlmAdapter] FATAL: No API keys configured.`);
    if (kr.waitTimeSecs > 0) {
      Logger.warn(`[LlmAdapter] All keys exhausted! Sleeping ${kr.waitTimeSecs.toFixed(1)}s...`);
      await new Promise(resolve => setTimeout(resolve, kr.waitTimeSecs * 1000));
    }
    return kr;
  }

  async generateTinyPlans(userPrompt: string, systemContext: string) {
    const kr = await this.getKey();
    const client = this.createClient(kr);
    
    // Budget checking heuristics: ~100 tokens out, 50 in for tiny plans
    const estimatedTokens = 150;
    const estimatedCostUsd = (estimatedTokens / 1000) * 0.002; // Very rough estimate
    if (this.budgetVeto) {
      await this.budgetVeto.checkVeto(estimatedCostUsd);
    }
    
    try {
      const response = await client.chat.completions.create({
        model: this.pickModel(kr),
        messages: [
          { role: 'system', content: systemContext },
          { role: 'user', content: userPrompt }
        ]
      }, { timeout: this.requestTimeout });
      
      const usage = response.usage;
      if (this.budgetVeto && usage) {
        const actualCostUsd = ((usage.prompt_tokens + usage.completion_tokens) / 1000) * 0.002;
        await this.budgetVeto.recordSpend(actualCostUsd, estimatedCostUsd);
      }
      
      this.apiKeyManager.reportKeyResult(kr.idx!, 200);
      // Models often wrap the plan in a markdown fence or prose; extract the raw JSON before parsing.
      const content = extractJson(stripThink(response.choices[0].message.content || ""));
      return { status: 200, data: JSON.parse(content || "{}"), retryAfter: null };
    } catch (error: any) {
      if (this.budgetVeto) {
        await this.budgetVeto.releaseReservation(estimatedCostUsd);
      }
      Logger.error(`[LlmAdapter] Network Error: ${error.message}`);
      let status = 500;
      let retryAfter: number | null = null;
      if (error instanceof OpenAI.APIConnectionTimeoutError || error.code === 'ECONNABORTED' || error.message.includes('timeout')) status = 408;
      else if (error.status) status = error.status;
      if (error.headers?.['retry-after']) retryAfter = parseFloat(error.headers['retry-after']);
      else if (status === 429) retryAfter = 5;
      this.apiKeyManager.reportKeyResult(kr.idx!, status, retryAfter);
      return { status, data: null, retryAfter, error };
    }
  }

  async generateXmlCompletion(userPrompt: string, systemContext: string, maxTokens: number = 64) {
    const kr = await this.getKey();
    const client = this.createClient(kr);
    const estimatedCostUsd = (maxTokens / 1000) * 0.002;
    if (this.budgetVeto) await this.budgetVeto.checkVeto(estimatedCostUsd);

    try {
      const response = await client.chat.completions.create({
        model: this.pickModel(kr),
        messages: [
          { role: 'system', content: systemContext },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: maxTokens,
        temperature: 0.0
      }, { timeout: this.requestTimeout });
      this.apiKeyManager.reportKeyResult(kr.idx!, 200);
      const usage = response.usage;
      if (this.budgetVeto && usage) {
        const actualCostUsd = ((usage.prompt_tokens + usage.completion_tokens) / 1000) * 0.002;
        await this.budgetVeto.recordSpend(actualCostUsd, estimatedCostUsd);
      } else if (this.budgetVeto) {
        await this.budgetVeto.recordSpend(estimatedCostUsd, estimatedCostUsd);
      }
      return { status: 200, content: stripThink(response.choices[0].message.content || ""), retryAfter: null };
    } catch (error: any) {
      if (this.budgetVeto) await this.budgetVeto.releaseReservation(estimatedCostUsd);
      Logger.error(`[LlmAdapter] Network Error: ${error.message}`);
      let status = 500;
      if (error instanceof OpenAI.APIConnectionTimeoutError || error.code === 'ECONNABORTED' || error.message.includes('timeout')) status = 408;
      else if (error.status) status = error.status;
      this.apiKeyManager.reportKeyResult(kr.idx!, status);
      return { status, content: "", retryAfter: null, error };
    }
  }

  async generateChatResponse(messages: any[], systemContext: string) {
    const kr = await this.getKey();
    const client = this.createClient(kr);
    const estimatedTokens = this.maxTokens || 4096;
    const estimatedCostUsd = (estimatedTokens / 1000) * 0.002;
    if (this.budgetVeto) await this.budgetVeto.checkVeto(estimatedCostUsd);

    try {
      const response = await client.chat.completions.create({
        model: this.pickModel(kr),
        messages: [
          { role: 'system', content: systemContext },
          ...messages
        ],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }, { timeout: this.requestTimeout });
      this.apiKeyManager.reportKeyResult(kr.idx!, 200);
      const usage = response.usage;
      if (usage) {
        Logger.info(`[LlmAdapter] Token Usage - Prompt: ${usage.prompt_tokens} | Completion: ${usage.completion_tokens} | Total: ${usage.total_tokens}`);
        if (this.budgetVeto) {
          const actualCostUsd = ((usage.prompt_tokens + usage.completion_tokens) / 1000) * 0.002;
          await this.budgetVeto.recordSpend(actualCostUsd, estimatedCostUsd);
        }
      } else if (this.budgetVeto) {
        await this.budgetVeto.recordSpend(estimatedCostUsd, estimatedCostUsd);
      }
      return { status: 200, content: stripThink(response.choices[0].message.content || ""), retryAfter: null };
    } catch (error: any) {
      if (this.budgetVeto) await this.budgetVeto.releaseReservation(estimatedCostUsd);
      Logger.error(`[LlmAdapter] Network Error: ${error.message}`);
      let status = 500;
      if (error instanceof OpenAI.APIConnectionTimeoutError || error.code === 'ECONNABORTED' || error.message.includes('timeout')) status = 408;
      else if (error.status) status = error.status;
      this.apiKeyManager.reportKeyResult(kr.idx!, status);
      return { status, content: "", retryAfter: null, error };
    }
  }

  async generateSemanticMetadata(nodeId: string, nodeName: string, type: string, codeSnippet: string) {
    const systemContext = `You are a structural semantic analyzer. Return a JSON object with:
    - purpose (string, max 15 words)
    - criticality (string: 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    - riskScore (number: 0 to 100)
    Based on the following code snippet.`;
    const userPrompt = `Node ID: ${nodeId}\nNode Name: ${nodeName}\nType: ${type}\nCode:\n${codeSnippet}`;
    const kr = await this.getKey();
    const client = this.createClient(kr);
    const estimatedCostUsd = (200 / 1000) * 0.002;
    if (this.budgetVeto) await this.budgetVeto.checkVeto(estimatedCostUsd);

    try {
      const response = await client.chat.completions.create({
        model: this.pickModel(kr),
        messages: [
          { role: 'system', content: systemContext },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: "json_object" }
      }, { timeout: this.requestTimeout });
      this.apiKeyManager.reportKeyResult(kr.idx!, 200);
      const usage = response.usage;
      if (this.budgetVeto && usage) {
        const actualCostUsd = ((usage.prompt_tokens + usage.completion_tokens) / 1000) * 0.002;
        await this.budgetVeto.recordSpend(actualCostUsd, estimatedCostUsd);
      } else if (this.budgetVeto) {
        await this.budgetVeto.recordSpend(estimatedCostUsd, estimatedCostUsd);
      }
      return JSON.parse(stripThink(response.choices[0].message.content || "") || "{}");
    } catch (e: any) {
      if (this.budgetVeto) await this.budgetVeto.releaseReservation(estimatedCostUsd);
      this.apiKeyManager.reportKeyResult(kr.idx!, 500);
      Logger.error(`[LlmAdapter] Failed semantic analysis for ${nodeId}`);
      return null;
    }
  }

  async chatCompletion(messages: any[], systemContext?: string): Promise<string> {
    const kr = await this.getKey();
    const client = this.createClient(kr);
    const estimatedTokens = this.maxTokens || 4096;
    const estimatedCostUsd = (estimatedTokens / 1000) * 0.002;
    if (this.budgetVeto) await this.budgetVeto.checkVeto(estimatedCostUsd);

    try {
      const finalMessages = systemContext
        ? [{ role: 'system', content: systemContext }, ...messages]
        : messages;
      const response = await client.chat.completions.create({
        model: this.pickModel(kr),
        messages: finalMessages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }, { timeout: this.requestTimeout });
      this.apiKeyManager.reportKeyResult(kr.idx!, 200);
      const usage = response.usage;
      if (this.budgetVeto && usage) {
        const actualCostUsd = ((usage.prompt_tokens + usage.completion_tokens) / 1000) * 0.002;
        await this.budgetVeto.recordSpend(actualCostUsd, estimatedCostUsd);
      } else if (this.budgetVeto) {
        await this.budgetVeto.recordSpend(estimatedCostUsd, estimatedCostUsd);
      }
      return stripThink(response.choices[0].message.content || "");
    } catch (e: any) {
      if (this.budgetVeto) await this.budgetVeto.releaseReservation(estimatedCostUsd);
      this.apiKeyManager.reportKeyResult(kr.idx!, 500);
      throw e;
    }
  }

  async *generateChatResponseStream(
    messages: any[],
    systemContext?: string,
  ): AsyncGenerator<string> {
    const kr = await this.getKey();
    const client = this.createClient(kr);
    const estimatedTokens = this.maxTokens || 4096;
    const estimatedCostUsd = (estimatedTokens / 1000) * 0.002;
    if (this.budgetVeto) await this.budgetVeto.checkVeto(estimatedCostUsd);

    try {
      const finalMessages = systemContext
        ? [{ role: 'system', content: systemContext }, ...messages]
        : messages;
      const stream = await client.chat.completions.create({
        model: this.pickModel(kr),
        messages: finalMessages,
        stream: true,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }, { timeout: this.requestTimeout });
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) yield token;
      }
      if (this.budgetVeto) await this.budgetVeto.recordSpend(estimatedCostUsd, estimatedCostUsd);
      this.apiKeyManager.reportKeyResult(kr.idx!, 200);
    } catch (e: any) {
      if (this.budgetVeto) await this.budgetVeto.releaseReservation(estimatedCostUsd);
      let status = 500;
      if (e instanceof OpenAI.APIConnectionTimeoutError || e.code === 'ECONNABORTED' || e.message.includes('timeout')) status = 408;
      else if (e.status) status = e.status;
      this.apiKeyManager.reportKeyResult(kr.idx!, status);
      throw e;
    }
  }

  async *chat(messages: Message[], options: ChatOptions): AsyncGenerator<ChatEvent> {
    const kr = await this.getKey();
    const client = this.createClient(kr);
    const estimatedTokens = options.maxTokens || this.maxTokens || 4096;
    const estimatedCostUsd = (estimatedTokens / 1000) * 0.002;
    if (this.budgetVeto) await this.budgetVeto.checkVeto(estimatedCostUsd);
    // Declared outside the try so the catch can tell whether the reservation was
    // already settled by a mid-stream usage report — otherwise an error after the
    // usage chunk would release the same reservation twice (under-counting spend).
    let usageRecorded = false;

    try {
      const finalMessages: any[] = options.system
        ? [{ role: 'system', content: options.system }, ...messages]
        : messages;

      const requestOptions: any = {
        model: this.pickModel(kr),
        messages: finalMessages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: options.temperature ?? this.temperature,
        max_tokens: options.maxTokens ?? this.maxTokens,
      };

      if (options.tools && options.tools.length > 0) {
        requestOptions.tools = options.tools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema || t.parameters
          }
        }));
        requestOptions.tool_choice = 'auto';
      }

      // Optional reasoning budget — only sent when explicitly configured, so default
      // behavior is unchanged. Lets thinking models (minimax) trade depth for speed.
      const effort = options.reasoningEffort ?? this.reasoningEffort;
      if (effort) requestOptions.reasoning_effort = effort;

      const stream: any = await client.chat.completions.create(requestOptions, { timeout: this.requestTimeout, signal: options.signal as any });

      let activeToolCallId = '';
      let activeToolName = '';
      let activeToolArgs = '';
      const thinkFilter = new ThinkTagFilter();

      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const nextPromise = iterator.next();
        // Guard against a silently stalled stream. The timer MUST be cleared once the
        // chunk arrives, or every chunk leaks a 60s timer (and a later unhandled
        // rejection) — a long reasoning stream would spawn hundreds of them.
        let timeoutHandle: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<any>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`Stream read timeout: no data from the API for ${Math.round(this.streamReadTimeoutMs / 1000)}s (check provider status / API key)`)), this.streamReadTimeoutMs);
        });

        let result: any;
        try {
          result = await Promise.race([nextPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutHandle!);
        }
        if (result.done) break;

        const chunk = result.value;

        // Reasoning channel (MiniMax/DeepSeek-style): never surface as the reply
        const reasoning = chunk.choices[0]?.delta?.reasoning_content;
        if (reasoning) {
          yield { type: 'thinking', text: reasoning };
        }

        // Yield tokens, with inline <think> spans diverted to the thinking channel
        const token = chunk.choices[0]?.delta?.content;
        if (token) {
          const { text, thinking } = thinkFilter.process(token);
          if (thinking) yield { type: 'thinking', text: thinking };
          if (text) yield { type: 'token', text };
        }

        // Handle tool calls streaming
        const toolCalls = chunk.choices[0]?.delta?.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            if (tc.id) {
              // Yield previous tool call if any
              if (activeToolCallId) {
                yield { type: 'tool_call', id: activeToolCallId, name: activeToolName, args: activeToolArgs };
              }
              activeToolCallId = tc.id;
              activeToolName = tc.function?.name || '';
              activeToolArgs = tc.function?.arguments || '';
            } else if (tc.function?.arguments) {
              activeToolArgs += tc.function.arguments;
            }
          }
        }
        
        // Handle usage if present in the stream (requires stream_options in some models).
        // Guard against a provider sending more than one usage chunk: record once, or
        // the reservation would be released repeatedly.
        if (chunk.usage && !usageRecorded) {
          yield { type: 'usage', prompt: chunk.usage.prompt_tokens, completion: chunk.usage.completion_tokens };
          if (this.budgetVeto) {
            const actualCostUsd = ((chunk.usage.prompt_tokens + chunk.usage.completion_tokens) / 1000) * 0.002;
            await this.budgetVeto.recordSpend(actualCostUsd, estimatedCostUsd);
          }
          usageRecorded = true;
        }
      }

      // Flush any text held back by the think-tag filter
      const tail = thinkFilter.flush();
      if (tail.thinking) yield { type: 'thinking', text: tail.thinking };
      if (tail.text) yield { type: 'token', text: tail.text };

      // Yield the final tool call
      if (activeToolCallId) {
        yield { type: 'tool_call', id: activeToolCallId, name: activeToolName, args: activeToolArgs };
      }

      yield { type: 'done' };

      // Only fall back to the estimate if the stream never reported real usage,
      // otherwise we would double-count the spend already recorded above.
      if (this.budgetVeto && !usageRecorded) {
        await this.budgetVeto.recordSpend(estimatedCostUsd, estimatedCostUsd); // Rough fallback
      }
      this.apiKeyManager.reportKeyResult(kr.idx!, 200);
      
    } catch (e: any) {
      // Only release if a mid-stream usage report hasn't already settled the
      // reservation, otherwise we would release it a second time.
      if (this.budgetVeto && !usageRecorded) await this.budgetVeto.releaseReservation(estimatedCostUsd);
      let status = 500;
      let recoverable = false;
      
      if (e instanceof OpenAI.APIConnectionTimeoutError || e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
        status = 408;
      } else if (e.status) {
        status = e.status;
      }
      
      // If context length exceeded, we can compact and retry
      if (e.message?.includes('maximum context length') || e.code === 'context_length_exceeded' || status === 413) {
        recoverable = true;
      }
      
      this.apiKeyManager.reportKeyResult(kr.idx!, status);
      yield { type: 'error', message: e.message, recoverable };
    }
  }
}
