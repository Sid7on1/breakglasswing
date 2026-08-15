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
import { createHash } from 'node:crypto';
import { CuaCompatibilityBackend } from './cua.compat.backend';
import { computerExecutionRecipe } from './execution.recipe';
import type { DesktopRuntimePort } from './desktop.runtime';

function safeSessionId(raw: string) {
  const clean = raw.trim();
  if (!clean)
    return "default";
  if (/^cu-[a-zA-Z0-9._-]+-[a-f0-9]{12}$/.test(clean))
    return clean;
  const label = clean.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48) || "session";
  const digest = createHash("sha256").update(clean).digest("hex").slice(0, 12);
  return `cu-${label}-${digest}`;
}
class PhysicalActionArbiter {
  tail = Promise.resolve();
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    // The executor runs synchronously, so `release` is always assigned before the finally block.
    let release!: () => void;
    this.tail = new Promise<void>((resolve4) => {
      release = resolve4;
    });
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
class DefaultBackendFactory {
  create(sessionId: string) {
    return new CuaCompatibilityBackend(sessionId);
  }
}
export class ComputerSessionManager {
  factory;
  maxSessions;
  sessions = new Map;
  bound = new Map;
  arbiter = new PhysicalActionArbiter;
  selectedSession = safeSessionId("default");
  constructor(factory = new DefaultBackendFactory, maxSessions = Math.max(1, Number(process.env.BIMAX_COMPUTER_MAX_SESSIONS) || 8)) {
    this.factory = factory;
    this.maxSessions = maxSessions;
  }
  selectSession(sessionId: string) {
    this.selectedSession = safeSessionId(sessionId);
  }
  forSession(sessionId: string) {
    const key = safeSessionId(sessionId);
    this.selectedSession = key;
    const existing = this.bound.get(key);
    if (existing)
      return existing;
    const runtime = new SessionBoundRuntime(this, key);
    this.bound.set(key, runtime);
    return runtime;
  }
  async run(cmd: any, ctx?: any) {
    const key = safeSessionId(cmd.session || this.selectedSession);
    this.selectedSession = key;
    const entry = this.entry(key);
    entry.lastUsedAt = Date.now();
    entry.inFlight++;
    const invoke = () => entry.backend.run({ ...cmd, session: key }, ctx);
    try {
      return computerExecutionRecipe(cmd).serialization === "concurrent-read" ? await invoke() : await this.arbiter.run(invoke);
    } finally {
      entry.inFlight--;
      entry.lastUsedAt = Date.now();
      this.evictIdleSessions();
    }
  }
  quickStatus() {
    return this.current().quickStatus();
  }
  frontmostApp() {
    return this.current().frontmostApp();
  }
  watchAccessibility(pid: number, onEvent: (event: any) => void) {
    return this.current().watchAccessibility?.(pid, onEvent) ?? (() => {});
  }
  describeTarget(cmd: any) {
    const key = safeSessionId(cmd.session || this.selectedSession);
    return this.entry(key).backend.describeTarget?.({ ...cmd, session: key }) ?? null;
  }
  warm() {
    this.current().warm?.();
  }
  activeSurface() {
    return this.current().activeSurface?.() ?? null;
  }
  pauseForUser() {
    return this.current().pauseForUser?.() ?? { ok: false };
  }
  resume() {
    return this.current().resume?.() ?? { ok: false };
  }
  history() {
    return this.current().history?.() ?? { total: 0, kept: 0, byAction: {}, recent: [], noChangeStreak: 0 };
  }
  memoryFootprint() {
    return this.current().memoryFootprint?.() ?? { historyKept: 0, observedElements: 0, indexedElements: 0, surfaces: 0 };
  }
  pipStatus() {
    return this.current().pipStatus?.() ?? Promise.resolve({ enabled: false, running: false, continuous: false, captureSafe: false });
  }
  recordingScopePreview(scope: any) {
    return this.current().recordingScopePreview?.(scope) ?? { scope: scope || "window", captureSafe: scope !== "display" };
  }
  authorizeFullDisplayRecording() {
    return this.current().authorizeFullDisplayRecording?.() ?? "";
  }
  discoverCapabilities(sessionId = this.selectedSession) {
    return this.entry(safeSessionId(sessionId)).backend.discoverCapabilities();
  }
  async dispose() {
    await this.resetSession(this.selectedSession);
  }
  async resetSession(sessionId: string) {
    const key = safeSessionId(sessionId);
    const entry = this.sessions.get(key);
    if (!entry)
      return;
    await this.arbiter.run(async () => {
      await entry.backend.dispose?.();
    });
  }
  async disposeSession(sessionId: string) {
    await this.resetSession(sessionId);
  }
  async closeSession(sessionId: string) {
    const key = safeSessionId(sessionId);
    const entry = this.sessions.get(key);
    if (!entry)
      return;
    if (entry.inFlight > 0)
      throw new Error(`cannot close computer session ${key} while an operation is in flight`);
    this.sessions.delete(key);
    this.bound.delete(key);
    await this.arbiter.run(async () => {
      await entry.backend.dispose?.();
    });
  }
  async disposeAll() {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    this.bound.clear();
    await this.arbiter.run(async () => {
      await Promise.all(entries.map(async (entry) => {
        try {
          await entry.backend.dispose?.();
        } catch {}
      }));
    });
  }
  sessionCount() {
    return this.sessions.size;
  }
  sessionsStatus() {
    return [...this.sessions.values()].map((entry) => ({
      id: entry.id,
      backend: entry.backend.descriptor,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt,
      inFlight: entry.inFlight
    }));
  }
  backendForSession(sessionId: string) {
    return this.entry(safeSessionId(sessionId)).backend;
  }
  current() {
    return this.entry(this.selectedSession).backend;
  }
  entry(key: string) {
    let entry = this.sessions.get(key);
    if (!entry) {
      const now = Date.now();
      entry = { id: key, backend: this.factory.create(key), createdAt: now, lastUsedAt: now, inFlight: 0 };
      this.sessions.set(key, entry);
      this.evictIdleSessions();
    }
    return entry;
  }
  evictIdleSessions() {
    if (this.sessions.size <= this.maxSessions)
      return;
    const candidates = [...this.sessions.entries()].filter(([key, entry]) => key !== this.selectedSession && entry.inFlight === 0).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    while (this.sessions.size > this.maxSessions && candidates.length) {
      // Guarded by `candidates.length` in the loop condition above.
      const [key, entry] = candidates.shift()!;
      this.sessions.delete(key);
      this.bound.delete(key);
      this.arbiter.run(async () => {
        await entry.backend.dispose?.();
      }).catch(() => {});
    }
  }
}
class SessionBoundRuntime {
  manager;
  sessionId;
  constructor(manager: ComputerSessionManager, sessionId: string) {
    this.manager = manager;
    this.sessionId = sessionId;
  }
  run(cmd: any, ctx?: any) {
    return this.manager.run({ ...cmd, session: this.sessionId }, ctx);
  }
  backend() {
    return this.manager.backendForSession(this.sessionId);
  }
  quickStatus() {
    return this.backend().quickStatus();
  }
  frontmostApp() {
    return this.backend().frontmostApp();
  }
  watchAccessibility(pid: number, onEvent: (event: any) => void) {
    return this.backend().watchAccessibility?.(pid, onEvent) ?? (() => {});
  }
  describeTarget(cmd: any) {
    return this.backend().describeTarget?.({ ...cmd, session: this.sessionId }) ?? null;
  }
  dispose() {
    return this.manager.resetSession(this.sessionId);
  }
  warm() {
    this.backend().warm?.();
  }
  activeSurface() {
    return this.backend().activeSurface?.() ?? null;
  }
  pauseForUser() {
    return this.backend().pauseForUser?.() ?? { ok: false };
  }
  resume() {
    return this.backend().resume?.() ?? { ok: false };
  }
  history() {
    return this.backend().history?.() ?? { total: 0, kept: 0, byAction: {}, recent: [], noChangeStreak: 0 };
  }
  memoryFootprint() {
    return this.backend().memoryFootprint?.() ?? { historyKept: 0, observedElements: 0, indexedElements: 0, surfaces: 0 };
  }
  pipStatus() {
    return this.backend().pipStatus?.() ?? Promise.resolve({ enabled: false, running: false, continuous: false, captureSafe: false });
  }
  recordingScopePreview(scope: any) {
    return this.backend().recordingScopePreview?.(scope) ?? { scope: scope || "window", captureSafe: scope !== "display" };
  }
  authorizeFullDisplayRecording() {
    return this.backend().authorizeFullDisplayRecording?.() ?? "";
  }
}
export const globalComputerSessionManager = new ComputerSessionManager;

/** A runtime that can hand back a per-task view of itself. */
export interface SessionRoutableDesktopRuntime {
  forSession(sessionId: string): DesktopRuntimePort;
}

/**
 * Can this runtime route by task session?
 *
 * Callers hold either a bare `DesktopRuntimePort` (one shared surface) or the session manager
 * (one surface per Bimax task). Routing must be decided by asking the object, not by assuming:
 * calling `forSession` on a bare port throws, and skipping it when it IS available silently
 * collapses every concurrent task onto one shared desktop session.
 */
export function isSessionRoutableDesktopRuntime(value: unknown): value is SessionRoutableDesktopRuntime {
  return !!value && typeof (value as SessionRoutableDesktopRuntime).forSession === 'function';
}
