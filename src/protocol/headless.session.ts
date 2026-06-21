import { cliEvents, MessageEntry } from '../cli/events';
import { AgentPersona } from '../cli/personas/base.persona';
import { routeQuery } from '../cli/agentRouter';
import { expandAtMentions, expandFileAtMentions } from '../cli/atMention';
import { globalCommandRegistry } from '../cli/commands/registry';
import { decideTier, applyBrief, Tier } from '../cli/model.router';
import { IGraphStore } from '../graph/models';

export interface HeadlessDeps {
  personas: Record<string, AgentPersona>;
  options: any;           // the same `options` bag FullScreen receives (governor, llmAdapter, toolRegistry, …)
  graphStore: IGraphStore;
  codebaseIndexer?: any;
  saveConfig?: () => void;
}

/**
 * Drives a BiMax session with no UI — the headless counterpart to FullScreen's handleSubmit.
 * Same engine entrypoints (agent router → persona.execute, globalCommandRegistry.execute,
 * @-mention expansion), but every UI effect is replaced by a `cliEvents` emit the ProtocolHost
 * forwards over the wire. Deliberately leaner than handleSubmit: it omits Ink-only concerns
 * (autocomplete, paste chips, tier-routing UI, vision) — those belong to the front-end.
 */
export class HeadlessSession {
  private busy = false;
  // Aborts the in-flight turn when the front-end sends an interrupt. Non-null only while a turn runs.
  private turnAbort: AbortController | null = null;
  // Manual model-tier pin (the /tier command / Ctrl+T). null = automatic routing. Mirrors the
  // pinnedTierRef FullScreen keeps for the Ink path, so headless honors /tier identically.
  private pinnedTier: Tier | null = null;
  // Active interactive menus, keyed by the id sent to the front-end. Holds the option list + the
  // onSelect callback (which can't cross the wire), so a menuSelect reply can run the real handler —
  // e.g. picking a model id in /model applies it instead of dispatching the bare id as a chat turn.
  private menus = new Map<string, { options: any[]; onSelect?: (opt: any) => void }>();
  private menuSeq = 0;

  constructor(private deps: HeadlessDeps) {
    // /tier auto|lite|heavy emits set_tier; apply the pin and reflect it in the footer, exactly as
    // FullScreen.handleSetTier does for Ink. (set_tier is also forwarded to the front-end verbatim.)
    cliEvents.on('set_tier', (t: 'auto' | 'lite' | 'heavy') => {
      this.pinnedTier = t === 'auto' ? null : t;
      cliEvents.emit('model_tier', { tier: this.pinnedTier ?? 'lite', pinned: this.pinnedTier });
      cliEvents.emit('status', this.pinnedTier === null
        ? 'Routing → auto (lite decides, escalates as needed)'
        : `Routing pinned → ${this.pinnedTier} model`);
    });
  }

  /** A submitted line: a slash command or a user turn. */
  async dispatch(text: string): Promise<void> {
    const query = (text || '').trim();
    if (!query) return;
    if (query.startsWith('/')) return this.runCommand(query);
    return this.runTurn(query);
  }

  /**
   * Cancel the in-flight turn (the front-end's Ctrl-C / Esc). Cooperative: the agent loop stops at
   * its next safe boundary, then the `finally` in runTurn emits the idle spinner. A no-op when idle.
   */
  interrupt(): void {
    if (!this.busy || !this.turnAbort) return;
    this.turnAbort.abort();
    cliEvents.emit('status', 'Interrupting…');
  }

