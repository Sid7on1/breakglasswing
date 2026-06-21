import { LLMProvider, Message } from '../core/llm.provider';
import { contentToText } from '../core/multimodal';
import { encode } from 'gpt-tokenizer';
import { Logger } from '../utils/logger';
import { fileStateCache } from './file-state-cache';
import { IGraphStore } from '../graph/models';
import { formatRepoMapOutline } from '../graph/pagerank';

export type ContextMode = 'smart' | 'full';

/**
 * ContextManager — bimax's layered context manager (the analogue of Claude Code's multi-layer
 * compaction stack). Before each API call in SMART mode it runs an ordered set of deterministic
 * passes, cheapest first, so we only pay for the expensive (LLM-summarizing) layer when the cheap
 * ones haven't freed enough room:
 *
 *   1. capToolResults  — truncate any single oversized tool result (no LLM, always).
 *   2. microCompact    — clear OLD tool results, keep the last N intact (no LLM, always).
 *   3. snip            — drop the oldest history beyond a protected tail for runaway sessions (no LLM).
 *   4. compact         — summarize older messages into one system note (LLM, only under token pressure).
 *
 * FULL mode skips all proactive passes — everything is sent until the API itself rejects it, at
 * which point reactiveCompact() recovers. The model always sees the whole history in full mode.
 */
// Module-level graph store reference injected by the container at startup.
// When set, checkAndCompact() injects a compact RepoMap outline at the capToolResults layer.
let _graphStore: IGraphStore | null = null;
export function setContextManagerGraphStore(store: IGraphStore): void { _graphStore = store; }

export class ContextManager {
  private readonly MAX_TOKENS: number;
  private readonly COMPACT_THRESHOLD = 0.7; // summarize when reaching 70% of the window
  private readonly WARN_THRESHOLD = 0.5;    // one-time early warning at 50%
  private currentTokens: number = 0;
  private halfWindowWarnEmitted = false;    // fire the 50% nudge only once per session
  private repoMapInjected = false;          // inject the outline once per session

  // Cheap-pass tuning. Deliberately conservative so multi-step tasks keep the context they need.
  private readonly TOOL_RESULT_MAX_CHARS = 16000; // cap on a single tool result
  private readonly KEEP_RECENT_TOOL_RESULTS = 6;  // most recent tool outputs left fully intact
  private readonly SNIP_TRIGGER_MESSAGES = 100;   // only guard against truly runaway histories
  private readonly SNIP_KEEP_TAIL = 60;

  // Epoch counter: incremented at the start of each compact() call.
  // Lets callers detect whether compaction ran between two points in time (ABA prevention).
  private compactionEpoch = 0;

  // Default is a safe generic window (most modern OpenAI-compatible models are >=128k). The agent
  // loop passes the user-configured value when set, so this only applies if nothing wired a real one.
  constructor(private llm: LLMProvider, maxTokens: number = 128000) {
    this.MAX_TOKENS = maxTokens > 0 ? maxTokens : 128000;
  }

  /** Returns the current compaction epoch. Callers can snapshot this and later call checkEpoch(). */
  getEpoch(): number { return this.compactionEpoch; }

  /**
   * Returns true if the epoch hasn't changed since `priorEpoch` was captured — meaning no
   * compaction ran between then and now, so any buffered messages are still valid.
   */
  checkEpoch(priorEpoch: number): boolean { return this.compactionEpoch === priorEpoch; }

  /** Called by the AgentLoop when the LLM returns token usage. */
  updateTokens(promptTokens: number) {
    this.currentTokens = promptTokens;
  }

  /**
   * Run the layered compaction before an API call. In FULL mode this is a no-op (reactiveCompact
   * still recovers on a 413). In SMART mode it applies the cheap passes always, then summarizes
   * only if still over the token threshold.
   */
  async checkAndCompact(messages: Message[], mode: ContextMode = 'smart'): Promise<Message[]> {
    if (mode === 'full') return messages;

    let msgs = this.capToolResults(messages);
    msgs = this.microCompact(msgs);
    msgs = this.snip(msgs);

    // Inject RepoMap outline once per session so the model knows the load-bearing symbols.
    if (!this.repoMapInjected && _graphStore) {
      try {
        const outline = formatRepoMapOutline(_graphStore, 1500); // ~1.5k-token budget, aider-style
        if (outline) {
          this.repoMapInjected = true;
          msgs = [{ role: 'system' as const, content: outline }, ...msgs];
        }
      } catch { /* pagerank optional — never fail the compaction loop */ }
    }

    // Heavy fallback: summarize only when the cheap passes left us above the threshold.
    const estimated = this.estimateTokens(msgs);
    const ratio = estimated / this.MAX_TOKENS;

    // One-time early nudge at 50% so the model can be conservative before forced compaction.
    if (!this.halfWindowWarnEmitted && ratio >= this.WARN_THRESHOLD) {
      this.halfWindowWarnEmitted = true;
      Logger.warn(`[ContextManager] Context window ${Math.round(ratio * 100)}% full — approaching compaction threshold.`);
      msgs = [
        ...msgs,
        {
          role: 'system' as const,
          content: `[ContextManager] You have used ~${Math.round(ratio * 100)}% of your context window. To avoid forced compaction, prefer targeted reads (startLine/endLine), release unneeded context with FreeContextTool, and avoid re-reading files you already have.`,
        },
      ];
    }

    if (ratio > this.COMPACT_THRESHOLD) {
      Logger.warn(`[ContextManager] ${Math.round(ratio * 100)}% after cheap passes — summarizing older history.`);
      msgs = await this.compact(msgs);
    }
    return msgs;
  }

