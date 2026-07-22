import * as fs from 'fs';
import { openClient, isDeadConnectionError } from '../mcp/client';
import { withTimeout } from '../utils/withTimeout';
import { cliEvents } from '../cli/events';
import { loadConfig } from '../cli/config';

/**
 * Driver transport for the embedded native sidecar (Bimax Computer Use).
 *
 * This is the ONE place a sidecar RPC can happen: the runtime's action orchestration never touches
 * the MCP client directly — it goes through {@link SidecarTransportPort.call}. Keeping the
 * transport behind an explicit interface separates "how bytes reach the driver" (spawn, handshake,
 * timeouts, dead-connection teardown, heartbeat) from "what the action means" (desktop.runtime.ts).
 */
export interface SidecarTransportPort {
  /** Is the sidecar binary configured and present? (No spawn — a pure filesystem check.) */
  available(): boolean;
  /** One RPC to the sidecar; spawns/handshakes lazily on first use. */
  call(name: string, args?: Record<string, unknown>): Promise<any>;
  /** Start the lazy cold-start now so boot time overlaps with human decision time. */
  warm(): void;
  /** Watchdog view: is the sidecar connected, and how long since the last real activity? */
  health(): { connected: boolean; idleMs: number; lastActivityAt: number };
  /** End the session and close the connection. `stopRecording` finalizes any active recording. */
  dispose(opts?: { stopRecording?: boolean }): Promise<void>;
}

/** Replace upstream implementation names in anything that can reach the model or user. */
export function bimaxBrand<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/cua-driver-rs/gi, 'Bimax Computer Use')
      .replace(/cua[ -]driver/gi, 'Bimax Computer Use') as T;
  }
  if (Array.isArray(value)) return value.map(bimaxBrand) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as any).map(([k, v]) => [k, bimaxBrand(v)])) as T;
  }
  return value;
}

function mcpText(result: any): string {
  return (result?.content || [])
    .filter((part: any) => part?.type === 'text')
    .map((part: any) => String(part.text || ''))
    .join('\n');
}

function mcpStructured(result: any): any {
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  const text = mcpText(result).replace(/^✅[^\n]*\n?/, '').trim();
  try { return JSON.parse(text); } catch { return text ? { message: text } : {}; }
}

// Cold start (spawn the native sidecar + MCP handshake + start_session) and a steady-state RPC are
// different operations with different failure modes — a cold start doing real process/IPC work can
// legitimately take much longer than any single tool call. Budgeting them together made the FIRST
// gated action of a session race a clock that silently included both, so a slow-but-alive boot was
// indistinguishable from a hang. They get separate, honestly-labeled budgets.
const COLD_START_TIMEOUT_MS = 45_000;
const RPC_TIMEOUT_MS = 30_000;

export class SidecarTransport implements SidecarTransportPort {
  private clientPromise: Promise<any> | null = null;
  /** Heartbeat: updated on every sidecar call so a watchdog can spot a wedged session. */
  private lastActivityAt = Date.now();

  constructor(private readonly session: string) {}

  private driverPath(): string | null {
    const configured = process.env.BIMAX_COMPUTER_USE_DRIVER?.trim();
    return configured && fs.existsSync(configured) ? configured : null;
  }

  public available(): boolean { return this.driverPath() != null; }

  public warm(): void {
    if (this.available()) this.client().catch(() => { /* real error surfaces on the next call() */ });
  }

  public health(): { connected: boolean; idleMs: number; lastActivityAt: number } {
    return { connected: !!this.clientPromise, idleMs: Date.now() - this.lastActivityAt, lastActivityAt: this.lastActivityAt };
  }

