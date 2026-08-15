/**
 * RECOVERED from the compiled `native-service/bimax-mac-capability` bundle on 2026-08-10.
 *
 * The TypeScript original was evicted by iCloud (storage full) with no git copy — this
 * directory has never been committed. Bun's `--compile` embeds the bundled JavaScript with
 * its source-path comments intact, so this is the REAL logic, not a reconstruction from
 * call sites. What the compiler erased is gone: type annotations, interfaces, and the
 * original comments. Types below were re-derived from usage and are the only part of this
 * file that is inference rather than recovery.
 *
 * Bundler artefacts to expect: identifiers may carry numeric suffixes (`crypto3`,
 * `resolve4`) from module-scope deduplication, and imports were hoisted out of this file.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { createInterface, type Interface as ReadlineInterface } from "readline";

import {
  BIMAX_CU_PROTOCOL,
  validateNativeServiceHandshake,
  type NativeServiceHandshake,
} from "./native.service.client";
import { isCompiledNativeTransaction, type CompiledNativeTransaction } from "./native.transaction.compiler";

/** One request/reply pair on the bridge's stdio line protocol. */
interface NativeServiceResponse {
  protocol?: string;
  requestId?: string;
  sessionId?: string;
  serviceVersion?: string;
  error?: { code: string; message: string; retryable?: boolean };
  body?: { op?: string; payload?: any };
}

interface NativeRequestBody {
  op: string;
  payload?: unknown;
}

var MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
var MAX_DEADLINE_MS = 30000;
export class NativeBridgeTransportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "NativeBridgeTransportError";
  }
}
export class NativeBridgeProcessPort {
  binary: string;
  child: ChildProcessWithoutNullStreams | null = null;
  lines: ReadlineInterface | null = null;
  waiter: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  tail: Promise<void> = Promise.resolve();
  constructor(binary = process.env.BIMAX_CU_BRIDGE_BINARY?.trim() || "") {
    this.binary = binary;
  }
  available() {
    return !!this.binary && existsSync(this.binary);
  }
  async exchange(line: string, timeoutMs: number): Promise<string> {
    const previous = this.tail;
    // The executor runs synchronously, so `release` is always assigned before use.
    let release!: () => void;
    this.tail = new Promise<void>((resolve4) => {
      release = resolve4;
    });
    await previous.catch(() => {});
    try {
      return await this.exchangeOnce(line, timeoutMs);
    } finally {
      release();
    }
  }
  async dispose() {
    const child = this.child;
    this.child = null;
    this.lines?.close();
    this.lines = null;
    this.waiter?.reject(new NativeBridgeTransportError("bridge_disposed", "native bridge was disposed"));
    this.waiter = null;
    if (child && child.exitCode === null)
      child.kill();
  }
  async exchangeOnce(line: string, timeoutMs: number): Promise<string> {
    if (!this.available())
      throw new NativeBridgeTransportError("bridge_unavailable", "signed native bridge is unavailable");
    if (this.waiter)
      throw new NativeBridgeTransportError("bridge_protocol_error", "native bridge already has an active request");
    const child = this.ensureChild();
    return new Promise<string>((resolve4, reject) => {
      const finish = (result: { line?: string; error?: Error }) => {
        clearTimeout(timer);
        if (this.waiter?.resolve === accept)
          this.waiter = null;
        if (result.error)
          reject(result.error);
        else
          resolve4(result.line as string);
      };
      const accept = (reply: string) => finish({ line: reply });
      this.waiter = { resolve: accept, reject: (error: Error) => finish({ error }) };
      const timer = setTimeout(() => {
        const error = new NativeBridgeTransportError("bridge_timeout", "native bridge request timed out");
        finish({ error });
        this.condemn(child, error);
      }, timeoutMs);
      child.stdin.write(`${line}
`, "utf8", (error?: Error | null) => {
        if (!error)
          return;
        const fault = new NativeBridgeTransportError("bridge_write_failed", "could not write to native bridge");
        finish({ error: fault });
        this.condemn(child, fault);
      });
    });
  }
  ensureChild() {
    if (this.child && this.child.exitCode === null)
      return this.child;
    const child = spawn(this.binary, ["--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "",
        ...process.env.BIMAX_CU_ALLOW_UNTRUSTED_CLIENT === "1" ? { BIMAX_CU_ALLOW_UNTRUSTED_CLIENT: "1" } : {}
      }
    });
    this.child = child;
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    this.lines = lines;
    lines.on("line", (line: string) => {
      if (Buffer.byteLength(line, "utf8") > MAX_ENVELOPE_BYTES) {
        this.condemn(child, new NativeBridgeTransportError("bridge_response_too_large", "native bridge response exceeds 2 MiB"));
      } else if (this.waiter) {
        this.waiter.resolve(line);
      } else {
        this.condemn(child, new NativeBridgeTransportError("bridge_protocol_error", "native bridge emitted an unsolicited response"));
      }
    });
    child.once("error", () => this.condemn(child, new NativeBridgeTransportError("bridge_spawn_failed", "could not start signed native bridge")));
    child.once("exit", () => this.condemn(child, new NativeBridgeTransportError("bridge_exited", "signed native bridge exited")));
    return child;
  }
  condemn(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.child !== child)
      return;
    this.child = null;
    this.lines?.close();
    this.lines = null;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(error);
    if (child.exitCode === null)
      child.kill();
  }
}
function validId(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !value.includes("\x00");
}
export class NativeServiceWireClient {
  port: NativeBridgeProcessPort;
  constructor(port = new NativeBridgeProcessPort) {
    this.port = port;
  }
  available() {
    return this.port.available();
  }
  async request(sessionId: string, body: NativeRequestBody, deadlineMs = 5000): Promise<NativeServiceResponse> {
    if (!validId(sessionId, 128))
      throw new NativeBridgeTransportError("invalid_session_id", "native session id is invalid");
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_DEADLINE_MS) {
      throw new NativeBridgeTransportError("invalid_deadline", "native request deadline must be 1-30000 ms");
    }
    if (!body || typeof body !== "object" || typeof body.op !== "string" || !/^[a-z]+(?:[._][a-z]+)*$/.test(body.op)) {
      throw new NativeBridgeTransportError("invalid_operation", "native operation name is invalid");
    }
    const requestId = randomUUID();
    const envelope = {
      protocol: BIMAX_CU_PROTOCOL,
      requestId,
      sessionId,
      deadlineMs,
      body: body.payload === undefined ? { op: body.op } : { op: body.op, payload: body.payload }
    };
    const line = JSON.stringify(envelope);
    if (Buffer.byteLength(line, "utf8") > MAX_ENVELOPE_BYTES) {
      throw new NativeBridgeTransportError("bridge_request_too_large", "native request exceeds 2 MiB");
    }
    const raw = await this.port.exchange(line, deadlineMs + 250);
    let reply: any;
    try {
      reply = JSON.parse(raw);
    } catch {
      throw new NativeBridgeTransportError("bridge_malformed_response", "native bridge returned invalid JSON");
    }
    if (!reply || typeof reply !== "object" || reply.requestId !== requestId) {
      throw new NativeBridgeTransportError("bridge_correlation_failed", "native bridge response did not match its request");
    }
    if (reply.error) {
      throw new NativeBridgeTransportError(validId(reply.error.code, 128) ? reply.error.code : "bridge_failed", validId(reply.error.message, 512) ? reply.error.message : "native bridge request failed");
    }
    const response = reply.response;
    if (!response || response.protocol !== BIMAX_CU_PROTOCOL || response.requestId !== requestId || response.sessionId !== sessionId || !validId(response.serviceVersion, 128)) {
      throw new NativeBridgeTransportError("service_correlation_failed", "native service response identity did not match its request");
    }
    if (response.error && (!validId(response.error.code, 128) || !validId(response.error.message, 1024) || typeof response.error.retryable !== "boolean")) {
      throw new NativeBridgeTransportError("service_malformed_error", "native service returned a malformed typed error");
    }
    return response;
  }
  dispose() {
    return this.port.dispose();
  }
}
function payloadFrom(response: NativeServiceResponse, expectedOp: string): any {
  if (response.error)
    throw new NativeBridgeTransportError(response.error.code, response.error.message);
  if (!response.body || response.body.op !== expectedOp) {
    throw new NativeBridgeTransportError("unexpected_service_response", `expected native ${expectedOp} response`);
  }
  return response.body.payload;
}
export class NativeServiceOperationClient {
  wire: NativeServiceWireClient;
  constructor(wire = new NativeServiceWireClient) {
    this.wire = wire;
  }
  available() {
    return this.wire.available();
  }
  async handshake(): Promise<NativeServiceHandshake> {
    const response = await this.wire.request("bootstrap", {
      op: "handshake",
      payload: {
        clientVersion: "bimax-ts-phase6",
        supportedProtocols: [BIMAX_CU_PROTOCOL]
      }
    }, 2000);
    return validateNativeServiceHandshake(payloadFrom(response, "handshake"));
  }
  async createSession(requestedId: string) {
    if (!validId(requestedId, 128))
      throw new NativeBridgeTransportError("invalid_session_id", "requested native session id is invalid");
    const response = await this.wire.request("bootstrap", {
      op: "session.create",
      payload: { requestedId }
    });
    return payloadFrom(response, "session");
  }
  async workspace(sessionId: string, request: any = {}) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "workspace.snapshot",
      payload: request
    }), "workspace.snapshot");
  }
  async resolveApp(sessionId: string, lookup: any) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "workspace.app.resolve",
      payload: { lookup }
    }), "workspace.app.resolved");
  }
  async launchApp(sessionId: string, request: any) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "workspace.app.launch",
      payload: request
    }, 15000), "workspace.app.launch.receipt");
  }
  async inspectFile(sessionId: string, request: any) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "workspace.file.inspect",
      payload: request
    }), "workspace.file.info");
  }
  async fileOperation(sessionId: string, request: any) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "workspace.file.operate",
      payload: request
    }, 15000), "workspace.file.receipt");
  }
  async openUrl(sessionId: string, request: any) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "workspace.url.open",
      payload: request
    }, 15000), "workspace.url.receipt");
  }
  async windowOperation(sessionId: string, request: any) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "workspace.window.operate",
      payload: request
    }, 15000), "workspace.window.receipt");
  }
  async observe(sessionId: string, request: any) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "ax.observe",
      payload: request
    }), "ax.snapshot");
  }
  async action(sessionId: string, request: any) {
    const response = await this.wire.request(sessionId, {
      op: "semantic.action",
      payload: request
    });
    if (response.error)
      throw new NativeBridgeTransportError(response.error.code, response.error.message);
    const op = response.body?.op;
    if (op !== "semantic.action.receipt" && op !== "delivery.escalation.proposal") {
      throw new NativeBridgeTransportError("unexpected_service_response", "expected native action receipt or escalation proposal");
    }
    return { op, payload: response.body?.payload };
  }
  async transaction(sessionId: string, compiled: CompiledNativeTransaction) {
    if (!isCompiledNativeTransaction(compiled)) {
      throw new NativeBridgeTransportError("unsigned_transaction", "native transactions must come from the checked compiler");
    }
    return payloadFrom(await this.wire.request(sessionId, {
      op: "semantic.transaction",
      payload: compiled.request
    }), "semantic.transaction.receipt");
  }
  async capture(sessionId: string, request: any) {
    return payloadFrom(await this.wire.request(sessionId, {
      op: "capture.image",
      payload: request
    }, 1e4), "capture.image.receipt");
  }
  async closeSession(sessionId: string) {
    payloadFrom(await this.wire.request(sessionId, { op: "session.close" }), "session.closed");
  }
  dispose() {
    return this.wire.dispose();
  }
}
