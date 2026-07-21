/**
 * The Bimax ACP agent: bridges Agent Client Protocol requests to Bimax's turn engine.
 *
 * This is the ACP counterpart of ProtocolHost (host.ts). Where ProtocolHost forwards Bimax's
 * `cliEvents` over Bimax's own wire protocol, this forwards them as ACP `session/update`
 * notifications, and maps inbound ACP methods (initialize / session-new / session-prompt /
 * session-cancel) onto a session driver. Tool-approval prompts (`veto_prompt`) are bridged to ACP's
 * `session/request_permission` so approvals render natively in the editor.
 *
 * The engine coupling is behind {@link AcpSessionDriver} so the whole bridge is unit-testable with a
 * fake driver + a plain EventEmitter — no LLM, no bootstrap. The live driver (backed by
 * HeadlessSession) is wired in the ACP entry point (Phase 2b).
 */

import { EventEmitter } from 'events';
import { JsonRpcConnection } from './jsonrpc';
import {
  ACP_PROTOCOL_VERSION, AgentMethod, ClientMethod,
  InitializeParams, InitializeResult, NewSessionParams, NewSessionResult,
  PromptParams, PromptResult, CancelParams, StopReason, McpServerConfig,
  RequestPermissionParams, RequestPermissionResult,
  promptText, agentMessageChunk,
} from './types';

/** Engine abstraction the agent drives. Backed by HeadlessSession in production, a fake in tests. */
export interface AcpSessionDriver {
  /** The engine event seam (Bimax's `cliEvents`) — the agent streams its events as updates. */
  readonly events: EventEmitter;
  /** Prepare a session for `cwd`; return its id. */
  newSession(params: { cwd: string; mcpServers?: McpServerConfig[] }): Promise<string> | string;
  /** Run ONE prompt turn to completion; resolve with a StopReason. Must honor `signal` for cancel. */
  prompt(sessionId: string, text: string, signal: AbortSignal): Promise<StopReason>;
  /** Cancel the in-flight turn for `sessionId` (no-op if idle). */
  cancel(sessionId: string): void;
  /** Optional: resume a previously-saved session. */
  loadSession?(params: { sessionId: string; cwd: string; mcpServers?: McpServerConfig[] }): Promise<void> | void;
}

export interface AcpAgentOptions {
  /** Advertised in `initialize`; defaults to loadSession only when the driver implements it. */
  capabilities?: InitializeResult['agentCapabilities'];
  /** Auth methods to advertise; default [] (no auth required). */
  authMethods?: InitializeResult['authMethods'];
}

export class AcpAgent {
  /** The session currently streaming, so global cliEvents route to the right sessionId. */
  private activeSessionId: string | null = null;
  private activeAbort: AbortController | null = null;
  /** Detach fns for the cliEvents listeners bound for the active turn. */
  private turnListeners: Array<() => void> = [];

  constructor(
    private readonly conn: JsonRpcConnection,
    private readonly driver: AcpSessionDriver,
    private readonly opts: AcpAgentOptions = {},
  ) {
    conn.on(AgentMethod.Initialize, (p) => this.onInitialize(p));
    conn.on(AgentMethod.Authenticate, () => null); // no auth required → accept and return null
    conn.on(AgentMethod.NewSession, (p) => this.onNewSession(p));
    conn.on(AgentMethod.LoadSession, (p) => this.onLoadSession(p));
    conn.on(AgentMethod.Prompt, (p) => this.onPrompt(p));
    conn.on(AgentMethod.Cancel, (p) => this.onCancel(p)); // notification
  }

  // ---- agent methods --------------------------------------------------------------------------

  private onInitialize(params: InitializeParams): InitializeResult {
    // Negotiate the protocol version: never claim newer than the client offered.
    const version = Math.min(ACP_PROTOCOL_VERSION, params?.protocolVersion ?? ACP_PROTOCOL_VERSION);
    return {
      protocolVersion: version,
      agentCapabilities:
        this.opts.capabilities ?? {
          loadSession: typeof this.driver.loadSession === 'function',
          promptCapabilities: { image: true, embeddedContext: true },
        },
      authMethods: this.opts.authMethods ?? [],
    };
  }

  private async onNewSession(params: NewSessionParams): Promise<NewSessionResult> {
    const sessionId = await this.driver.newSession({ cwd: params?.cwd ?? process.cwd(), mcpServers: params?.mcpServers });
    return { sessionId };
  }