  private async client(): Promise<any> {
    const driver = this.driverPath();
    if (!driver) throw new Error('embedded Bimax Computer Use driver is unavailable');
    if (!this.clientPromise) {
      cliEvents.emit('status', 'Starting native driver…');
      // Every teardown below is identity-guarded (clientPromise === promise): a late failure or
      // close event from a SUPERSEDED connection must never destroy its healthy replacement —
      // unconditional nulling here would strand duplicate live sidecars behind a respawn loop.
      const promise: Promise<any> = withTimeout<any>((async () => {
        const cfg = await loadConfig();
        const driverArgs = ['mcp', '--embedded', '--host-bundle-id', 'ai.bimax.cli'];
        if (cfg.computerPip !== false && process.platform === 'darwin') driverArgs.push('--experimental-pip');
        const client = await openClient({
          name: 'bimax-computer-use',
          command: driver,
          args: driverArgs,
          forceScrubEnv: true,
          env: {
            CUA_DRIVER_EMBEDDED: '1',
            CUA_DRIVER_HOST_BUNDLE_ID: 'ai.bimax.cli',
            CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
            CUA_TELEMETRY_ENABLED: '0',
          },
        });
        await client.callTool({ name: 'start_session', arguments: { session: this.session } });
        // Cursor policy follows the delivery mode. VISIBLE mode drives the ONE real macOS cursor, so
        // the sidecar overlay is hidden (never two pointers). BACKGROUND mode never moves the real
        // cursor — so the sidecar's own agent cursor is SHOWN so the user can see where the agent is
        // acting, including while they work in another window.
        const showAgentCursor = cfg.computerVisible === false;
        try {
          await client.callTool({
            name: 'set_agent_cursor_enabled',
            arguments: { enabled: showAgentCursor, cursor_id: this.session },
          });
        } catch { /* pinned driver supports this; older local overrides remain usable */ }
        return client;
      })(), COLD_START_TIMEOUT_MS, 'Bimax Computer Use driver start')
        .then(client => {
          // Detect a crashed/exited sidecar the moment it happens rather than waiting for the
          // next action to hang out a full RPC timeout before discovering the connection is dead.
          client.onclose = () => { if (this.clientPromise === promise) this.clientPromise = null; };
          cliEvents.emit('status', 'Native driver ready');
          return client;
        })
        .catch(err => {
          if (this.clientPromise === promise) this.clientPromise = null;
          throw err;
        });
      this.clientPromise = promise;
    }
    return this.clientPromise;
  }

  public async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const promise = this.client();
    const client = await promise;
    this.lastActivityAt = Date.now(); // heartbeat
    cliEvents.emit('status', `Running ${name}…`);
    const result = await withTimeout<any>(
      client.callTool({ name, arguments: args }),
      RPC_TIMEOUT_MS,
      `Bimax Computer Use '${name}'`,
    ).catch((err: any) => {
      // A wedged/crashed sidecar leaves clientPromise resolved-but-dead, and nothing else clears
      // it — but only a dead transport or our own timeout condemns the CONNECTION. An app-level
      // RPC rejection from a healthy sidecar must not cost the whole session (element caches,
      // plus a fresh cold start) on the next action.
      if (isDeadConnectionError(err) || String(err?.message || '').includes('timed out after')) {
        if (this.clientPromise === promise) this.clientPromise = null;
        // Close the condemned client: a timed-out action could otherwise still land on the
        // user's desktop later, unsupervised, and an unclosed client leaks the sidecar process.
        try { Promise.resolve(client.close?.()).catch(() => { /* best-effort teardown */ }); }
        catch { /* best-effort teardown */ }
      }
      throw err;
    });
    const data = bimaxBrand(mcpStructured(result));
    if (result?.isError) {
      const detail = bimaxBrand(mcpText(result)).trim();
      throw new Error(detail || `${name} failed`);
    }
    return data;
  }

  public async dispose(opts: { stopRecording?: boolean } = {}): Promise<void> {
    const pending = this.clientPromise;
    this.clientPromise = null;
    this.lastActivityAt = Date.now();
    if (!pending) return;
    try {
      const client = await pending;
      if (opts.stopRecording) {
        try { await client.callTool({ name: 'stop_recording', arguments: {} }); } catch { /* session teardown also finalizes */ }
      }
      await client.callTool({ name: 'end_session', arguments: { session: this.session } });
      await client.close?.();
    } catch { /* process teardown is best-effort */ }
  }
}
