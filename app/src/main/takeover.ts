import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * The user takeover latch, owned by Electron main.
 *
 * `08_ACCEPTANCE_GATES.md` requires that "pause/takeover prevents all agent input until explicit
 * resume", and `15_PHASE4_DESKTOP_CAPABILITY_RECORD.md` records that Phase 5 must expose the
 * user-facing control for it. The latch itself is NOT new: `capabilities/mac/native.input.interlock.ts`
 * already refuses native mutations while paused. What was missing was an owner the *user* can
 * reach — the interlock is process-global inside the provider, which is a grandchild of this
 * process (main → engine → MCP provider) and has no inbound channel of its own.
 *
 * So this module makes Electron main the single authority and the provider's interlock its mirror:
 *
 *   renderer  --IPC-->  main (this state)  <--loopback+token--  mac capability provider
 *
 * The transport is deliberately the same shape as `focus-broker.ts`: an ephemeral 127.0.0.1 port,
 * a 32-byte token handed to the provider through its own descriptor environment, and nothing
 * listening on a public interface. The renderer never sees the endpoint or the token.
 *
 * Electron-free by design so the whole policy is unit-testable.
 */

const MAX_BODY_BYTES = 2 * 1024;
const REASON_MAX = 200;

export type TakeoverActor = 'user' | 'system';

export interface TakeoverState {
  paused: boolean;
  /** Monotonic; a mirror that has not seen this generation must not act. */
  generation: number;
  reason: string;
  actor: TakeoverActor;
  changedAtMs: number;
}

export interface TakeoverStateInput {
  paused: boolean;
  reason?: unknown;
  actor?: unknown;
}

/**
 * Authoritative pause state.
 *
 * `set` is idempotent in *value* but not in generation: re-pausing while already paused does not
 * bump the generation, so a mirror cannot be made stale by repeated clicks. A real transition
 * always bumps it.
 */
export class UserTakeoverAuthority {
  private value: TakeoverState;

  public constructor(private readonly now: () => number = Date.now) {
    this.value = { paused: false, generation: 0, reason: '', actor: 'system', changedAtMs: 0 };
  }

  public state(): TakeoverState {
    return { ...this.value };
  }

  public set(input: TakeoverStateInput): TakeoverState {
    const paused = input.paused === true;
    if (paused === this.value.paused) return this.state();
    const rawReason = typeof input.reason === 'string' ? input.reason.trim() : '';
    this.value = {
      paused,
      generation: this.value.generation + 1,
      reason: paused ? (rawReason.slice(0, REASON_MAX) || 'You took control') : '',
      actor: input.actor === 'system' ? 'system' : 'user',
      changedAtMs: this.now(),
    };
    return this.state();
  }
}

/** Validate a renderer-supplied takeover payload. Returns null when the payload is not one. */
export function parseTakeoverRequest(raw: unknown): TakeoverStateInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const request = raw as { paused?: unknown; reason?: unknown; actor?: unknown };
  if (typeof request.paused !== 'boolean') return null;
  if (request.reason !== undefined && typeof request.reason !== 'string') return null;
  if (request.actor !== undefined && request.actor !== 'user' && request.actor !== 'system') return null;
  return { paused: request.paused, reason: request.reason, actor: request.actor };
}

export interface TakeoverBrokerHandle {
  endpoint: string;
  token: string;
  close: () => Promise<void>;
}

/**
 * Serve the authority to the provider over loopback.
 *
 * Read-only by design: the provider may ask what the user decided, and may never change it. A
 * capability process that could clear its own takeover latch would make the control decorative.
 */
export async function startUserTakeoverBroker(
  authority: UserTakeoverAuthority,
): Promise<TakeoverBrokerHandle> {
  const token = randomBytes(32).toString('hex');
  const server = createServer((request, response) => void handleHttp(request, response, authority, token));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('takeover broker did not bind a TCP port');
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/takeover/state`,
    token,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function handleHttp(
  request: IncomingMessage,
  response: ServerResponse,
  authority: UserTakeoverAuthority,
  token: string,
): Promise<void> {
  response.setHeader('content-type', 'application/json');
  if (request.method !== 'POST' || request.url !== '/v1/takeover/state') {
    write(response, 404, { ok: false, code: 'not_found' });
    request.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > MAX_BODY_BYTES) {
      write(response, 413, { ok: false, code: 'request_too_large' });
      request.destroy();
      return;
    }
    chunks.push(data);
  }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    write(response, 400, { ok: false, code: 'invalid_json' });
    return;
  }
  const supplied = (raw as { token?: unknown } | null)?.token;
  if (typeof supplied !== 'string' || !sameToken(supplied, token)) {
    write(response, 403, { ok: false, code: 'invalid_token' });
    return;
  }
  write(response, 200, { ok: true, code: 'state', state: authority.state() });
}

function write(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function sameToken(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