  /**
   * Layer 1 — cap a single oversized tool result so one giant Read/Bash dump can't dominate the
   * window. Keeps the head and tail (where the signal usually is) and notes how much was elided.
   */
  private capToolResults(messages: Message[]): Message[] {
    const max = this.TOOL_RESULT_MAX_CHARS;
    let trimmed = 0;
    const out = messages.map(m => {
      if (m.role !== 'tool' || typeof m.content !== 'string' || m.content.length <= max) return m;
      trimmed++;
      const head = m.content.slice(0, Math.floor(max * 0.7));
      const tail = m.content.slice(-Math.floor(max * 0.2));
      const elided = m.content.length - head.length - tail.length;
      return { ...m, content: `${head}\n\n… [${elided} chars elided to save context] …\n\n${tail}` };
    });
    if (trimmed) Logger.info(`[ContextManager] Capped ${trimmed} oversized tool result(s).`);
    return out;
  }

  /**
   * Layer 2 — micro-compact: clear the content of OLD tool results, keeping the most recent
   * KEEP_RECENT_TOOL_RESULTS intact. No LLM call. The tool message itself (and its tool_call_id)
   * is preserved so tool_use/tool_result pairing never breaks — only its body becomes a stub.
   */
  private microCompact(messages: Message[]): Message[] {
    const toolIdx = messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter(i => i >= 0);
    if (toolIdx.length <= this.KEEP_RECENT_TOOL_RESULTS) return messages;

    const clearBefore = toolIdx[toolIdx.length - this.KEEP_RECENT_TOOL_RESULTS];
    let cleared = 0;
    const out = messages.map((m, i) => {
      if (m.role !== 'tool' || i >= clearBefore) return m;
      if (m.content === '[tool result cleared to save context]') return m; // already stubbed
      cleared++;
      return { ...m, content: '[tool result cleared to save context]' };
    });
    if (cleared) Logger.info(`[ContextManager] Micro-compacted ${cleared} old tool result(s).`);
    return out;
  }

  /**
   * Layer 3 — snip: a blunt guard for runaway sessions. When the non-system history grows past
   * SNIP_TRIGGER_MESSAGES, keep only the last SNIP_KEEP_TAIL of it (plus all system messages),
   * never letting the kept window begin on an orphaned tool result.
   */
  private snip(messages: Message[]): Message[] {
    const nonSystem = messages.filter(m => m.role !== 'system');
    if (nonSystem.length <= this.SNIP_TRIGGER_MESSAGES) return messages;

    const system = messages.filter(m => m.role === 'system');
    const tail = this.dropLeadingOrphanToolMessages(nonSystem.slice(-this.SNIP_KEEP_TAIL));
    Logger.warn(`[ContextManager] Snipped ${nonSystem.length - tail.length} old message(s) (runaway history guard).`);
    return [...system, ...tail];
  }

  /**
   * A `tool` message is only valid immediately after the assistant `tool_calls` that produced it.
   * When a window starts partway through a tool exchange, the leading `tool` messages are orphaned
   * and the API rejects the request — so drop them until the window begins on a user/assistant turn.
   */
  private dropLeadingOrphanToolMessages(messages: Message[]): Message[] {
    let start = 0;
    while (start < messages.length && messages[start].role === 'tool') start++;
    return messages.slice(start);
  }

  private estimateTokens(messages: Message[]): number {
    try {
      const text = messages.map(m => contentToText(m.content)).join('\n');
      return encode(text).length;
    } catch {
      return Math.ceil(JSON.stringify(messages).length / 4);
    }
  }

