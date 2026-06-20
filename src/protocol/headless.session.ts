import { cliEvents, MessageEntry } from '../cli/events';
import { AgentPersona } from '../cli/personas/base.persona';
import { routeQuery } from '../cli/agentRouter';
import { expandAtMentions, expandFileAtMentions } from '../cli/atMention';
import { globalCommandRegistry } from '../cli/commands/registry';
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

  constructor(private deps: HeadlessDeps) {}

  /** A submitted line: a slash command or a user turn. */
  async dispatch(text: string): Promise<void> {
    const query = (text || '').trim();
    if (!query) return;
    if (query.startsWith('/')) return this.runCommand(query);
    return this.runTurn(query);
  }

  private async runTurn(query: string): Promise<void> {
    if (this.busy) {
      cliEvents.emit('status', 'Busy — finish the current turn before sending another.');
      return;
    }
    this.busy = true;
    cliEvents.emit('message', this.msg('user', query));

    const active = this.deps.personas[routeQuery(query)] || this.deps.personas.bimax;
    const before = active.messages.length;
    let totalChars = 0;

    try {
      // @-mention / @file expansion is best-effort, same as the Ink path.
      let agentQuery = query;
      try { agentQuery = (await expandFileAtMentions(agentQuery, process.cwd())).text; } catch { /* best-effort */ }
      try { agentQuery = (await expandAtMentions(agentQuery, this.deps.graphStore, process.cwd())).text; } catch { /* best-effort */ }

      cliEvents.emit('spinner_state', 'thinking', 'Thinking…');
      await active.execute(
        agentQuery,
        (token: string) => { totalChars += token.length; cliEvents.emit('stream_token', token); },
        { maxIterations: this.deps.options.maxToolIterations, planMode: this.deps.options.governor?.mode === 'plan' },
      );

      const content = this.collectTurnText(active, before);
      if (content) cliEvents.emit('message', this.msg('assistant', content));
      cliEvents.emit('cost_update', totalChars);
    } catch (e: any) {
      cliEvents.emit('log', { id: Date.now(), level: 'error', text: `Agent error: ${e?.message ?? e}`, timestamp: new Date() });
    } finally {
      this.busy = false;
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
      // renders them and replies via the protocol's input/reply channel.
      setActiveMenu: (menu: any) => cliEvents.emit('message', this.uiMsg('menu', menu)),
      setActivePrompt: (prompt: any) => cliEvents.emit('message', this.uiMsg('prompt', prompt)),
      executeCommand: (cmd: string) => { void this.dispatch(cmd); },
      restoreMessages: (msgs: any[]) => {
        const active = this.deps.personas.bimax;
        if (active && Array.isArray(msgs)) active.messages = msgs as any;
      },
      getMessages: () => [],
    };

    try {
      const result = await globalCommandRegistry.execute(query, context);
      if (!result) return;
      if (result.type === 'message') cliEvents.emit('message', this.msg('system', result.content, result.level));
      else if (result.type === 'menu') cliEvents.emit('message', this.uiMsg('menu', result));
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

  /** Concatenate this turn's assistant text, stripping reasoning/tool-call scaffolding. */
  private collectTurnText(active: AgentPersona, before: number): string {
    return active.messages
      .slice(before)
      .filter((m: any) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
      .map((m: any) => m.content.trim())
      .join('\n\n')
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<tool_call>[\s\S]*/, '')
      .trim();
  }

  private msg(role: 'user' | 'assistant' | 'system', content: string, level?: string): MessageEntry {
    return { id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, level: level as any, content, timestamp: new Date() };
  }

  private uiMsg(uiComponent: string, payload: any): MessageEntry {
    return { id: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'system', uiComponent, payload, content: '', timestamp: new Date() };
  }
}
