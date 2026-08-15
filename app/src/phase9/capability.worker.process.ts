import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

/**
 * Phase 9 / V29B / S29-C — Desktop-owned out-of-process capability transport.
 *
 * The executable path is resolved and digest-verified by the package transaction before this class
 * is constructed. This transport never invokes a shell, never inherits the parent environment, and
 * accepts only the fixed NDJSON protocol below. It is structurally compatible with the engine's
 * `CapabilityWorker` interface while keeping process ownership inside Bimax for Mac.
 */

export const PROCESS_WORKER_PROTOCOL = 'bimax-capability/1' as const;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING = 128;

interface WorkerResponse {
  t: 'result';
  id: string;
  ok: boolean;
  output?: string;
  error?: string;
  observed?: {
    reads?: string[]; writes?: string[]; hosts?: string[]; processes?: string[];
  };
  taint?: string[];
}

interface PendingCall {
  resolve(value: { output: string; observed?: WorkerResponse['observed']; taint?: string[] }): void;
  reject(error: Error): void;
  cleanup: () => void;
}

export interface ProcessCapabilityWorkerOptions {
  command: string;
  args?: string[];
  cwd: string;
  contentDigest: string;
  /** Minimal named values approved by the capability manifest; parent env is never inherited. */
  env?: Record<string, string>;
  now?: () => number;
}

export class ProcessCapabilityWorker {
  readonly protocol = PROCESS_WORKER_PROTOCOL;
  readonly contentDigest: string;

  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, PendingCall>();
  private sequence = 0;
  private disposed = false;

  constructor(private readonly options: ProcessCapabilityWorkerOptions) {
    this.contentDigest = options.contentDigest;
  }

  async invoke(action: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{
    output: string;
    observed?: WorkerResponse['observed'];
    taint?: string[];
  }> {
    if (this.disposed) throw new Error('capability worker is disposed');
    if (!/^[a-z][a-z0-9._-]{0,79}$/i.test(action)) throw new Error('invalid capability action');
    if (signal.aborted) throw new Error('capability call cancelled');
    if (this.pending.size >= MAX_PENDING) throw new Error('capability worker pending-call limit exceeded');
    await this.ensureReady();
    // The worker handshake is asynchronous. Cancellation that arrives during it must not be lost.
    if (signal.aborted) throw new Error('capability call cancelled');
    const child = this.child;
    if (!child?.stdin.writable) throw new Error('capability worker is unavailable');
    const id = `call-${++this.sequence}`;
    const frame = JSON.stringify({ t: 'invoke', id, action, args });
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) throw new Error('capability request exceeds frame limit');
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.write({ t: 'cancel', id });
        const call = this.pending.get(id);
        if (!call) return;
        this.pending.delete(id);
        call.cleanup();
        reject(new Error('capability call cancelled'));
      };
      this.pending.set(id, { resolve, reject, cleanup: () => signal.removeEventListener('abort', onAbort) });
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        child.stdin.write(`${frame}\n`);
      } catch (error) {
        this.pending.delete(id);
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.failAll(new Error('capability worker disposed'));
    this.lines?.close();
    this.lines = null;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGTERM');
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: {
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          LANG: 'en_US.UTF-8',
          ...this.options.env,
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      let settled = false;
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-4096).replace(/[\r\n]+/g, ' ');
      });
      this.lines = createInterface({ input: child.stdout });
      this.lines.on('line', (line) => {
        if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
          this.protocolFailure(new Error('capability worker frame exceeds limit'));
          return;
        }
        let frame: unknown;
        try { frame = JSON.parse(line); }
        catch { this.protocolFailure(new Error('capability worker emitted malformed JSON')); return; }
        if (!settled) {
          const hello = frame as { t?: unknown; protocol?: unknown; contentDigest?: unknown };
          if (hello.t !== 'hello' || hello.protocol !== this.protocol || hello.contentDigest !== this.contentDigest) {
            settled = true;
            reject(new Error('capability worker identity or protocol mismatch'));
            this.protocolFailure(new Error('capability worker identity or protocol mismatch'));
            return;
          }
          settled = true;
          resolve();
          return;
        }
        this.handleFrame(frame);
      });
      child.once('error', (error) => {
        if (!settled) { settled = true; reject(error); }
        this.failAll(error);
      });
      child.once('exit', (code, signal) => {
        const error = new Error(`capability worker exited (${signal ?? code ?? 'unknown'})${stderr ? `: ${stderr}` : ''}`);
        if (!settled) { settled = true; reject(error); }
        this.failAll(error);
        this.child = null;
        this.ready = null;
      });
    });
    return this.ready;
  }

  private handleFrame(frame: unknown): void {
    const response = frame as Partial<WorkerResponse>;
    if (response.t !== 'result' || typeof response.id !== 'string' || typeof response.ok !== 'boolean') {
      this.protocolFailure(new Error('capability worker emitted an invalid result frame'));
      return;
    }
    const call = this.pending.get(response.id);
    if (!call) return;
    this.pending.delete(response.id);
    call.cleanup();
    if (!response.ok) {
      call.reject(new Error(String(response.error || 'capability action failed').slice(0, 1024)));
      return;
    }
    const output = String(response.output ?? '');
    if (Buffer.byteLength(output) > MAX_FRAME_BYTES) {
      call.reject(new Error('capability output exceeds frame limit'));
      return;
    }
    call.resolve({ output, ...(response.observed ? { observed: response.observed } : {}), ...(response.taint ? { taint: response.taint } : {}) });
  }

  private write(frame: Record<string, unknown>): void {
    try { if (this.child?.stdin.writable) this.child.stdin.write(`${JSON.stringify(frame)}\n`); }
    catch { /* cancellation is best-effort; local rejection already happened */ }
  }

  private protocolFailure(error: Error): void {
    this.failAll(error);
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child && !child.killed) child.kill('SIGKILL');
  }

  private failAll(error: Error): void {
    for (const call of this.pending.values()) {
      call.cleanup();
      call.reject(error);
    }
    this.pending.clear();
  }
}
