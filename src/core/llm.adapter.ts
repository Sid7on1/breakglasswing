import OpenAI from 'openai';
import { Logger } from '../utils';
import { ApiKeyManager, KeyResult } from '../credits/api.key.manager';
import { LLMProvider, Message, ChatOptions, ChatEvent } from './llm.provider';
import { capabilitiesFor, ModelCapabilities, anthropicBetaHeaders } from './capabilities';

/**
 * Mark a chat message's content as a prompt-cache breakpoint (Anthropic `cache_control`,
 * forwarded by OpenRouter / native Anthropic / Bedrock for Claude models). Converts the plain
 * string content into the single-text-part array form the cache marker requires. Pure; only ever
 * called when the active model advertises `promptCaching`, so non-capable models keep plain
 * string content untouched. Returns a NEW message (no mutation of the caller's array).
 */
export function markCacheBreakpoint(msg: any): any {
  if (!msg || typeof msg.content !== 'string' || msg.content.length === 0) return msg;
  return {
    ...msg,
    content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
  };
}

/**
 * Classify an error thrown while streaming a chat completion so the agent loop knows
 * whether — and how — to recover. Pure (no side effects) so it can be unit-tested.
 *
 * - `context`  : the prompt overflowed the model window → compact and retry.
 * - `transient`: a stalled/timed-out stream, a 5xx, or the provider rejecting a single
 *   bad model emission (malformed tool-call JSON, multiple tool calls, out-of-range arg).
 *   A fresh attempt (new key, re-sampled output) almost always succeeds.
 * - otherwise  : fatal (auth, malformed request, …) — surface and stop.
 */
export function classifyStreamError(e: any): { status: number; recoverable: boolean; kind?: 'context' | 'transient' } {
  const msg = String(e?.message ?? '');
  let status = 500;
  if (e instanceof OpenAI.APIConnectionTimeoutError || e?.code === 'ECONNABORTED' || /timeout/i.test(msg)) {
    status = 408;
  } else if (e?.status) {
    status = e.status;
  }

  // Context overflow: recoverable by compaction.
  if (/maximum context length/i.test(msg) || e?.code === 'context_length_exceeded' || status === 413) {
    return { status, recoverable: true, kind: 'context' };
  }

  // Transient: stalled streams, server errors, or a one-off bad model emission the
  // provider rejected. Bounded by the loop's retry cap, so this can be liberal.
  const transientMsg = /Unterminated string|Expecting value|is out of range|single tool-call|tool call/i.test(msg);
  if (status === 408 || status >= 500 || transientMsg) {
    return { status, recoverable: true, kind: 'transient' };
  }

  return { status, recoverable: false };
}

/**
 * Streaming filter that separates <think>...</think> spans from visible content.
 * Reasoning models (MiniMax, DeepSeek, step-3.5, QwQ...) interleave thinking inside the
 * content channel; without this the internal monologue leaks into the user-facing reply.
 *
 * Two emission shapes are handled:
 *  - Paired:   `<think>reasoning</think>answer` — divert the span between the tags.
 *  - Opener-less: `reasoning</think>answer` — several models (step-3.5, minimax on NIM)
 *    emit the reasoning first and ONLY a closing tag. The old filter, looking for `<think>`
 *    first, treated all the reasoning as the answer and leaked it. So in "implicit" mode the
 *    filter buffers leading content silently until it can tell which it is: a `</think>`
 *    proves the buffer was reasoning (divert it); the stream ending with no closer proves it
 *    was the answer (emit it). This never leaks reasoning, at the cost of the answer from a
 *    NON-reasoning model arriving in one burst at stream end — acceptable since the product's
 *    default models are reasoning models; disable with implicit=false for plain models.
 */
export class ThinkTagFilter {
  private pending = '';
  private inThink = false;
  private seenOpen = false; // a real <think> opener has appeared this turn
  private decided = false;  // leading region resolved → subsequent content streams visibly
  private preamble = '';    // leading content held back while still tentative (implicit mode)
  private static readonly OPEN = '<think>';
  private static readonly CLOSE = '</think>';

  constructor(private implicit: boolean = true) {}