  private async runTurn(query: string): Promise<void> {
    if (this.busy) {
      cliEvents.emit('status', 'Busy — finish the current turn before sending another.');
      return;
    }
    this.busy = true;
    this.turnAbort = new AbortController();
    cliEvents.emit('message', this.msg('user', query));
    // Show activity IMMEDIATELY — @-mention expansion + decideTier (an LLM classifier call) below can
    // take 10-15s, during which the front-end would otherwise sit silent after the user's message.
    cliEvents.emit('spinner_state', 'thinking', 'Thinking…');

    const active = this.deps.personas[routeQuery(query)] || this.deps.personas.bimax;
    const before = active.messages.length;
    let totalChars = 0;

    try {
      // @-mention / @file expansion is best-effort, same as the Ink path.
      let agentQuery = query;
      try { agentQuery = (await expandFileAtMentions(agentQuery, process.cwd())).text; } catch { /* best-effort */ }
      try { agentQuery = (await expandAtMentions(agentQuery, this.deps.graphStore, process.cwd())).text; } catch { /* best-effort */ }

      // Model-tier routing (parity with FullScreen): lite is the default responder; escalate to the
      // heavy coding model only when the turn needs it. A manual pin wins. The footer pointer flips
      // to whichever model will actually receive this request.
      let useLite = true;
      try {
        const decision = await decideTier(this.deps.options.llmAdapter, query, this.pinnedTier);
        useLite = decision.tier === 'lite';
        cliEvents.emit('model_tier', { tier: decision.tier, pinned: this.pinnedTier });
        if (!useLite) agentQuery = applyBrief(agentQuery, decision.brief);
      } catch { /* routing is best-effort; fall back to lite */ }

      cliEvents.emit('spinner_state', 'thinking', 'Thinking…');
      // Accumulate this turn's streamed tokens directly — that IS this turn's answer, so it never
      // bleeds in a prior turn's text. (collectTurnText sliced persona.messages by a `before` index,
      // but the agent loop replaces & reindexes that array each run, so the slice could re-include the
      // previous turn's assistant message — the "first answer shown again" bug.)
      let streamed = '';
      await active.execute(
        agentQuery,
        (token: string) => { totalChars += token.length; streamed += token; cliEvents.emit('stream_token', token); },
        {
          maxIterations: this.deps.options.maxToolIterations,
          planMode: this.deps.options.governor?.mode === 'plan',
          useLite,
          signal: this.turnAbort.signal,
        },
      );

      // Prefer the streamed text; fall back to the message-slice only if nothing streamed.
      const content = this.cleanTurnText(streamed) || this.collectTurnText(active, before);
      if (content) cliEvents.emit('message', this.msg('assistant', content));
      cliEvents.emit('cost_update', totalChars);
      // Whatever partial work streamed before the interrupt is kept; tell the user it stopped early.
      if (this.turnAbort.signal.aborted) cliEvents.emit('message', this.msg('system', '⏹ Turn interrupted.'));
    } catch (e: any) {
      const detail = e?.message ?? String(e);
      // A governor veto (budget cap, denied permission, plan mode) otherwise looked like a silent
      // "no response" — only a dim log line. Surface it as a visible system message with the fix.
      if (e?.name === 'GovernorVetoError' || /budget|veto|plan mode/i.test(detail)) {
        cliEvents.emit('message', this.msg('system', `⚠ ${detail}`, 'error'));
      }
      cliEvents.emit('log', { id: Date.now(), level: 'error', text: `Agent error: ${detail}`, timestamp: new Date() });
    } finally {
      this.busy = false;
      this.turnAbort = null;
      cliEvents.emit('thinking_clear');
      cliEvents.emit('spinner_state', 'idle', 'Awaiting orders…');
    }
  }

