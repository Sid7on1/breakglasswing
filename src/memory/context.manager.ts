import { LLMProvider, Message } from '../core/llm.provider';
import { contentToText } from '../core/multimodal';
import { encode } from 'gpt-tokenizer';
import { Logger } from '../utils/logger';
import { fileStateCache } from './file-state-cache';
import { IGraphStore } from '../graph/models';
import { formatRepoMapOutline } from '../graph/pagerank';
import { compressBacklog, proxyCompress, recordCompression } from './headroom.compress';
import { cliEvents } from '../cli/events';

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
/** The boot-wired native graph store, for code that needs a RepoMap outside the compaction loop. */
export function getContextManagerGraphStore(): IGraphStore | null { return _graphStore; }

// Pull "code-ish" focus terms from the latest user message to personalize the repo map: camelCase,
// snake_case, paths, or dotted names (setAuthCookie, auth.ts, src/auth). Plain prose words are
// skipped — boosting on "read"/"improve" would surface unrelated symbols. Empty for a vague request,
// so the map falls back to pure PageRank ranking.
export function focusTermsFromMessages(msgs: Message[]): string[] {
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  const text = lastUser ? contentToText(lastUser.content as any) : '';
  if (!text) return [];
  const terms = new Set<string>();
  for (const w of text.match(/[A-Za-z_][A-Za-z0-9_./-]{2,}/g) || []) {
    if (/[A-Z]/.test(w) || w.includes('_') || w.includes('/') || w.includes('.')) {
      terms.add(w);
      if (terms.size >= 40) break;
    }
  }
  return [...terms];
}

export class ContextManager {
  private readonly MAX_TOKENS: number;
  private readonly COMPACT_THRESHOLD = 0.7; // summarize when reaching 70% of the window
  private readonly WARN_THRESHOLD = 0.5;    // one-time early warning at 50%
  private currentTokens: number = 0;
  private halfWindowWarnEmitted = false;    // fire the 50% nudge only once per session

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

    // Layer 0 — Headroom Kompress compression. The REAL ML compressor (chopratejas/kompress-v2-base
    // ONNX via the localhost proxy) crushes the noisy bulk of the context (tool outputs, logs, file
    // dumps) ~30-40% while protecting error/signal lines. It costs ~5-9s of CPU, so we only fire it
    // under TOKEN PRESSURE — once the backlog is near the compaction threshold, where it pays for
    // itself; cheap turns stay instant. Opt out with BIMAX_DISABLE_COMPRESSION=1.
    let msgs: Message[] = messages;
    const pressureRatio = this.estimateTokens(messages) / this.MAX_TOKENS;
    if (process.env.BIMAX_DISABLE_COMPRESSION !== '1' && pressureRatio >= this.COMPACT_THRESHOLD) {
      // Which model the saving is attributed to (for the per-model /headroom report).
      let model = 'unknown';
      try { const c = require('../cli/config').getConfig(); model = c.model || c.liteModel || 'unknown'; } catch { /* config optional */ }

      let saved = 0, n = 0;
      // Give the proxy a brief beat to finish coming up before this pressured pass: the startup context
      // can cross the threshold on turn one, before the ~4s sidecar boot completes — without this wait
      // that first pass goes native and (since compaction may not recur) stays the only recorded engine.
      try {
        const hp = require('./headroomProxy');
        if (!hp.isHeadroomReady()) await hp.awaitHeadroomReady(8000);
      } catch { /* headroom optional */ }
      // Prefer the real Headroom Kompress proxy; fall back to the native heuristic only if the sidecar
      // isn't up yet (provisioning/first-run model download) so a turn under pressure never goes uncompacted.
      const proxied = await proxyCompress(messages as any, model === 'unknown' ? '' : model, this.MAX_TOKENS);
      if (proxied) {
        // Measure the REAL before/after of the context so the /headroom ratio is honest. The proxy only
        // returns `saved`, so deriving after = before - saved (vs. the old before=saved, after=0) is what
        // stops the report claiming "100% smaller (… → 0 tok)". Trust whichever savings estimate is larger:
        // our cheap char/4 estimate, or the proxy's own re-tokenized count.
        const before = this.estimateTokens(messages);
        const after = this.estimateTokens(proxied.messages as Message[]);
        if (after > before) {
          // Sanity net: a compactor that GROWS the context is a regression (bad proxy build, model
          // misconfig). Never swap in a larger array — keep the original and record nothing.
          Logger.warn(`[Headroom] proxy returned a LARGER context (${before} → ${after} tok); discarding its result.`);
        } else {
          // STACK the lossless native pass on top of the proxy output: the Kompress proxy leaves most
          // repetitive log/build spam untouched (its real savings on code are now disabled by the code
          // guard), whereas compressBacklog collapses 4+ identical-signature line runs losslessly and
          // always keeps error/warning lines. Safe on code (varied lines pass through verbatim), so we
          // run it on EVERY proxied result to recover the log savings the proxy skips.
          const stacked = compressBacklog(proxied.messages as any, { protectRecent: 0, skipCode: true });
          msgs = stacked.messages as Message[];
          const finalAfter = this.estimateTokens(msgs);
          saved = Math.max(0, before - finalAfter, proxied.saved);
          if (saved > 0) recordCompression(model, before, Math.max(0, before - saved), 'proxy');
        }
        n = -1;
      } else {
        // Native safety net (proxy not ready): collapse repetitive log/ANSI spam in ALL tool outputs.
        // Lossless on code and always keeps error/warning lines.
        const { messages: compressed, stats } = compressBacklog(messages as any, { protectRecent: 0 });
        msgs = compressed as Message[];
        saved = stats.saved;
        n = stats.compressedMessages;
        if (saved > 0) recordCompression(model, stats.compressedBefore, stats.compressedAfter, 'native');
      }
      if (saved > 0) {
        Logger.info(`[Headroom] ${proxied ? 'Kompress proxy' : 'native'} compression saved ~${saved} tokens${n >= 0 ? ` across ${n} output(s)` : ''} (model ${model})`);
        try { cliEvents.emit('graph_changed'); } catch { /* refresh the token meter; best-effort */ }
      }
    }

    msgs = this.capToolResults(msgs);
    msgs = this.microCompact(msgs);
    msgs = this.snip(msgs);

    // RepoMap (aider-style): refresh it EVERY turn so it reflects current files and re-ranks toward
    // THIS request (focus terms from the latest user message). Strip any prior map first so history
    // keeps exactly one copy — current, personalized, no accumulation.
    if (_graphStore) {
      try {
        msgs = msgs.filter(m => !(m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[RepoMap]')));
        const outline = formatRepoMapOutline(_graphStore, 1500, focusTermsFromMessages(msgs));
        if (outline) msgs = [{ role: 'system' as const, content: outline }, ...msgs];
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