  /** Returns visible text and thinking text extracted from this token. */
  process(token: string): { text: string; thinking: string } {
    this.pending += token;
    let text = '';
    let thinking = '';

    for (;;) {
      if (this.inThink) {
        const idx = this.pending.indexOf(ThinkTagFilter.CLOSE);
        if (idx !== -1) {
          thinking += this.pending.slice(0, idx);
          this.pending = this.pending.slice(idx + ThinkTagFilter.CLOSE.length);
          this.inThink = false;
          this.decided = true;
          continue;
        }
        const hold = this.partialTagSuffix(this.pending, ThinkTagFilter.CLOSE);
        thinking += this.pending.slice(0, this.pending.length - hold);
        this.pending = this.pending.slice(this.pending.length - hold);
        break;
      }

      const openIdx = this.pending.indexOf(ThinkTagFilter.OPEN);

      // Tentative leading region (implicit mode, before any tag): could be opener-less
      // reasoning or just the answer. Resolve only on a definite signal.
      if (this.implicit && !this.seenOpen && !this.decided) {
        const closeIdx = this.pending.indexOf(ThinkTagFilter.CLOSE);
        if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
          // Opener-less closer: everything buffered + up to the tag was reasoning.
          thinking += this.preamble + this.pending.slice(0, closeIdx);
          this.preamble = '';
          this.pending = this.pending.slice(closeIdx + ThinkTagFilter.CLOSE.length);
          this.seenOpen = true;
          this.decided = true;
          continue;
        }
        if (openIdx !== -1) {
          // A real opener: the buffered preamble was answer text preceding an explicit block.
          text += this.preamble + this.pending.slice(0, openIdx);
          this.preamble = '';
          this.pending = this.pending.slice(openIdx + ThinkTagFilter.OPEN.length);
          this.inThink = true;
          this.seenOpen = true;
          this.decided = true;
          continue;
        }
        // No full tag yet — buffer, holding back any suffix that could be a split tag.
        const hold = Math.max(
          this.partialTagSuffix(this.pending, ThinkTagFilter.OPEN),
          this.partialTagSuffix(this.pending, ThinkTagFilter.CLOSE),
        );
        this.preamble += this.pending.slice(0, this.pending.length - hold);
        this.pending = this.pending.slice(this.pending.length - hold);
        break;
      }

      // Visible streaming region: emit text, but a new <think> block may still open.
      if (openIdx !== -1) {
        text += this.pending.slice(0, openIdx);
        this.pending = this.pending.slice(openIdx + ThinkTagFilter.OPEN.length);
        this.inThink = true;
        this.seenOpen = true;
        continue;
      }
      const hold = this.partialTagSuffix(this.pending, ThinkTagFilter.OPEN);
      text += this.pending.slice(0, this.pending.length - hold);
      this.pending = this.pending.slice(this.pending.length - hold);
      break;
    }