  private async onLoadSession(params: { sessionId: string; cwd: string; mcpServers?: McpServerConfig[] }): Promise<null> {
    if (this.driver.loadSession) await this.driver.loadSession(params);
    return null;
  }

  private async onPrompt(params: PromptParams): Promise<PromptResult> {
    const sessionId = params?.sessionId;
    const text = promptText(params?.prompt ?? []);
    const abort = new AbortController();
    this.activeSessionId = sessionId;
    this.activeAbort = abort;
    this.bindTurnStreaming(sessionId);
    try {
      const stopReason = await this.driver.prompt(sessionId, text, abort.signal);
      // A cancel() flips the reason even if the driver reports a natural end.
      return { stopReason: abort.signal.aborted ? 'cancelled' : stopReason };
    } catch (err) {
      // Surface the failure as a final message chunk, then end the turn (don't reject the whole RPC —
      // ACP models a failed turn as end_turn/refusal with the error streamed, not a transport error).
      this.conn.notify(ClientMethod.SessionUpdate, agentMessageChunk(sessionId, `⚠ ${err instanceof Error ? err.message : String(err)}`));
      return { stopReason: 'refusal' };
    } finally {
      this.unbindTurnStreaming();
      this.activeSessionId = null;
      this.activeAbort = null;
    }
  }

  private onCancel(params: CancelParams): void {
    // session/cancel is a notification: abort the turn; onPrompt returns stopReason 'cancelled'.
    if (this.activeSessionId && params?.sessionId === this.activeSessionId) {
      this.activeAbort?.abort();
      this.driver.cancel(this.activeSessionId);
    }
  }

  // ---- streaming: cliEvents → session/update --------------------------------------------------

  /** Bind cliEvents listeners for the duration of one turn, routing to `sessionId`. */
  private bindTurnStreaming(sessionId: string): void {
    const events = this.driver.events;

    // Streamed answer tokens → agent_message_chunk (the incremental assistant text).
    const onToken = (token: string) => {
      if (typeof token === 'string' && token.length) {
        this.conn.notify(ClientMethod.SessionUpdate, agentMessageChunk(sessionId, token));
      }
    };
    events.on('stream_token', onToken);
    this.turnListeners.push(() => events.off('stream_token', onToken));

    // System messages (errors, ledger notes, governor vetoes) → a message chunk so they aren't lost.
    // Assistant 'message' events are the aggregate of already-streamed tokens, so they are skipped to
    // avoid duplicating the answer.
    const onMessage = (m: any) => {
      if (m?.role === 'system' && typeof m.content === 'string' && m.content.trim()) {
        this.conn.notify(ClientMethod.SessionUpdate, agentMessageChunk(sessionId, m.content));
      }
    };
    events.on('message', onMessage);
    this.turnListeners.push(() => events.off('message', onMessage));

    // Tool-approval gate: veto_prompt(question, options, resolve) → session/request_permission.
    const onVeto = (question: string, options: string[], resolve: (a: string) => void) => {
      void this.requestPermission(sessionId, question, options || [])
        .then(resolve)
        .catch(() => resolve('')); // editor gone / declined → empty answer (engine treats as deny)
    };
    events.on('veto_prompt', onVeto);
    this.turnListeners.push(() => events.off('veto_prompt', onVeto));
  }

  private unbindTurnStreaming(): void {
    for (const off of this.turnListeners.splice(0)) {
      try { off(); } catch { /* detach is best-effort */ }
    }
  }

  /** Ask the editor to approve a tool call; resolve with the chosen option string (or '' on cancel). */
  private async requestPermission(sessionId: string, title: string, options: string[]): Promise<string> {
    const params: RequestPermissionParams = {
      sessionId,
      toolCall: { toolCallId: `perm-${Date.now()}`, title },
      options: options.map((name) => ({
        optionId: name,
        name,
        kind: /^(reject|deny|no|cancel)/i.test(name) ? 'reject_once' : 'allow_once',
      })),
    };
    const res = await this.conn.request<RequestPermissionResult>(ClientMethod.RequestPermission, params);
    if (res?.outcome?.outcome === 'selected') return res.outcome.optionId;
    return ''; // cancelled
  }
}
