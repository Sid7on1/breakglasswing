import { LLMProvider, Message, ChatEvent } from './llm.provider';
import { responseSanitizer } from './response.sanitizer';
import { extractTextToolCalls } from './tool.call.parser';
import { ToolRegistry } from '../tools/tool.registry';
import { IGovernor } from './interfaces';
import { Logger } from '../utils';
import { ContextManager } from '../memory/context.manager';
import { cliEvents, ToolCallEntry } from '../cli/events';
import { getActiveTodos } from '../tools/implementations/todo.tool';
import { LoopDetector, LoopSignal } from './loop-detector';
import { getGlobalPatternStore } from '../genome/pattern.store';
import { globalTelemetry } from '../telemetry/telemetry';

/**
 * Coerce a model-emitted tool-call arguments string to VALID JSON before it enters the message
 * history. The OpenAI tool-call contract requires `function.arguments` to be a JSON string, and many
 * providers (NVIDIA NIM) re-parse it on the NEXT request — so one truncated emission like `{"query": "`
 * would otherwise 400 every subsequent turn ("Unterminated string … char 10") until the user /clears.
 * Valid args are re-stringified canonically; anything unparseable becomes `{}`.
 */
export function sanitizeToolArgs(raw: any): string {
  if (raw == null) return '{}';
  if (typeof raw === 'object') {
    try { return JSON.stringify(raw); } catch { return '{}'; }
  }
  const s = String(raw).trim();
  if (s === '') return '{}';
  try { return JSON.stringify(JSON.parse(s)); } catch { return '{}'; }
}

export class AgentLoop {
  private contextManager: ContextManager;
  public messages: Message[] = [];

  constructor(
    private llm: LLMProvider,
    private tools: ToolRegistry,
    // Reserved/optional: the loop itself does not enforce policy — each tool carries its own injected
    // governor (set at buildTool time), so this is unused today. Kept positional for callers that pass
    // one (worker.agent) and for future loop-level gating. Personas pass `undefined`.
    private governor?: IGovernor,
    // The active model's context window (tokens). Compaction thresholds scale to this so bimax
    // works correctly whether the chosen model has a 32k or a 1M window. Falls back to a safe default.
    maxContextTokens?: number
  ) {
    this.contextManager = new ContextManager(llm, maxContextTokens);
  }