    return { text, thinking };
  }

  /** Flush whatever is held back (call when the stream ends). */
  flush(): { text: string; thinking: string } {
    const rest = this.pending;
    this.pending = '';
    if (this.inThink) return { text: '', thinking: this.preamble + rest };
    // Tentative buffer never resolved → the stream had no closing tag, so the leading
    // region was the answer all along. Emit it as visible text.
    if (!this.decided && this.preamble) {
      const t = this.preamble + rest;
      this.preamble = '';
      return { text: t, thinking: '' };
    }
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
  // Nucleus sampling cap. Clipping the low-probability tail is what actually curbs the
  // "dropped a tool argument / fabricated a path" failures on reasoning models — far more
  // than lowering temperature, which on a tuned MoE just pushes it off-distribution. Default
  // 0.95 (minimax model card + opencode's provider/transform.ts).
  public topP: number = parseFloat(process.env.BGW_TOP_P || '0.95');
  public maxTokens: number = parseInt(process.env.BGW_MAX_TOKENS || '4096', 10);
  // Inter-chunk stall timeout: how long to wait for the NEXT streamed chunk once the stream
  // is already flowing, before assuming it stalled.
  public streamReadTimeoutMs = parseInt(process.env.BGW_STREAM_TIMEOUT_MS || '60000', 10);
  // Time-to-first-token budget. Cold starts on slow reasoning models (minimax) routinely run
  // 60–90s before the first token while later chunks arrive quickly, so the first chunk gets a
  // longer budget than the inter-chunk one — a real cold start isn't killed as a "stall," but a
  // genuinely dead stream is still caught.
  public firstChunkTimeoutMs = parseInt(process.env.BGW_FIRST_CHUNK_TIMEOUT_MS || '120000', 10);
  // Optional reasoning budget for thinking models (e.g. minimax). Off by default —
  // when set ('low'|'medium'|'high'), sent as reasoning_effort to trade depth for speed.
  public reasoningEffort?: string = process.env.BGW_REASONING_EFFORT || undefined;
  // Handle opener-less reasoning (`reasoning</think>answer`, no leading <think>) by buffering
  // leading content until a closer proves it was thinking. On for the default reasoning models;
  // set BGW_IMPLICIT_THINK=false for plain models so their answers stream token-by-token.
  public implicitThink: boolean = process.env.BGW_IMPLICIT_THINK !== 'false';
  // Allow the model to emit several tool calls in ONE turn (batched reads/greps run concurrently in
  // the loop → far faster investigation). Default ON; disable for backends that reject multi-tool
  // turns (e.g. NVIDIA NIM) via config or BGW_PARALLEL_TOOL_CALLS=false.
  public parallelToolCalls: boolean = process.env.BGW_PARALLEL_TOOL_CALLS !== 'false';
  // The LITE model — used for cheap auxiliary calls (history summaries, self-critic, ask-user
  // auto-decisions). Falls back to the main (coding) model when unset. Set via /model lite.
  public liteModel?: string = process.env.BGW_LITE_MODEL || undefined;
  // The model the user EXPLICITLY chose (config.model / /model). Takes precedence over a key's
  // provider-default model so the picker actually changes the model. Unset = use the key/default.
  public userModel?: string = process.env.BGW_MODEL || undefined;

  private budgetVeto?: any; // Will be typed as BudgetVeto but avoiding circular imports or just use any here

  constructor(private apiKeyManager: ApiKeyManager) {}

  public setBudgetVeto(budgetVeto: any) {
    this.budgetVeto = budgetVeto;
  }

  public applyConfig(cfg: { model?: string; timeout?: number; temperature?: number; topP?: number; maxTokens?: number; reasoningEffort?: string; parallelToolCalls?: boolean; liteModel?: string }) {
    if (cfg.model) { this.defaultModel = cfg.model; this.userModel = cfg.model; }
    if (cfg.timeout) this.requestTimeout = cfg.timeout;
    if (cfg.temperature !== undefined) this.temperature = cfg.temperature;
    if (cfg.topP !== undefined) this.topP = cfg.topP;
    if (cfg.maxTokens) this.maxTokens = cfg.maxTokens;
    if (cfg.reasoningEffort !== undefined) this.reasoningEffort = cfg.reasoningEffort || undefined;
    if (cfg.parallelToolCalls !== undefined) this.parallelToolCalls = cfg.parallelToolCalls;
    if (cfg.liteModel !== undefined) this.liteModel = cfg.liteModel || undefined;
  }

  // Reuse one OpenAI client per (baseURL, key) instead of constructing a fresh one — with its own
  // connection pool — on every request. Keep-alive then survives across calls (faster, fewer TLS
  // handshakes). Per-request options like timeout are still passed at call time, so this is safe.
  private clientCache = new Map<string, OpenAI>();
  private createClient(keyResult: KeyResult): OpenAI {
    const apiKey = keyResult.keyStr || '';
    const baseURL = keyResult.baseURL || 'https://integrate.api.nvidia.com/v1';
    const cacheKey = `${baseURL} ${apiKey}`;
    let client = this.clientCache.get(cacheKey);
    if (!client) {
      client = new OpenAI({ apiKey, baseURL, maxRetries: 3 });
      this.clientCache.set(cacheKey, client);
    }
    return client;
  }

  /**
   * Resolve the sampling regime for a model. Reasoning MoE models are tuned for a specific
   * temperature/top_p and go pathological off it: minimax's own model card specifies
   * temperature 1.0 + top_p 0.95, and a blanket 0.7-with-no-top_p (the prior default) measurably
   * increased dropped tool arguments, fabricated paths, and run-to-run variance. So minimax is
   * pinned to its recommended regime; everything else uses the configured temperature. In all
   * cases we apply the top_p tail-clip, which is the real lever against those failures. An
   * explicit per-call `temperature` (e.g. the deterministic aux callers) always wins. Mirrors
   * opencode's provider/transform.ts.
   */
  public resolveSampling(model: string, override?: number): { temperature: number; top_p: number } {
    const id = (model || '').toLowerCase();
    if (id.includes('minimax')) return { temperature: override ?? 1.0, top_p: this.topP };
    return { temperature: override ?? this.temperature, top_p: this.topP };
  }

  private pickModel(keyResult: KeyResult, lite?: boolean): string {
    if (lite && this.liteModel) return this.liteModel;
    // The user's explicit choice (set via /model → applyConfig) must win. Previously the key's
    // baked-in provider default (keyResult.model) shadowed it, so /model appeared to do nothing.
    return this.userModel || keyResult.model || this.defaultModel;
  }

  /**
   * Resolve the capability descriptor for the model THIS call will actually use. Critically this
   * keys off `pickModel(...)`, not a global env var: a key-pool can map different keys to
   * different models (`<ENV>_MODEL_<n>`), so the model a call lands on — and thus what it
   * supports — is only known per-call. Conservative FLOOR for anything unrecognised, so a model
   * the table doesn't know behaves exactly as before the capability layer existed.
   */
  public capabilitiesForKey(keyResult: KeyResult, lite?: boolean): ModelCapabilities {
    return capabilitiesFor(keyResult.provider, this.pickModel(keyResult, lite));
  }

  /** Best-effort capabilities for the currently-configured model — for UI/status surfacing. */
  public async activeCapabilities(lite?: boolean): Promise<ModelCapabilities> {
    const model = this.userModel || this.defaultModel;
    if (lite && this.liteModel) return capabilitiesFor(undefined, this.liteModel);
    return capabilitiesFor(undefined, model);
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
      // Native fast-path: a model with constrained-output support is told to emit a JSON object,
      // so the plan comes back well-formed instead of wrapped in prose/fences. `extractJson` below
      // remains the universal fallback (and handles models that ignore the hint), so floor models —
      // for whom this field is omitted — are unaffected.
      const planReq: any = {
        model: this.pickModel(kr),
        messages: [
          { role: 'system', content: systemContext },
          { role: 'user', content: userPrompt }
        ]
      };
      if (this.capabilitiesForKey(kr).structuredOutputs) {
        planReq.response_format = { type: 'json_object' };
      }
      const response = await client.chat.completions.create(planReq, { timeout: this.requestTimeout });

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

  async chatCompletion(messages: any[], systemContext?: string, opts?: { lite?: boolean }): Promise<string> {
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
        model: this.pickModel(kr, opts?.lite),
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
      const caps = this.capabilitiesForKey(kr, options.lite);

      let finalMessages: any[] = options.system
        ? [{ role: 'system', content: options.system }, ...messages]
        : messages;

      // Native fast-path: prompt caching. When the active model supports Anthropic `cache_control`
      // (Claude, via OpenRouter/native/Bedrock), mark the large stable system prompt as a cache
      // breakpoint so repeated turns in a session re-bill it at the cheap cached rate. For every
      // other model this branch is skipped and messages stay as plain strings (FLOOR = unchanged).
      // BiMax's universal answer to the same problem is the graph-native context engine (send less),
      // which runs regardless — caching simply stacks on top when the model can do it.
      if (caps.promptCaching && options.system && finalMessages.length > 0) {
        finalMessages = [markCacheBreakpoint(finalMessages[0]), ...finalMessages.slice(1)];
      }

      const model = this.pickModel(kr, options.lite);
      const sampling = this.resolveSampling(model, options.temperature);
      const requestOptions: any = {
        model,
        messages: finalMessages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: sampling.temperature,
        top_p: sampling.top_p,
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
        // NVIDIA NIM and several other OpenAI-compatible backends reject any
        // assistant turn that emits more than one tool call ("This model only
        // supports single tool-calls at once!"), which hard-aborts the task.
        // The agent loop already executes tool calls sequentially, so constrain
        // the model to one call per turn by default. Opt back in with
        // BGW_PARALLEL_TOOL_CALLS=true for providers that support it.
        // Default ON now (batched tool calls = faster). Only constrain to single-call for backends
        // that reject multi-tool turns, via config / BGW_PARALLEL_TOOL_CALLS=false.
        if (!this.parallelToolCalls) {
          requestOptions.parallel_tool_calls = false;
        }
      }

      // Optional reasoning budget — only sent when explicitly configured, so default
      // behavior is unchanged. Lets thinking models (minimax) trade depth for speed.
      // Only send reasoning_effort to a model that advertises the knob — several backends 400 on an
      // unknown sampling field. Reasoning models (o-series, deepseek-r1, minimax) are flagged in the
      // table; unknowns can opt in with BGW_CAP_REASONING_EFFORT=true.
      const effort = options.reasoningEffort ?? this.reasoningEffort;
      if (effort && caps.reasoningEffortKnob) requestOptions.reasoning_effort = effort;

      // C6 — Anthropic beta-header features (1M context, token-efficient tools, interleaved
      // thinking). Host-gated to the genuine Anthropic endpoint and opt-in via BGW_ANTHROPIC_BETA,
      // so on every other backend (the default) this is undefined and the request is unchanged.
      const requestInit: any = { timeout: this.requestTimeout, signal: options.signal as any };
      const betaHeaders = anthropicBetaHeaders(kr.baseURL);
      if (betaHeaders) requestInit.headers = betaHeaders;

      const stream: any = await client.chat.completions.create(requestOptions, requestInit);

      let activeToolCallId = '';
      let activeToolName = '';
      let activeToolArgs = '';
      // Native-thinking fast-path: a model with a structured reasoning channel (Claude, o-series,
      // DeepSeek-R1, minimax) delivers its reasoning out-of-band via `reasoning_content`; the
      // content channel is the answer, with no opener-less `</think>` to guard against. Implicit
      // mode buffers leading content until a closer proves it was reasoning — for these models that
      // closer never comes, so it only adds latency (the answer arrives in one burst at stream end).
      // Disable implicit mode when the capability is present so the answer streams token-by-token.
      // FLOOR (caps.nativeThinking=false) leaves this exactly as before: `this.implicitThink`.
      const useImplicitThink = this.implicitThink && !caps.nativeThinking;
      const thinkFilter = new ThinkTagFilter(useImplicitThink);

      const iterator = stream[Symbol.asyncIterator]();
      let receivedFirstChunk = false;
      while (true) {
        const nextPromise = iterator.next();
        // Guard against a silently stalled stream. The first chunk (time-to-first-token) gets a
        // longer budget than later chunks: a cold start is a legitimate long pause, a mid-stream
        // gap is not. The timer MUST be cleared once the chunk arrives, or every chunk leaks a
        // timer (and a later unhandled rejection) — a long reasoning stream would spawn hundreds.
        const chunkTimeoutMs = receivedFirstChunk ? this.streamReadTimeoutMs : this.firstChunkTimeoutMs;
        let timeoutHandle: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<any>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`Stream read timeout: no data from the API for ${Math.round(chunkTimeoutMs / 1000)}s (check provider status / API key)`)), chunkTimeoutMs);
        });

        let result: any;
        try {
          result = await Promise.race([nextPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutHandle!);
        }
        if (result.done) break;
        receivedFirstChunk = true;

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
          // C3 — live tool-arg streaming. When the model streams partial-JSON tool args, surface the
          // call (name + args-so-far) as it forms so the UI shows activity before the turn finishes.
          // Additive + display-only: the authoritative `tool_call` still fires at the boundary/end.
          // FLOOR (caps.partialJsonTools=false) never emits this, so behavior is unchanged.
          if (caps.partialJsonTools && activeToolCallId) {
            yield { type: 'tool_call_partial', id: activeToolCallId, name: activeToolName, args: activeToolArgs };
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

      const { status, recoverable, kind } = classifyStreamError(e);
      this.apiKeyManager.reportKeyResult(kr.idx!, status);
      yield { type: 'error', message: e.message, recoverable, kind };
    }
  }
}
