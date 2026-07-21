/**
 * JSON-RPC 2.0 connection over a newline-delimited byte stream.
 *
 * The wire format of the Agent Client Protocol (ACP): one JSON-RPC object per line, both directions
 * multiplexed over the same stdio pipe. Modeled on Grok Build's xai-acp-lib line-buffered channel
 * (line_reader.rs / channel.rs / message.rs) — but expressed as plain JSON-RPC since ACP is an open
 * standard and Node has no borrow/atomics concerns to encode.
 *
 * This layer is transport-agnostic and Bimax-agnostic: you give it a `write(line)` sink and feed it
 * inbound lines via `handleLine`. It correlates responses to outbound requests, dispatches inbound
 * requests/notifications to registered handlers, and turns handler throws into JSON-RPC error
 * responses. What the methods MEAN is the ACP agent's job (agent.ts), not this file's.
 */

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}
export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}
export interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcError;

/** Standard JSON-RPC 2.0 error codes (plus ACP's auth-required convention). */
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** ACP: the client must call `authenticate` before this method is allowed. */
  AuthRequired: -32000,
} as const;

/** A handler error that carries a specific JSON-RPC error code back to the peer. */
export class RpcError extends Error {
  constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

/** Handles an inbound request (returns a result) or notification (return ignored). */
export type MethodHandler = (params: any) => unknown | Promise<unknown>;

export class JsonRpcConnection {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private readonly handlers = new Map<string, MethodHandler>();
  private closed = false;

  /**
   * @param write   sink for a single serialized message (a newline is appended here, so pass raw
   *                lines without one).
   * @param onError optional observer for protocol-level problems (bad JSON, unknown response id).
   */
  constructor(
    private readonly write: (line: string) => void,
    private readonly onError?: (err: Error) => void,
  ) {}

  /** Register a handler for an inbound method (request or notification). Last registration wins. */
  on(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  /** Issue a request and resolve with the peer's result (or reject with its error). */
  request<T = any>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error('connection closed'));
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(msg);
    });
  }

  /** Fire a notification (no id, no response expected). */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) };
    this.send(msg);
  }

  /** Feed one inbound line. Blank lines are ignored; malformed JSON yields a ParseError response. */
  handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.send({ jsonrpc: '2.0', id: null, error: { code: RpcErrorCode.ParseError, message: 'parse error' } });
      return;
    }
    void this.dispatch(msg);
  }

  private async dispatch(msg: any): Promise<void> {
    // Response to one of our requests (has id AND result/error, no method).
    if (msg && msg.method === undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const entry = this.pending.get(msg.id);
      if (!entry) {
        this.onError?.(new Error(`response for unknown id ${JSON.stringify(msg.id)}`));
        return;
      }
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data));
      else entry.resolve(msg.result);
      return;
    }

    // Inbound request or notification.
    if (typeof msg?.method !== 'string') {
      this.send({ jsonrpc: '2.0', id: null, error: { code: RpcErrorCode.InvalidRequest, message: 'invalid request' } });
      return;
    }
    const isRequest = msg.id !== undefined && msg.id !== null;
    const handler = this.handlers.get(msg.method);
    if (!handler) {
      // A missing handler is an error only for requests; unknown notifications are silently dropped.
      if (isRequest) {
        this.send({ jsonrpc: '2.0', id: msg.id, error: { code: RpcErrorCode.MethodNotFound, message: `method not found: ${msg.method}` } });
      }
      return;
    }
    try {
      const result = await handler(msg.params);
      if (isRequest) this.send({ jsonrpc: '2.0', id: msg.id, result: result === undefined ? null : result });
    } catch (err) {
      if (!isRequest) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const { code, message, data } =
        err instanceof RpcError
          ? { code: err.code, message: err.message, data: err.data }
          : { code: RpcErrorCode.InternalError, message: err instanceof Error ? err.message : String(err), data: undefined };
      this.send({ jsonrpc: '2.0', id: msg.id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
    }
  }

  private send(msg: JsonRpcMessage): void {
    this.write(JSON.stringify(msg));
  }

  /** Reject every in-flight request; further sends become no-ops. */
  close(reason = 'connection closed'): void {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) {
      try { reject(new Error(reason)); } catch { /* ignore */ }
    }
    this.pending.clear();
  }

  /** In-flight outbound requests awaiting a response (diagnostics/tests). */
  pendingCount(): number { return this.pending.size; }
}

/**
 * Split a byte stream into lines, buffering partial trailing data across chunks. The ACP transport
 * is newline-delimited JSON; this is the counterpart of Grok's LineBufferedRead. `push` returns the
 * complete lines available so far (without their newline); an unterminated tail is held until the
 * next chunk completes it.
 */
export class LineBuffer {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? ''; // trailing partial (or '' when chunk ended on a newline)
    return lines;
  }
  /** Any buffered, not-yet-terminated tail (e.g. a final line with no trailing newline at EOF). */
  flush(): string | null {
    const tail = this.buf;
    this.buf = '';
    return tail ? tail : null;
  }
}