  private async runCommand(query: string): Promise<void> {
    const context: any = {
      cwd: process.cwd(),
      options: this.deps.options,
      codebaseIndexer: this.deps.codebaseIndexer,
      graphStore: this.deps.graphStore,
      saveConfig: this.deps.saveConfig ?? (() => {}),
      addSystemMessage: (level: string, msg: string) =>
        cliEvents.emit('message', this.msg('system', msg, level)),
      // Menus / prompts are forwarded as messages carrying a uiComponent + payload; the front-end
      // renders them and replies via the protocol's menuSelect / reply channel.
      setActiveMenu: (menu: any) => this.emitMenu(menu),
      setActivePrompt: (prompt: any) => cliEvents.emit('message', this.uiMsg('prompt', prompt)),
      executeCommand: (cmd: string) => { void this.dispatch(cmd); },
      restoreMessages: (msgs: any[]) => {
        const active = this.deps.personas.bimax;
        if (active && Array.isArray(msgs)) active.messages = msgs as any;
      },
      // Return the live conversation so /cost, /save, /sessions et al. work (was stubbed to [], which
      // made those commands silently show nothing).
      getMessages: () => {
        const active = this.deps.personas.bimax;
        return active && Array.isArray(active.messages) ? active.messages : [];
      },
    };

    try {
      const result = await globalCommandRegistry.execute(query, context);
      if (!result) return;
      if (result.type === 'message') cliEvents.emit('message', this.msg('system', result.content, result.level));
      else if (result.type === 'menu') this.emitMenu(result);
      else if (result.type === 'prompt') {
        // Free-form text prompt: bridge its onResolve callback through the request/reply channel.
        const r: any = result;
        cliEvents.emit('input_prompt', r.title, (val: string) => r.onResolve?.(val));
      } else if (result.type === 'redirect') void this.dispatch(result.command);
    } catch (err: any) {
      if (!String(err?.message).includes('Unknown command')) {
        cliEvents.emit('message', this.msg('system', err?.message ?? String(err), 'error'));
      }
    }
  }

  /**
   * Emit an interactive menu to the front-end, remembering its onSelect so a later menuSelect can run
   * the real handler. The id correlates the two. Options with full-command values still work for
   * menus that have no onSelect (selectMenu falls back to dispatching the value).
   */
  private emitMenu(menu: any): void {
    const id = `menu-${++this.menuSeq}`;
    this.menus.set(id, { options: menu.options || [], onSelect: menu.onSelect });
    // Cap the registry — only the most recent few menus can realistically be selected.
    if (this.menus.size > 16) {
      const oldest = this.menus.keys().next().value;
      if (oldest) this.menus.delete(oldest);
    }
    cliEvents.emit('message', this.uiMsg('menu', {
      id,
      title: menu.title,
      options: menu.options,
      initialIndex: menu.initialIndex,
    }));
  }

  /** Run a menu option's onSelect (or dispatch its value as a command if the menu had none). */
  selectMenu(id: string, value: string): void {
    const entry = this.menus.get(id);
    if (entry?.onSelect) {
      const opt = entry.options.find((o: any) => o?.value === value) ?? { value, label: value };
      this.menus.delete(id);
      try { entry.onSelect(opt); } catch (e: any) {
        cliEvents.emit('message', this.msg('system', `Menu action failed: ${e?.message ?? e}`, 'error'));
      }
      return;
    }
    this.menus.delete(id);
    // No onSelect (or unknown menu): the value is a command/redirect — dispatch it as the user would.
    if (value) void this.dispatch(value);
  }

  /** Concatenate this turn's assistant text, stripping reasoning/tool-call scaffolding. */
  private collectTurnText(active: AgentPersona, before: number): string {
    const joined = active.messages
      .slice(before)
      .filter((m: any) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
      .map((m: any) => m.content.trim())
      .join('\n\n');
    return this.cleanTurnText(joined);
  }

  /** Strip reasoning / tool-call scaffolding from a chunk of assistant text. */
  private cleanTurnText(text: string): string {
    return (text || '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      // A still-open <tool_call> is a streaming cutoff — strip it to the end, but ONLY when a JSON
      // payload actually follows. Otherwise a literal "<tool_call>" mentioned in prose would nuke
      // the rest of a real answer (the audit's display-eating bug).
      .replace(/<tool_call>\s*[\[{][\s\S]*$/, '')
      .trim();
  }

  private msg(role: 'user' | 'assistant' | 'system', content: string, level?: string): MessageEntry {
    return { id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, level: level as any, content, timestamp: new Date() };
  }

  private uiMsg(uiComponent: string, payload: any): MessageEntry {
    return { id: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'system', uiComponent, payload, content: '', timestamp: new Date() };
  }
}