  /** Layer 4 — summarize older messages into a single system note (the one LLM-backed pass). */
  async compact(messages: Message[]): Promise<Message[]> {
    const systemMessages = messages.filter(m => m.role === 'system');

    // Preserve the last 15 messages. Trim any leading orphan tool results so the window can't
    // begin with a `tool` message whose parent assistant tool_calls was cut.
    const recentMessages = this.dropLeadingOrphanToolMessages(
      messages.filter(m => m.role !== 'system').slice(-15)
    );

    const olderMessages = messages.filter(m =>
      m.role !== 'system' && !recentMessages.includes(m)
    );

    // Nothing to summarize — return BEFORE touching the epoch, so checkEpoch() doesn't see a
    // phantom "compaction happened" when none did (which falsely invalidated buffered messages).
    if (olderMessages.length === 0) {
      return messages;
    }

    // Increment epoch only now that a real compaction is underway, so a concurrent caller can
    // detect a compaction in flight.
    this.compactionEpoch++;
    const myEpoch = this.compactionEpoch;

    Logger.info(`[ContextManager] Summarizing ${olderMessages.length} older messages (epoch ${myEpoch})...`);

    // Flatten any multimodal (image) content to text before serializing: a base64 data URL can be
    // megabytes, and embedding it in the summary prompt would blow up tokens/cost and likely 400 the
    // very summarizer meant to SHRINK context. contentToText replaces image parts with "[image]".
    const olderForSummary = olderMessages.map(m => ({ ...m, content: contentToText(m.content) }));

    const summaryPrompt: Message[] = [
      {
        role: 'system',
        content: `You are summarizing a coding session. Output ONLY these five sections with NO other prose:

## Goal
One sentence: the exact task or question the user gave.

## Progress
Bullet list of what was actually completed — include file paths, function names, commands run, and test results.

## Key Decisions
Up to 3 bullets: non-obvious choices made and the reason (e.g. "Used X not Y because..."). Omit if nothing non-obvious occurred.

## Next Steps
What should happen next to finish the task. If the task is done, write "DONE".

## Relevant Files
Comma-separated list of files created, modified, or important to the task.`,
      },
      {
        role: 'user',
        content: `Summarize these messages into the five sections above:\n${JSON.stringify(olderForSummary)}`,
      },
    ];

    let summaryText = '';
    try {
      // Summarization is cheap aux work — route it to the lite model when one is configured.
      const generator = this.llm.chat(summaryPrompt, { lite: true });
      for await (const event of generator) {
        if (event.type === 'token') summaryText += event.text;
      }
    } catch (e: any) {
      Logger.error(`[ContextManager] Failed to summarize context: ${e.message}`);
      summaryText = '[Older conversation history dropped due to context limits]';
    }

    // If another compact() call ran while we were awaiting the LLM, our result is stale —
    // return original messages unchanged so the later epoch's result takes precedence.
    if (this.compactionEpoch !== myEpoch) {
      Logger.warn(`[ContextManager] Epoch mismatch after compact (started ${myEpoch}, now ${this.compactionEpoch}) — discarding stale result.`);
      return messages;
    }

    const summaryMsg: Message = {
      role: 'system',
      content: `[Previous Context Summary]\n${summaryText}`,
    };

    // Post-compact file restoration: re-inject recently-read files as synthetic attachments
    // so the model doesn't need to re-read files it was actively working with.
    const recentReads = fileStateCache.getRecentReads();
    const fileAttachments: Message[] = recentReads.map(f => ({
      role: 'system' as const,
      content: `[Post-Compact Restoration — ${f.path} — unchanged since last read]\n${f.content}`,
    }));

    if (fileAttachments.length > 0) {
      Logger.info(`[ContextManager] Restored ${fileAttachments.length} recently-read file(s) post-compact.`);
    }

    const compacted = [...systemMessages, summaryMsg, ...fileAttachments, ...recentMessages];
    this.currentTokens = this.estimateTokens(compacted);
    return compacted;
  }

  /** Reactive recovery: fires when the API rejects a request as too long. Cuts the window hard. */
  async reactiveCompact(messages: Message[], error: any): Promise<Message[]> {
    if (error?.message?.includes('too long') || error?.code === 'prompt_too_long' || error?.message?.includes('maximum context length')) {
      Logger.warn(`[ContextManager] Reactive compact triggered by API error: ${error.message}`);
      this.currentTokens = this.MAX_TOKENS; // force it
      const systemMessages = messages.filter(m => m.role === 'system');
      const recentMessages = this.dropLeadingOrphanToolMessages(
        messages.filter(m => m.role !== 'system').slice(-5)
      );
      return [...systemMessages, { role: 'system', content: '[Older messages aggressively compacted due to API context limits]' } as Message, ...recentMessages];
    }
    throw error;
  }
}
