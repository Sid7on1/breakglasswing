import { EventEmitter } from 'events';
import {
  Outbound, Inbound, ReplyMsg, CompletionItem,
  FORWARDED_EVENTS, PROMPT_EVENT, DIFF_PROMPT_EVENT, PROTOCOL_VERSION, sanitizeArgs,
} from './protocol';

export interface HostHandlers {
  /** A submitted prompt line (user turn or slash command) arrived from the front-end. */
  onInput?: (text: string) => void;
  /** The front-end asked to cancel the in-flight turn. */
  onInterrupt?: () => void;
  /** The front-end asked for autocomplete candidates for the current input. */
  onQuery?: (text: string) => CompletionItem[] | Promise<CompletionItem[]>;
}

/**
 * Engine-side endpoint of the UI protocol. It bridges the in-process `cliEvents` emitter +
 * GlobalPrompter approval round-trip to an out-of-process front-end, transport-agnostically:
 * you give it a `write` sink (stdout, a socket, a test buffer) and feed it inbound lines.
 *
 *   • Forwarded events  → serialized as `event` messages.
 *   • `veto_prompt`      → translated to a `request`; its in-process resolve callback is held in
 *                          a pending map and fired when the matching `reply` returns.
 *   • inbound `input`    → routed to handlers.onInput (the engine's existing dispatch).
 *
 * Nothing here touches Ink: attaching the host adds listeners; the in-process appStore bridge in
 * events.ts keeps working untouched, so the two front-ends are interchangeable, not exclusive.
 */
export class ProtocolHost {
  private emitter: EventEmitter | null = null;
  private listeners: Array<{ event: string; fn: (...a: any[]) => void }> = [];
  private pending = new Map<number, (answer: string) => void>();
  private nextRequestId = 1;

  constructor(
    private write: (line: Outbound) => void,
    private handlers: HostHandlers = {},
  ) {}

  /** Subscribe to the engine's event seam and emit the handshake. */
  attach(emitter: EventEmitter): void {
    if (this.emitter) throw new Error('[ProtocolHost] already attached');
    this.emitter = emitter;

    for (const name of FORWARDED_EVENTS) {
      const fn = (...args: any[]) => this.write({ t: 'event', name, args: sanitizeArgs(args) });
      emitter.on(name, fn);
      this.listeners.push({ event: name, fn });
    }

    // veto_prompt(question, options, resolve, isAsk?) — the one event carrying a callback.
    const promptFn = (question: string, options: string[], resolve: (a: string) => void, isAsk?: boolean) => {
      const id = this.nextRequestId++;
      this.pending.set(id, resolve);
      this.write({ t: 'request', id, kind: 'prompt', question, options: options || [], isAsk: !!isAsk });
    };
    emitter.on(PROMPT_EVENT, promptFn);
    this.listeners.push({ event: PROMPT_EVENT, fn: promptFn });

    // diff_prompt(summary, diff, resolve) — the inline diff-approval gate. Same request/reply
    // mechanism as veto_prompt, but carries the diff body for the front-end to render.
    const diffFn = (summary: string, diff: string, resolve: (a: string) => void) => {
      const id = this.nextRequestId++;
      this.pending.set(id, resolve);
      this.write({ t: 'request', id, kind: 'diff', question: summary, options: ['Approve', 'Reject'], body: diff });
    };
    emitter.on(DIFF_PROMPT_EVENT, diffFn);
    this.listeners.push({ event: DIFF_PROMPT_EVENT, fn: diffFn });

    this.write({ t: 'ready', protocol: PROTOCOL_VERSION });
  }

  /** Route one decoded inbound message. Unknown / stale messages are ignored, never thrown. */
  ingest(msg: Inbound): void {
    switch (msg.t) {
      case 'reply': {
        const { id, value } = msg as ReplyMsg;
        const resolve = this.pending.get(id);
        if (resolve) { this.pending.delete(id); resolve(value); }
        return; // a reply with no pending id is a late/duplicate answer — drop it
      }
      case 'input':
        this.handlers.onInput?.(msg.text);
        return;
      case 'interrupt':
        this.handlers.onInterrupt?.();
        return;
      case 'query': {
        const { id, text } = msg;
        Promise.resolve(this.handlers.onQuery?.(text) ?? [])
          .then(items => this.write({ t: 'queryResult', id, items }))
          .catch(() => this.write({ t: 'queryResult', id, items: [] }));
        return;
      }
    }
  }

  /** Number of approval requests still awaiting an answer (for diagnostics / tests). */
  pendingCount(): number { return this.pending.size; }

  /** Remove all listeners. Any unanswered prompts are resolved empty so the engine doesn't hang. */
  detach(): void {
    if (this.emitter) {
      for (const { event, fn } of this.listeners) this.emitter.off(event, fn);
    }
    this.listeners = [];
    this.emitter = null;
    for (const resolve of this.pending.values()) {
      try { resolve(''); } catch { /* ignore */ }
    }
    this.pending.clear();
  }
}
