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
import { getSelfModel, domainOf, pathOf, classifyOutcome, currentModelKey } from '../mind/self.model';
import { TypedOutcome, typedFromError } from '../tools/outcome';
import { getEventLedger } from '../mind/event.ledger';
import { markToolTaint } from '../mind/taint';
import { getHabitMiner } from '../mind/habit.compiler';
import { getEpistemicLedger, isEvidenceCommand } from '../mind/epistemic.ledger';
import { startEpisodeRecording, isReplayActive } from '../mind/episode.recorder';

/** Mutating tools whose success is an implicit "this change is correct" claim. */
const CLAIMING_TOOLS = new Set(['EditFileTool', 'WriteFileTool', 'MultiEditTool', 'SymbolEditTool']);

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
    const maxIter = options?.maxIterations ?? 130;
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
    // Black-box recorder: every execute() is an episode — each LLM call in this run is
    // recorded (request hash + response stream) to a bundle under .bimax/episodes/,
    // self-flushing per call. /episodes replays it; BIMAX_RECORDER=0 disables.
    const recordedLlm = startEpisodeRecording(this.llm).llm;

    for (let i = 0; i < maxIter; i++) {
      // Interrupted between turns: stop cleanly before spending another model call.
      if (signal?.aborted) return;
      // 1. Layered context management (smart mode runs the cheap passes + summarize-on-pressure;
      //    full mode is a no-op here and relies on reactive compaction if the API rejects the size).
      this.messages = await this.contextManager.checkAndCompact(this.messages, contextMode);
      // In smart mode the registry returns only the core working set + ToolSearch + any tools the
      // model has already surfaced via ToolSearchTool; in full mode it returns every schema. This
      // is recomputed each turn so a tool discovered mid-task becomes available immediately.
      const generator = recordedLlm.chat(this.messages, {
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
            // Internal recovery — never narrated into the answer stream (the reply must read as one
            // uninterrupted voice). The footer status + log view carry what's happening instead.
            cliEvents.emit('status', 'Context overflow — compacting and retrying…');
            cliEvents.emit('log', { id: Date.now(), level: 'warn', text: `Context overflow (${event.message}); compacting and re-asking.`, timestamp: new Date() });
            this.messages = await this.contextManager.reactiveCompact(this.messages, new Error(event.message));
            discardTurn = true;
            break;
          } else if (event.recoverable && event.kind === 'transient' && transientRetries < MAX_TRANSIENT_RETRIES) {
            // A stalled stream, rate limit, or a single bad model emission — discard the partial
            // turn and re-ask. A fresh chat() call rotates the API key and re-samples. BACK OFF
            // first: honor the provider's Retry-After if it sent one, else exponential (1s, 2s),
            // so a 429 isn't immediately hammered (which only deepens the limit).
            transientRetries++;
            const backoffMs = event.retryAfterSecs != null
              ? Math.min(event.retryAfterSecs * 1000, 30_000)
              : Math.min(1000 * 2 ** (transientRetries - 1), 8000);
            cliEvents.emit('status', `Provider hiccup — retrying in ${Math.round(backoffMs / 1000)}s (${transientRetries}/${MAX_TRANSIENT_RETRIES})`);
            cliEvents.emit('log', { id: Date.now(), level: 'warn', text: `Transient API error (${event.message}); backing off ${Math.round(backoffMs / 1000)}s.`, timestamp: new Date() });
            await new Promise(r => setTimeout(r, backoffMs));
            discardTurn = true;
            break;
          } else {
            // Unrecoverable: this IS the turn's outcome, so it belongs in the reply — but in a human
            // voice, not a "[AgentLoop]" log line. A bad/unknown model ID 400s every turn until
            // changed, so lead with the one thing that fixes it rather than the raw provider dump.
            const m = String(event.message || '');
            if (/model/i.test(m) && /(not a valid|not found|does not exist|unknown model|invalid)/i.test(m)) {
              yield `\n⚠ The provider rejected the current model id — run /model to pick one it serves.\n  (provider said: ${m})\n`;
            } else {
              yield `\n⚠ The provider returned an error: ${event.message}\n`;
            }
            return;
          }
        }
      }

      // Discard the partial turn and let the outer loop re-ask (after compaction or a
      // transient retry). Any tokens already streamed to stdout are intentionally not
      // persisted to history, so the message log stays well-formed.
      if (discardTurn) continue;

      // Reached here ⇒ the stream completed cleanly (no transient error broke us out). Reset the
      // transient budget so it means "2 CONSECUTIVE failures", not "2 per entire run". Without this a
      // single early network blip permanently spends the budget, and a later unrelated blip — hours
      // into a long autonomous run — would kill the loop instead of retrying.
      transientRetries = 0;

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

          const finish = (result: string, isError: boolean, typed?: TypedOutcome) => {
            const endTime = new Date();
            const durationMs = endTime.getTime() - entry.startTime.getTime();
            globalTelemetry.recordToolCall(tc.name, durationMs);
            // Mind layer: feed the self-model (learned failure rates → routing hints) and the
            // habit miner (recurring tool sequences → compiled habits). Both are best-effort
            // observers — they must never be able to break tool execution. During a replay
            // these stand down entirely: re-observing recorded experience as fresh evidence
            // would double-count every outcome the system already learned from.
            if (!isReplayActive()) try {
              // Typed outcome (v2 Phase 0): prefer the tool's own declaration — ground truth.
              // The regex classifier is the explicit low-confidence fallback for unswept/MCP tools.
              // 'blocked' (policy said no) joins 'rejected' as preference/policy data, never a
              // failure-rate sample.
              const outcome: 'ok' | 'err' | 'rejected' = typed
                ? (typed.status === 'ok' ? 'ok' : typed.status === 'error' ? 'err' : 'rejected')
                : classifyOutcome(result, isError);
              const domain = domainOf(tc.name, tc.args || '{}');
              // Taint (v2 D3): web/MCP output entering the conversation marks the session
              // untrusted — the governor then denies network capability until a human clears it.
              markToolTaint(tc.name, tc.args || '{}', result);
              let bashCmd: string | undefined;
              if (tc.name === 'BashTool') {
                try { bashCmd = String(JSON.parse(tc.args || '{}').command || '') || undefined; } catch { /* unparseable */ }
              }
              // Prefix the declared error class so weak-spot samples carry the label.
              const errSample = outcome === 'err'
                ? (typed?.errorClass ? `[${typed.errorClass}] ${result}` : result).slice(0, 200)
                : undefined;
              // Event ledger (v2 D1): every tool outcome lands in the append-only log with
              // its typed label AND everything a view rebuild needs (model key, bash cmd,
              // touched file, error sample) — the raw material learned state is refolded from.
              getEventLedger().append('tool_outcome', {
                tool: tc.name, domain,
                status: typed?.status ?? outcome,
                errorClass: typed?.errorClass,
                exitCode: typed?.exitCode,
                confidence: typed ? 'high' : 'low',
                model: currentModelKey(),
                cmd: bashCmd,
                file: pathOf(tc.args || '{}'),
                errSample,
                durationMs, isError,
              });
              if (outcome !== 'rejected') {
                getSelfModel().record(tc.name, domain, outcome === 'ok', errSample);
              }
              getHabitMiner().observe(tc.name, domain, outcome === 'ok', bashCmd);
              // Epistemic ledger: a successful mutation opens a correctness claim (confidence
              // grounded in the self-model, scoped to the mutated FILE); a build/test/typecheck
              // run is evidence that resolves only the claims it covers — red output must name
              // the claim's file, green repo-wide runs cover everything in the window.
              if (outcome === 'ok' && CLAIMING_TOOLS.has(tc.name)) {
                const claimFile = pathOf(tc.args || '{}');
                const conf = getSelfModel().confidenceFor(tc.name, domain);
                getEpistemicLedger().openClaim(domain, conf, claimFile);
                getEventLedger().append('claim', { tool: tc.name, domain, file: claimFile, confidence: conf });
              } else if (tc.name === 'BashTool' && bashCmd && isEvidenceCommand(bashCmd)) {
                // Exit code (when Bash declared it) beats the regex guess: a red tsc/test run
                // returns its output with exit≠0 and used to classify 'ok', silently settling
                // claims as GREEN. Ground truth ends that.
                const evidenceOk = typed?.exitCode !== undefined ? typed.exitCode === 0 : outcome === 'ok';
                const settled = getEpistemicLedger().resolve(evidenceOk, { command: bashCmd, output: result });
                getEventLedger().append('evidence', { command: bashCmd.slice(0, 200), ok: evidenceOk, settled });
              }
            } catch { /* observers are best-effort */ }
            cliEvents.emit('tool_call_result', {
              ...entry,
              output: result,
              status: isError ? 'error' : 'success',
              endTime,
              // Additive typed-outcome fields — the TUI ignores unknown JSON keys.
              ...(typed ? { outcome: typed.status, errorClass: typed.errorClass } : {}),
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
            // Thread the interrupt signal into the tool so a long-running one (e.g. a 30s Bash)
            // is killed the instant esc is hit, rather than running to completion first.
            // reportOutcome is the typed-outcome side-channel: the factory fires it when the
            // tool declared its own status (v2 Phase 0), so learning gets labels, not guesses.
            let typed: TypedOutcome | undefined;
            const toolContext = {
              ...(context || { cwd: process.cwd() }), signal,
              reportOutcome: (o: TypedOutcome) => { typed = o; },
            };
            const result = await tool.execute(argsObj, toolContext);
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            return finish(resultStr, false, typed);
          } catch (e: any) {
            const text = `Tool Error: ${e.message}`;
            return finish(text, true, typedFromError(e, text));
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
          // Interrupted mid-chain: stop before starting the next tool so esc halts a continuous
          // run of tool calls promptly, instead of waiting out the whole batch + another model call.
          if (signal?.aborted) return;
          const res = await executeTool(tc);
          this.messages.push({ role: 'tool', tool_call_id: res.id, content: res.result });
          const sig = loopDetector.record(tc.name, tc.args, res.result);
          if (sig) loopSignals.push(sig);
        }

        // One mind-strip refresh per tool batch (not per call): the footer's 🧠 counters
        // (weak spots / drive deviations / habits) re-snapshot after the batch lands.
        try { cliEvents.emit('mind_changed' as any); } catch { /* best-effort */ }

        // Handle any loop signals collected this turn
        if (loopSignals.length > 0) {
          const worst = loopSignals.sort((a, b) => b.count - a.count)[0];
          // Log to genome pattern store (best-effort, non-blocking)
          try { getGlobalPatternStore()?.appendLoopSignal(worst.type, worst.tool, worst.argsHash, worst.severity); } catch { /* ignore */ }
          if (worst.severity === 'hard') {
            // The loop_detected event renders its own visible line in the TUI — no reply-stream
            // narration on top of it (the answer must stay the model's voice alone).
            cliEvents.emit('status', `Loop broken — "${worst.tool}" repeated ${worst.count}×, steering the model away`);
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
          yield `\nNo response was produced. Try rephrasing, or press Ctrl+T to pin the model tier.\n`;
        }
        return;
      }
    }

    yield `\n⚠ Stopped after ${maxIter} rounds without finishing — say "continue" to pick up where this left off.\n`;
  }
}