  async *execute(
    initialMessages: Message[],
    systemPrompt: string,
    options?: { maxIterations?: number; contextMode?: 'smart' | 'full'; useLite?: boolean; signal?: AbortSignal },
    context?: any
  ): AsyncGenerator<string> {
    this.messages = [...initialMessages];
    const maxIter = options?.maxIterations ?? 55;
    const contextMode = options?.contextMode ?? 'smart';
    // Cooperative cancellation: the front-end's interrupt aborts this signal. We don't tear the
    // in-flight fetch down mid-byte; we stop at the next safe boundary (next streamed token, or
    // before the next tool batch / loop iteration) so history stays well-formed.
    const signal = options?.signal;
    // Fresh loop detector per execute() call — tracks tool-call patterns across turns.
    const loopDetector = new LoopDetector();
    // Bounds the regenerate-on-empty correction below to a single retry, so a model
    // that keeps emitting pure filler can never spin the loop.
    let pureFillerRetried = false;
    // Bounds the recovery for a turn that produced NOTHING at all — no text and no tool
    // call (e.g. a reasoning/coding model that streamed only `reasoning_content` then ended
    // with empty content, or a model that went silent right after a tool result). Without
    // this the loop would `return` on the empty turn and the user would see a stopped
    // spinner and no answer. Single retry so a persistently-empty model can't spin.
    let emptyTurnRetried = false;
    // Whether any visible text has been streamed to the user across the whole call. If the
    // loop is about to end having shown nothing, we surface a note instead of silent silence.
    let anyTextYielded = false;
    // Bounds re-asks after a transient provider/model error (stalled stream, 5xx, a
    // single malformed tool-call emission) so a deterministically-failing turn can't
    // spin the loop, while a flaky one still gets a fresh attempt (new key / re-sample).
    let transientRetries = 0;
    const MAX_TRANSIENT_RETRIES = 2;
    // Bounds the "keep going while todos are open" persistence below, so a model that refuses to
    // finish (or keeps re-opening items) can't spin the loop forever.
    let persistenceNudges = 0;
    const MAX_PERSISTENCE_NUDGES = 4;

    for (let i = 0; i < maxIter; i++) {
      // Interrupted between turns: stop cleanly before spending another model call.
      if (signal?.aborted) return;
      // 1. Layered context management (smart mode runs the cheap passes + summarize-on-pressure;
      //    full mode is a no-op here and relies on reactive compaction if the API rejects the size).
      this.messages = await this.contextManager.checkAndCompact(this.messages, contextMode);
      // In smart mode the registry returns only the core working set + ToolSearch + any tools the
      // model has already surfaced via ToolSearchTool; in full mode it returns every schema. This
      // is recomputed each turn so a tool discovered mid-task becomes available immediately.
      const generator = this.llm.chat(this.messages, {
        system: systemPrompt,
        tools: this.tools.getSchemas({ mode: contextMode }) as any,
        // Tier routing: when the turn was routed to the lite model, every step of this loop
        // (incl. tool-call follow-ups) runs on lite. Heavy turns leave this unset → coding model.
        lite: options?.useLite,
        // CRITICAL: thread the interrupt signal into the request so Ctrl+C/esc aborts the underlying
        // fetch IMMEDIATELY. Without it the signal only took effect between stream events — so a hung
        // cold-starting model (no chunks) couldn't be stopped until the 60–180s timeout ("no stop
        // button"). Now an abort cancels the in-flight request at once.
        signal,
      });

      const toolCalls: { id: string; name: string; args: string }[] = [];
      let currentContent = '';
      // Set when the partial turn must be discarded and re-asked (after compaction or
      // a transient-error retry); triggers the `continue` below.
      let discardTurn = false;

      for await (const event of generator) {
        // Interrupted mid-stream: stop pulling tokens. Returning here runs the generator's
        // cleanup (.return()), which closes the underlying LLM stream.
        if (signal?.aborted) return;
        if (event.type === 'token') {
          currentContent += event.text;
          if (event.text) anyTextYielded = true;
          yield event.text;
        } else if (event.type === 'thinking') {
          // Internal reasoning: surface to the UI status area, never into the reply
          cliEvents.emit('thinking', event.text);
        } else if (event.type === 'tool_call') {
          toolCalls.push(event);
        } else if (event.type === 'tool_call_partial') {
          // Live activity only: show the call forming in the UI while args still stream. The
          // authoritative entry is (re-)emitted by executeTool with the same id, which the UI
          // dedupes, so this never double-runs anything.
          cliEvents.emit('tool_call', {
            id: event.id,
            toolName: event.name,
            input: event.args || '',
            output: '',
            status: 'running',
            startTime: new Date(),
          } as ToolCallEntry);
        } else if (event.type === 'usage') {
          this.contextManager.updateTokens(event.prompt);
        } else if (event.type === 'error') {
          if (event.recoverable && event.kind === 'context') {
            yield `\n[AgentLoop] Recoverable API Error: ${event.message}. Attempting reactive compaction...\n`;
            this.messages = await this.contextManager.reactiveCompact(this.messages, new Error(event.message));
            discardTurn = true;
            break;
          } else if (event.recoverable && event.kind === 'transient' && transientRetries < MAX_TRANSIENT_RETRIES) {
            // A stalled stream or a single bad model emission — discard the partial
            // turn and re-ask. A fresh chat() call rotates the API key and re-samples.
            transientRetries++;
            yield `\n[AgentLoop] Transient API error (${event.message}). Retrying (${transientRetries}/${MAX_TRANSIENT_RETRIES})...\n`;
            discardTurn = true;
            break;
          } else {
            // A bad/unknown model ID 400s every turn until changed. Don't dump the raw provider
            // error — tell the user the one thing that fixes it.
            const m = String(event.message || '');
            if (/model/i.test(m) && /(not a valid|not found|does not exist|unknown model|invalid)/i.test(m)) {
              yield `\n[AgentLoop] The provider rejected the current model id. Run /model to pick one it actually serves.\n  (provider said: ${m})\n`;
            } else {
              yield `\n[AgentLoop] API Error: ${event.message}\n`;
            }
            return;
          }
        }
      }

      // Discard the partial turn and let the outer loop re-ask (after compaction or a
      // transient retry). Any tokens already streamed to stdout are intentionally not
      // persisted to history, so the message log stays well-formed.
      if (discardTurn) continue;

      // Enforce the output contract: strip leaked tool-meta filler before it can
      // land in the reply or the history, and learn whether the turn was nothing but.
      const sanitized = responseSanitizer.sanitize(currentContent);
      currentContent = sanitized.text;

      // Recover any tool call the model wrote as plain-text JSON instead of via the
      // function-calling API. Gated on real tool names, so user JSON is never run.
      if (toolCalls.length === 0 && currentContent) {
        const recovered = extractTextToolCalls(currentContent, (n) => !!this.tools.getTool(n));
        if (recovered.toolCalls.length > 0) {
          toolCalls.push(...recovered.toolCalls);
          // The visible text was just a malformed invocation wrapper ("The final
          // answer is {json}"); drop it — the real prose answer arrives after the
          // tool returns and the loop runs again.
          currentContent = '';
          Logger.warn(`[AgentLoop] Recovered ${toolCalls.length} tool call(s) the model emitted as text.`);
        }
      }

      if (currentContent) {
        this.messages.push({ role: 'assistant', content: currentContent });
      }

      // Drop identical tool calls the model sometimes emits twice in one turn (e.g. cd x2): same name
      // + same args = redundant work and duplicate output. Keep the first of each.
      if (toolCalls.length > 1) {
        const seen = new Set<string>();
        const unique = toolCalls.filter(tc => {
          const key = `${tc.name}:${tc.args}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (unique.length < toolCalls.length) {
          Logger.warn(`[AgentLoop] Dropped ${toolCalls.length - unique.length} duplicate tool call(s).`);
          toolCalls.length = 0;
          toolCalls.push(...unique);
        }
      }

      if (toolCalls.length > 0) {
        // Interrupted right after the model asked for tools: don't start running them. The
        // assistant turn is already persisted above; we just stop before side effects.
        if (signal?.aborted) return;
        // Build the tool_calls payload for the assistant message
        const asstMsg: Message = { role: 'assistant', tool_calls: [] };
        if (currentContent) asstMsg.content = currentContent;

        for (const tc of toolCalls) {
          asstMsg.tool_calls!.push({
            id: tc.id,
            type: 'function',
            // CRITICAL: tool-call arguments MUST be valid JSON before they go into history. A model can
            // emit truncated/malformed args (e.g. a cut-off `{"query": "`); storing that raw poisons
            // EVERY later request — providers re-validate the arguments string as JSON and reject the
            // whole call ("Unterminated string … char 10"), so the session wedges until /clear. Coerce
            // to canonical JSON, falling back to `{}` so a bad emission can never corrupt the history.
            function: { name: tc.name, arguments: sanitizeToolArgs(tc.args) }
          });
        }
        
        // Replace the plain assistant message with the one containing tool_calls
        if (currentContent) {
            this.messages.pop(); 
        }
        this.messages.push(asstMsg);

        // Execute tools
        // Partition into parallel (safe) and sequential (destructive)
        const parallel = toolCalls.filter(tc => this.tools.getTool(tc.name)?.isConcurrencySafe);
        const sequential = toolCalls.filter(tc => !this.tools.getTool(tc.name)?.isConcurrencySafe);

        const executeTool = async (tc: { id: string, name: string, args: string }) => {
          // Announce the call so the UI can render live tool activity
          const entry: ToolCallEntry = {
            id: tc.id,
            toolName: tc.name,
            input: tc.args || '{}',
            output: '',
            status: 'running',
            startTime: new Date(),
          };
          cliEvents.emit('tool_call', entry);

          const finish = (result: string, isError: boolean) => {
            const endTime = new Date();
            const durationMs = endTime.getTime() - entry.startTime.getTime();
            globalTelemetry.recordToolCall(tc.name, durationMs);
            cliEvents.emit('tool_call_result', {
              ...entry,
              output: result,
              status: isError ? 'error' : 'success',
              endTime,
            } as ToolCallEntry);
            return { id: tc.id, result };
          };

          let argsObj: any;
          try {
            argsObj = JSON.parse(tc.args || '{}');
          } catch (e) {
            return finish(`Failed to parse arguments: ${tc.args}`, true);
          }

          const tool = this.tools.getTool(tc.name);
          if (!tool) {
            return finish(`Tool ${tc.name} not found.`, true);
          }

          try {
            const toolContext = context || { cwd: process.cwd() };
            const result = await tool.execute(argsObj, toolContext);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            return finish(resultStr, false);
          } catch (e: any) {
            return finish(`Tool Error: ${e.message}`, true);
          }
        };

        const parallelPromises = parallel.map(tc => executeTool(tc));
        const parallelResults = await Promise.all(parallelPromises);

        const loopSignals: LoopSignal[] = [];

        for (const res of parallelResults) {
          this.messages.push({ role: 'tool', tool_call_id: res.id, content: res.result });
          const tc = parallel.find(t => t.id === res.id);
          if (tc) {
            const sig = loopDetector.record(tc.name, tc.args, res.result);
            if (sig) loopSignals.push(sig);
          }
        }

        for (const tc of sequential) {
          const res = await executeTool(tc);
          this.messages.push({ role: 'tool', tool_call_id: res.id, content: res.result });
          const sig = loopDetector.record(tc.name, tc.args, res.result);
          if (sig) loopSignals.push(sig);
        }

        // Handle any loop signals collected this turn
        if (loopSignals.length > 0) {
          const worst = loopSignals.sort((a, b) => b.count - a.count)[0];
          // Log to genome pattern store (best-effort, non-blocking)
          try { getGlobalPatternStore()?.appendLoopSignal(worst.type, worst.tool, worst.argsHash, worst.severity); } catch { /* ignore */ }
          if (worst.severity === 'hard') {
            yield `\n[LoopGuard] Hard loop detected: ${worst.type} on "${worst.tool}" (${worst.count}×). Injecting intervention.\n`;
            cliEvents.emit('loop_detected' as any, worst);
            this.messages.push({
              role: 'user',
              content:
                `[LOOP DETECTED — HARD STOP] You called "${worst.tool}" ${worst.count} times with the same ` +
                `arguments and got the same result. This is a loop. STOP immediately. ` +
                `Take a completely different approach — try a different tool, a different strategy, or a different argument. ` +
                `If you are genuinely blocked, explain exactly what is blocking you instead of repeating the same call.`,
            });
          } else {
            Logger.warn(`[LoopGuard] Soft loop: ${worst.type} on "${worst.tool}" (${worst.count}×)`);
            this.messages.push({
              role: 'user',
              content:
                `[Loop Warning] "${worst.tool}" has been called with similar arguments ${worst.count} times. ` +
                `Consider whether this approach is making progress, or try a different strategy.`,
            });
          }
        }

        // Loop continues so LLM can react to tool results
      } else {
        // A turn with no tool call that collapsed to pure filler gave the user
        // nothing. Rather than silently ending on an empty reply, nudge the model
        // once to answer directly and let the loop run again. Guarded against spin.
        if (sanitized.wasPureFiller && !pureFillerRetried) {
          pureFillerRetried = true;
          this.messages.push({
            role: 'user',
            content:
              'Your previous reply contained no answer — only a remark about tool usage. ' +
              'Respond now with the actual answer to the request. If no tool is needed, ' +
              'give the answer directly; do not mention tools or function calls.',
          });
          continue;
        }
        // Persistence ("beast mode"): if the model tries to stop but its own todo list still has open
        // items, push it to keep going instead of handing back half-done. Bounded so it can't spin.
        const incomplete = getActiveTodos().filter(t => t.status !== 'completed');
        if (incomplete.length > 0 && persistenceNudges < MAX_PERSISTENCE_NUDGES) {
          persistenceNudges++;
          this.messages.push({
            role: 'user',
            content:
              `You stopped, but the task isn't finished — these items on your own todo list are still open:\n` +
              incomplete.map(t => `- ${t.content} (${t.status})`).join('\n') +
              `\nKeep working through them now. Don't hand back until they're all completed — or, if you're genuinely blocked, say exactly what's blocking and why.`,
          });
          continue;
        }
        // A turn that produced nothing the user can see — no streamed text this turn, no
        // tool call, and not caught by the pure-filler path above (e.g. a reasoning/coding
        // model that emitted only `reasoning_content` then ended empty, or a model that went
        // silent right after a tool result). Ending here would leave the user staring at a
        // stopped spinner. Nudge once for a direct answer; bounded so it can't spin.
        // Note: anyTextYielded is intentionally NOT checked here — text from earlier tool-call
        // rounds (or leaked think> fragments) must not suppress the retry for an empty final turn.
        if (!currentContent && !emptyTurnRetried) {
          emptyTurnRetried = true;
          this.messages.push({
            role: 'user',
            content:
              'You returned an empty response. Reply now with your actual answer to the ' +
              'request in plain text. If you already have everything you need (including any ' +
              'tool results above), just write the answer directly.',
          });
          continue;
        }
        // No tool calls and nothing left open — task complete. If the entire call produced
        // no visible text at all, say so rather than returning dead silence.
        if (!anyTextYielded) {
          yield `\n[No response was produced. Try rephrasing, or press Ctrl+T to pin the model tier.]\n`;
        }
        return;
      }
    }
    
    yield `\n[AgentLoop] Reached maximum iterations (${maxIter}).\n`;
  }
}
