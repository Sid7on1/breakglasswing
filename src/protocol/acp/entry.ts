import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';
import { cliEvents } from '../../cli/events';
import { buildPersonas } from '../../cli/personas/factory';
import { saveConfig } from '../../cli/config';
import { HeadlessSession } from '../headless.session';
import { JsonRpcConnection, LineBuffer } from './jsonrpc';
import { AcpAgent, AcpSessionDriver } from './agent';
import { StopReason, McpServerConfig } from './types';
// Register every slash command for its side effect (self-registration on import) — otherwise a
// prompt like "/help" typed in the editor falls through as "Unknown command", same as headless.
import '../../cli/commands';

/**
 * Live ACP session driver: maps the protocol's session lifecycle onto a single HeadlessSession.
 *
 * Bimax's engine is effectively one global session per process (the agent loop, cliEvents, personas
 * are singletons), so `newSession` returns a fresh id and points the engine at the editor's cwd;
 * `prompt` drives one turn to completion via `dispatch`; `cancel` interrupts it. The event seam is
 * the global cliEvents emitter the AcpAgent streams as session/update notifications.
 */
export class HeadlessAcpDriver implements AcpSessionDriver {
  readonly events = cliEvents;
  private counter = 0;

  constructor(private readonly session: HeadlessSession) {}

  newSession(params: { cwd: string; mcpServers?: McpServerConfig[] }): string {
    // Honor the editor's workspace root so @-mentions, indexing, and tool paths resolve there. Only
    // chdir when the turn engine is idle and the path is a real directory — never mid-turn.
    if (params?.cwd && !this.session.isBusy) {
      try { if (fs.existsSync(params.cwd) && fs.statSync(params.cwd).isDirectory()) process.chdir(params.cwd); } catch { /* keep current cwd */ }
    }
    return `bimax-acp-${Date.now()}-${++this.counter}`;
  }

  async prompt(_sessionId: string, text: string, signal: AbortSignal): Promise<StopReason> {
    if (signal.aborted) return 'cancelled';
    // Bridge the ACP abort to the engine's cooperative interrupt for the duration of the turn.
    const onAbort = () => this.session.interrupt();
    signal.addEventListener('abort', onAbort);
    try {
      await this.session.dispatch(text); // resolves when the turn (or slash command) fully completes
      return signal.aborted ? 'cancelled' : 'end_turn';
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  cancel(_sessionId: string): void {
    this.session.interrupt();
  }
}

/**
 * Run Bimax as an ACP agent over stdio: newline-delimited JSON-RPC on stdin/stdout, so an editor
 * (Zed and other ACP clients) can embed the full Bimax engine. The counterpart of startHeadless,
 * but speaking ACP instead of Bimax's own NDJSON protocol. Activated by `BIMAX_ACP=1` / `--acp`.
 *
 * stdout carries ONLY protocol frames — console was redirected to a boot buffer in index.ts and is
 * never restored on this path, so nothing pollutes the JSON-RPC stream. Resolves when stdin closes.
 */
export async function startAcpAgent(container: any, _config: any): Promise<void> {
  const { toolRegistry, llmAdapter, governor, graphStore, codebaseIndexer } = container;

  // Persist the thread and fold in approvals/evidence/outcomes exactly as headless does, so tools,
  // /sessions, and the review domain behave identically inside the editor. These track state only;
  // the headless auto-continuation / recovery / heartbeat timers are intentionally NOT started —
  // an editor session is turn-driven, not autonomously self-continuing.
  const { startSessionRecorder } = require('../../cli/session.recorder');
  const sessionRecorder = startSessionRecorder();
  const { startReviewManager } = require('../../review/review.manager');
  const reviewManager = startReviewManager();
  const { startOutcomeManager } = require('../../outcome/outcome.manager');
  const outcomeManager = startOutcomeManager();

  const options = {
    toolRegistry,
    llmAdapter,
    governor,
    maxToolIterations: _config?.maxToolIterations,
    notificationBell: _config?.notificationBell,
    persona: null,
  };
  const personas = buildPersonas(toolRegistry, llmAdapter);
  const session = new HeadlessSession({ personas, options, graphStore, codebaseIndexer, saveConfig });

  // Inline diff-approval over ACP: a mutating tool's diff is surfaced as a veto_prompt, which the
  // AcpAgent bridges to session/request_permission so the editor renders the approval natively.
  const { registerDiffApprover } = require('../../cli/diffApproval');
  registerDiffApprover((summary: string, diff: string) => new Promise<boolean>((resolve) => {
    cliEvents.emit('veto_prompt', summary, ['Approve', 'Reject'], (answer: string) => resolve(/^(a|y|approve|accept)/i.test(answer)), false);
    void diff; // the diff body rides the summary for now; a richer ACP tool_call_update can carry it later
  }));

  // Wire the JSON-RPC connection to real stdio. stdout gets one frame per line.
  const conn = new JsonRpcConnection(
    (line) => { try { process.stdout.write(line + '\n'); } catch { /* editor gone */ } },
    (err) => { try { process.stderr.write(`[acp] ${err.message}\n`); } catch { /* ignore */ } },
  );
  const driver = new HeadlessAcpDriver(session);
  new AcpAgent(conn, driver);

  // stdin → line-buffered frames. StringDecoder guards against a multibyte char split across chunks.
  const buffer = new LineBuffer();
  const utf8 = new StringDecoder('utf8');
  const onData = (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : utf8.write(chunk);
    for (const line of buffer.push(text)) conn.handleLine(line);
  };
  process.stdin.on('data', onData);
  if (typeof process.stdin.resume === 'function') process.stdin.resume();

  await new Promise<void>((resolve) => {
    let done = false;
    const shutdown = () => {
      if (done) return;
      done = true;
      process.stdin.off('data', onData);
      const tail = buffer.flush();
      if (tail) conn.handleLine(tail); // process a final unterminated frame at EOF
      conn.close();
      try { outcomeManager.shutdown(); } catch { /* best-effort */ }
      try { reviewManager.shutdown(); } catch { /* best-effort */ }
      try { sessionRecorder.shutdown(); } catch { /* best-effort */ }
      resolve();
    };
    cliEvents.once('shutdown', shutdown);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    process.stdin.once('end', shutdown);
    process.stdin.once('close', shutdown);
  });
}
