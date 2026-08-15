import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/** Desktop-owned, loopback-only authority for moving focus away from and back to Bimax. */

export interface FocusActivationBrokerHandle {
  endpoint: string;
  token: string;
  close(): Promise<void>;
}

export interface FocusActivationBrokerOptions {
  bimaxPid: number;
  isBimaxFocused: () => boolean;
  activateBundle: (bundleId: string, pid: number) => Promise<boolean>;
}

export interface FocusActivationRequest {
  version: 1;
  token: string;
  requestId: string;
  targetPid: number;
  targetBundleId: string;
  expiresAtMs: number;
}

export type FocusActivationCode =
  | 'accepted'
  | 'invalid_request'
  | 'bimax_not_frontmost'
  | 'return_grant_required'
  | 'activation_failed';

export interface FocusActivationResponse { accepted: boolean; code: FocusActivationCode }

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const BUNDLE_ID = /^[A-Za-z0-9.-]{3,255}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const MAX_LEASE_MS = 5_000;
const RETURN_GRANT_MS = 60_000;
const MAX_BODY_BYTES = 8 * 1024;

function tokenMatches(expected: string, candidate: unknown): boolean {
  if (typeof candidate !== 'string' || !TOKEN.test(candidate)) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The authorization state machine is separate from HTTP so replay, expiry, and return grants are
 * deterministic under test. Leaving Bimax requires it to be frontmost. That accepted departure
 * mints one 60-second return grant, consumed when the exact Bimax PID is restored.
 */
export class FocusActivationArbiter {
  private seen = new Map<string, number>();
  private returnGrantUntil = 0;

  constructor(
    private readonly token: string,
    private readonly options: FocusActivationBrokerOptions & { now?: () => number },
  ) {}

  async handle(raw: FocusActivationRequest): Promise<FocusActivationResponse> {
    const now = this.options.now?.() ?? Date.now();
    for (const [id, expires] of this.seen) if (expires < now) this.seen.delete(id);

    if (!raw || raw.version !== 1
      || !tokenMatches(this.token, raw.token)
      || !REQUEST_ID.test(String(raw.requestId || ''))
      || !Number.isSafeInteger(raw.targetPid) || raw.targetPid <= 0
      || !BUNDLE_ID.test(String(raw.targetBundleId || ''))
      || !Number.isFinite(raw.expiresAtMs)
      || raw.expiresAtMs < now || raw.expiresAtMs > now + MAX_LEASE_MS
      || this.seen.has(raw.requestId)) {
      return { accepted: false, code: 'invalid_request' };
    }
    const returning = raw.targetPid === this.options.bimaxPid;
    if (returning) {
      if (this.returnGrantUntil < now) return { accepted: false, code: 'return_grant_required' };
      this.returnGrantUntil = 0;
    } else {
      if (!this.options.isBimaxFocused()) return { accepted: false, code: 'bimax_not_frontmost' };
      this.returnGrantUntil = now + RETURN_GRANT_MS;
    }

    this.seen.set(raw.requestId, raw.expiresAtMs);
    try {
      const activated = await this.options.activateBundle(raw.targetBundleId, raw.targetPid);
      return activated
        ? { accepted: true, code: 'accepted' }
        : { accepted: false, code: 'activation_failed' };
    } catch {
      return { accepted: false, code: 'activation_failed' };
    }
  }
}

export async function startFocusActivationBroker(
  options: FocusActivationBrokerOptions,
): Promise<FocusActivationBrokerHandle> {
  const token = randomBytes(32).toString('hex');
  const arbiter = new FocusActivationArbiter(token, options);
  let server: Server;

  server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (request.method !== 'POST' || request.url !== '/v1/focus/activate') {
      response.statusCode = 404;
      response.end(JSON.stringify({ accepted: false, code: 'invalid_request' }));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > MAX_BODY_BYTES) return;
      let body: FocusActivationRequest;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as FocusActivationRequest; }
      catch {
        response.statusCode = 400;
        response.end(JSON.stringify({ accepted: false, code: 'invalid_request' }));
        return;
      }
      void arbiter.handle(body).then((result) => {
        response.statusCode = 200;
        response.end(JSON.stringify(result));
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('focus broker did not receive a loopback port');
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/focus/activate`,
    token,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Invoke the staged native helper without a shell or caller-controlled arguments. */
export function launchExactProcessWithNativeHelper(
  activatorBinary: string,
  bundleId: string,
  pid: number,
  _hidePid?: number,
): Promise<boolean> {
  if (!activatorBinary || !BUNDLE_ID.test(bundleId) || !Number.isSafeInteger(pid) || pid <= 0) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    execFile(
      activatorBinary,
      ['--request-front-process', String(pid), bundleId],
      { timeout: 3_000, maxBuffer: 64 * 1024 },
      (error) => resolve(!error),
    );
  });
}
