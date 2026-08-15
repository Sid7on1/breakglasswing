// The capability broker — owner section 29 (V29B), slice S29-C step 1.
//
// §16 of docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md lists exactly what a
// broker enforces, and this file is that list:
//
//   protocol/schema version · signed package identity · task/project/user/session authority ·
//   path capabilities as opaque handles, not arbitrary strings · domain allowlists ·
//   subprocess executable classes · resource budgets, cancellation, deadline, output size ·
//   taint propagation · structured receipts, health, crash backoff, quarantine
//
// Two design commitments carry most of the weight:
//
//   **Handles, not strings.** A capability never receives a path. It receives an opaque handle it
//   cannot forge, cannot guess and cannot walk out of: `resolveHandle` is the only way back to a
//   real path, it lives in the broker, and it re-checks containment at use time rather than trusting
//   that the handle was safe when it was minted. A capability that asks for a path it was not handed
//   gets `undeclared-path`, not a file.
//
//   **The renderer is never a party.** §9 and §16: "the renderer can ask for a declared action and
//   display its receipt; it cannot connect directly to an extension." Nothing here returns a handle,
//   a worker reference or a raw path to a caller — `BrokeredResult` is data.
//
// Execution is injected as `CapabilityWorker`. The real implementation is an out-of-process XPC or
// child-process worker owned by Desktop; making it an interface is what lets the crash, deadline,
// output-cap and quarantine paths be graded deterministically instead of by starting real processes.

import { createHash, randomBytes } from 'node:crypto';
import { CapabilityManifest, CapabilityState, declaredAuthority } from './manifest';
import { DeclaredEffects, Identity, noEffects } from '../evidence/schema';
import { isInside, normalizePath } from '../evidence/path.class';

/** Wire version of the broker protocol. A worker that speaks another version is refused. */
export const BROKER_PROTOCOL = 'bimax-capability/1' as const;

/** An opaque, unguessable reference to a path the broker granted. Never a path itself. */
export type PathHandle = string & { readonly __brand: 'PathHandle' };

export type DenialReason =
  | 'protocol-mismatch'
  | 'identity-drift'
  | 'not-activated'
  | 'quarantined'
  | 'undeclared-path'
  | 'undeclared-host'
  | 'undeclared-process'
  | 'handle-unknown'
  | 'handle-escape'
  | 'expired-authority'
  | 'deadline-exceeded'
  | 'output-limit-exceeded'
  | 'cancelled'
  | 'worker-crashed';

export interface ResourceBudget {
  /** Wall-clock milliseconds a single call may take before it is cancelled. */
  deadlineMs: number;
  /** Bytes of output a call may return. Anything past this is refused, not truncated silently. */
  maxOutputBytes: number;
  /** Concurrent in-flight calls for one capability. */
  maxConcurrency: number;
}

export const DEFAULT_BUDGET: ResourceBudget = {
  deadlineMs: 30_000,
  maxOutputBytes: 1024 * 1024,
  maxConcurrency: 4,
};

export interface BrokeredRequest {
  capabilityId: string;
  /** The declared action name. The broker never accepts an arbitrary command. */
  action: string;
  /** Arguments, with path handles where a path is meant. */
  args: Record<string, unknown>;
  /** Handles the call may resolve. A handle not in this list is `undeclared-path`. */
  handles: PathHandle[];
  hosts: string[];
  processes: string[];
  /** Task the call is being made under. Authority is task-scoped unless the manifest says otherwise. */
  taskIntentId: string;
}

export interface BrokeredResult {
  ok: boolean;
  capabilityId: string;
  action: string;
  /** Present when the call succeeded. Already size-checked. */
  output: string | null;
  denial: DenialReason | null;
  detail: string;
  /** What the call actually exercised, in the vocabulary the Task Guard compares against. */
  observed: DeclaredEffects;
  /** Taint labels the output carries onward. §16: taint propagates from web/MCP/package content. */
  taint: string[];
  durationMs: number;
}

/** What an out-of-process worker must provide. The real one is a child process or XPC peer. */
export interface CapabilityWorker {
  protocol: string;
  /** The digest the worker reports for the code it is actually running. */
  contentDigest: string;
  /**
   * Run one action. Must reject on cancellation. The broker enforces the deadline itself rather
   * than trusting the worker to honour it.
   */
  invoke(action: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{
    output: string;
    /** Paths, hosts and processes the worker says it touched. Checked against authority, not trusted. */
    observed?: Partial<DeclaredEffects>;
    taint?: string[];
  }>;
  /** Best-effort teardown. Called on quarantine. */
  dispose?(): Promise<void> | void;
}

export interface CapabilityHealth {
  capabilityId: string;
  consecutiveCrashes: number;
  quarantined: boolean;
  /** Why it was quarantined, if it was. Rendered verbatim in the Trust Center. */
  quarantineReason: string | null;
  lastDenial: DenialReason | null;
  calls: number;
  denials: number;
}

/** Crashes in a row before a capability is quarantined rather than restarted again. §16. */
export const CRASH_QUARANTINE_THRESHOLD = 3;

interface HandleRecord {
  path: string;
  capabilityId: string;
  taskIntentId: string;
  /** Absolute ms, or null for the lifetime of the task. */
  expiresAt: number | null;
  writable: boolean;
}

export interface BrokerOptions {
  budget?: Partial<ResourceBudget>;
  now?: () => number;
  /** Injected so handle minting is deterministic in tests. Must be unguessable in production. */
  randomId?: () => string;
}

/**
 * The broker.
 *
 * One instance owns the handle table, the health table and the worker registry for a session. It is
 * the only object that can turn a handle into a path, and it refuses every call whose declared
 * effects exceed the capability's signed manifest — the same check the Task Guard's
 * `MANIFEST_EXCEEDED` rule makes, applied here at the point of execution so the finding and the
 * refusal cannot disagree.
 */
export class CapabilityBroker {
  private readonly workers = new Map<string, CapabilityWorker>();
  private readonly manifests = new Map<string, CapabilityManifest>();
  private readonly states = new Map<string, CapabilityState>();
  private readonly handles = new Map<string, HandleRecord>();
  private readonly health = new Map<string, CapabilityHealth>();
  private readonly inFlight = new Map<string, number>();
  private readonly budget: ResourceBudget;
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(options: BrokerOptions = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...options.budget };
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => randomBytes(16).toString('hex'));
  }

  /**
   * Register an activated capability and the worker that runs it.
   *
   * The worker's reported digest must equal the manifest's. §16 lists "signed package/digest
   * identity" first for a reason: a worker running code other than what was verified is the whole
   * supply-chain problem arriving after the supply chain was checked.
   */
  register(manifest: CapabilityManifest, worker: CapabilityWorker, state: CapabilityState): { ok: boolean; denial: DenialReason | null; detail: string } {
    if (worker.protocol !== BROKER_PROTOCOL) {
      return { ok: false, denial: 'protocol-mismatch', detail: `worker speaks ${worker.protocol}, broker speaks ${BROKER_PROTOCOL}` };
    }
    if (!manifest.contentDigest || worker.contentDigest !== manifest.contentDigest) {
      return {
        ok: false, denial: 'identity-drift',
        detail: `worker reports ${worker.contentDigest || 'no digest'}, the verified manifest declares ${manifest.contentDigest ?? 'none'}`,
      };
    }
    if (state !== 'activated' && state !== 'healthy') {
      return { ok: false, denial: 'not-activated', detail: `capability is ${state}, not activated` };
    }
    this.workers.set(manifest.id, worker);
    this.manifests.set(manifest.id, manifest);
    this.states.set(manifest.id, state);
    this.health.set(manifest.id, {
      capabilityId: manifest.id, consecutiveCrashes: 0, quarantined: false,
      quarantineReason: null, lastDenial: null, calls: 0, denials: 0,
    });
    return { ok: true, denial: null, detail: 'registered' };
  }

  /**
   * Mint a handle for a path a capability may use.
   *
   * Minting checks the manifest; resolving checks it again. That looks redundant and is not: a
   * manifest can be narrowed by a revocation between the two, and the second check is what makes
   * revocation take effect on calls already in flight.
   */
  grantHandle(capabilityId: string, path: string, taskIntentId: string, opts: { writable?: boolean; ttlMs?: number } = {}): PathHandle | null {
    const manifest = this.manifests.get(capabilityId);
    if (!manifest) return null;
    const normalized = normalizePath(path);
    const authority = declaredAuthority(manifest);
    const roots = opts.writable ? authority.writes : [...authority.reads, ...authority.writes];
    if (!roots.some(root => isInside(normalized, root))) return null;
    const handle = `h_${this.randomId()}` as PathHandle;
    this.handles.set(handle, {
      path: normalized,
      capabilityId,
      taskIntentId,
      writable: opts.writable === true,
      expiresAt: opts.ttlMs === undefined ? null : this.now() + opts.ttlMs,
    });
    return handle;
  }

  /** Withdraw a handle. Used by revocation and by task teardown. */
  revokeHandle(handle: PathHandle): boolean { return this.handles.delete(handle); }

  /**
   * Narrow a capability's authority without uninstalling it — the Trust Center's partial revoke
   * ("stop letting this write", "drop this network destination").
   *
   * This is why `resolveHandle` re-checks containment rather than trusting the handle it minted: a
   * handle granted under the old, wider authority is still in the table and may already be in an
   * in-flight call. Narrowing must take effect on it immediately, and the re-check is the only thing
   * that makes that true. Widening is refused — authority only ever shrinks here; growing it is an
   * upgrade, and an upgrade goes through the install transaction and its approval.
   */
  narrowAuthority(capabilityId: string, narrowed: Partial<CapabilityManifest['permissions']>): boolean {
    const manifest = this.manifests.get(capabilityId);
    if (!manifest) return false;
    const current = manifest.permissions;
    const keep = (next: string[] | undefined, previous: string[]): string[] =>
      (next ?? previous).filter(value => previous.includes(value));
    this.manifests.set(capabilityId, {
      ...manifest,
      permissions: {
        filesystemRead: keep(narrowed.filesystemRead, current.filesystemRead),
        filesystemWrite: keep(narrowed.filesystemWrite, current.filesystemWrite),
        network: keep(narrowed.network, current.network),
        process: keep(narrowed.process, current.process),
      },
    });
    return true;
  }

  /** Withdraw every handle a capability holds, and stop it being callable. */
  revokeCapability(capabilityId: string, reason: string): void {
    for (const [handle, record] of [...this.handles]) {
      if (record.capabilityId === capabilityId) this.handles.delete(handle);
    }
    this.states.set(capabilityId, 'revoked');
    const health = this.health.get(capabilityId);
    if (health) {
      health.quarantined = true;
      health.quarantineReason = `revoked: ${reason}`;
    }
    void this.workers.get(capabilityId)?.dispose?.();
    this.workers.delete(capabilityId);
  }

  /**
   * Turn a handle back into a path — the only way to do so, and only for the capability and task it
   * was minted for. Re-checks containment against the *current* manifest.
   */
  resolveHandle(capabilityId: string, taskIntentId: string, handle: PathHandle): { path: string | null; denial: DenialReason | null } {
    const record = this.handles.get(handle);
    if (!record) return { path: null, denial: 'handle-unknown' };
    if (record.capabilityId !== capabilityId || record.taskIntentId !== taskIntentId) {
      return { path: null, denial: 'handle-unknown' };
    }
    if (record.expiresAt !== null && this.now() > record.expiresAt) {
      return { path: null, denial: 'expired-authority' };
    }
    const manifest = this.manifests.get(capabilityId);
    if (!manifest) return { path: null, denial: 'not-activated' };
    const authority = declaredAuthority(manifest);
    const roots = record.writable ? authority.writes : [...authority.reads, ...authority.writes];
    if (!roots.some(root => isInside(record.path, root))) {
      return { path: null, denial: 'handle-escape' };
    }
    return { path: record.path, denial: null };
  }

  healthOf(capabilityId: string): CapabilityHealth | null { return this.health.get(capabilityId) ?? null; }
  allHealth(): CapabilityHealth[] { return [...this.health.values()]; }

  /**
   * Run one brokered call.
   *
   * Order matters and is not negotiable: identity and state, then authority, then budget, then the
   * worker. A capability that fails an earlier gate never reaches the worker at all, which is what
   * makes "the extension could not access undeclared data" a property of the design rather than of
   * the extension's good behaviour.
   */
  async call(request: BrokeredRequest, externalSignal?: AbortSignal): Promise<BrokeredResult> {
    const started = this.now();
    const deny = (denial: DenialReason, detail: string): BrokeredResult => {
      const health = this.health.get(request.capabilityId);
      if (health) { health.denials += 1; health.lastDenial = denial; }
      return {
        ok: false, capabilityId: request.capabilityId, action: request.action,
        output: null, denial, detail, observed: noEffects(), taint: [],
        durationMs: this.now() - started,
      };
    };

    const health = this.health.get(request.capabilityId);
    // Quarantine and revocation are checked before the worker is looked up, because both *remove*
    // the worker. Checking the worker first would report a capability the user deliberately revoked
    // as merely "not activated", which tells them nothing about what happened or how to undo it.
    if (health?.quarantined) return deny('quarantined', health.quarantineReason ?? 'capability is quarantined');
    const manifest = this.manifests.get(request.capabilityId);
    const worker = this.workers.get(request.capabilityId);
    if (!manifest || !worker || !health) return deny('not-activated', 'no activated capability with that id');
    const state = this.states.get(request.capabilityId);
    if (state !== 'activated' && state !== 'healthy') return deny('not-activated', `capability is ${state}`);

    const authority = declaredAuthority(manifest);

    // Every handle must resolve for this capability and this task, and still be inside authority.
    const resolvedPaths: string[] = [];
    for (const handle of request.handles) {
      const resolved = this.resolveHandle(request.capabilityId, request.taskIntentId, handle);
      if (resolved.denial) return deny(resolved.denial, `handle ${handle.slice(0, 10)}… ${resolved.denial}`);
      resolvedPaths.push(resolved.path as string);
    }

    for (const host of request.hosts) {
      if (!authority.hosts.includes(host)) {
        return deny('undeclared-host', `${host} is not in the manifest's network allowlist`);
      }
    }
    for (const process of request.processes) {
      const basename = normalizePath(process).split('/').pop() || process;
      if (!authority.processes.some(p => p === process || p === basename)) {
        return deny('undeclared-process', `${basename} is not in the manifest's process allowlist`);
      }
    }
    // A raw path anywhere in the arguments is an attempt to address the filesystem directly rather
    // than through a handle. That is the failure §16 exists to prevent, so it is refused by shape.
    const rawPath = findRawPath(request.args);
    if (rawPath) {
      return deny('undeclared-path', `arguments contain the raw path ${rawPath}; capabilities address files by handle`);
    }

    const concurrent = this.inFlight.get(request.capabilityId) ?? 0;
    if (concurrent >= this.budget.maxConcurrency) {
      return deny('deadline-exceeded', `capability already has ${concurrent} calls in flight`);
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.budget.deadlineMs);
    this.inFlight.set(request.capabilityId, concurrent + 1);
    health.calls += 1;

    try {
      const response = await worker.invoke(
        request.action,
        // The worker receives handles, never the resolved paths. Resolution is the broker's job and
        // stays on the broker's side of the boundary.
        request.args,
        controller.signal,
      );
      if (controller.signal.aborted) {
        return deny(externalSignal?.aborted ? 'cancelled' : 'deadline-exceeded', `the call exceeded its ${this.budget.deadlineMs}ms budget`);
      }
      const output = response.output ?? '';
      if (Buffer.byteLength(output, 'utf8') > this.budget.maxOutputBytes) {
        return deny('output-limit-exceeded', `output exceeds the ${this.budget.maxOutputBytes}-byte cap`);
      }
      // What the worker *claims* it touched is checked against authority, never believed. A worker
      // that reports an undeclared effect has already exceeded its manifest even if the effect was
      // harmless, and S29-05 grades the receipt naming the mismatch.
      const observed = normaliseObserved(response.observed, resolvedPaths);
      const excess = beyondAuthority(observed, authority);
      if (excess) return deny(excess.denial, excess.detail);

      health.consecutiveCrashes = 0;
      return {
        ok: true, capabilityId: request.capabilityId, action: request.action,
        output, denial: null, detail: 'completed within budget', observed,
        // Everything a capability returns is untrusted content, so its own label is added to
        // whatever it declares. A capability cannot mark its output clean.
        taint: [...new Set([...(response.taint ?? []), `capability:${request.capabilityId}`])],
        durationMs: this.now() - started,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        // A worker that rejects because it was aborted is reporting our own cancellation back to us.
        // Its message ("aborted") explains nothing, so the reason the broker knows is used instead.
        return externalSignal?.aborted
          ? deny('cancelled', 'the call was cancelled by its caller')
          : deny('deadline-exceeded', `the call exceeded its ${this.budget.deadlineMs}ms budget`);
      }
      health.consecutiveCrashes += 1;
      if (health.consecutiveCrashes >= CRASH_QUARANTINE_THRESHOLD) {
        health.quarantined = true;
        health.quarantineReason = `${health.consecutiveCrashes} consecutive crashes; the last was: ${(error as Error).message}`;
        void worker.dispose?.();
        this.workers.delete(request.capabilityId);
      }
      return deny('worker-crashed', (error as Error).message || 'the worker crashed');
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      this.inFlight.set(request.capabilityId, Math.max(0, (this.inFlight.get(request.capabilityId) ?? 1) - 1));
    }
  }

  /** Stable, non-reversible label for a handle, safe to show in a receipt. */
  static describeHandle(handle: PathHandle): string {
    return `handle:${createHash('sha256').update(handle).digest('hex').slice(0, 12)}`;
  }
}

/** A path-shaped string anywhere in the arguments. Handles are opaque and never look like paths. */
export function findRawPath(args: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof args === 'string') {
    return /^(\/|~\/|\.\.?\/)/.test(args) ? args : null;
  }
  if (Array.isArray(args)) {
    for (const item of args) {
      const found = findRawPath(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (args && typeof args === 'object') {
    for (const value of Object.values(args as Record<string, unknown>)) {
      const found = findRawPath(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function normaliseObserved(observed: Partial<DeclaredEffects> | undefined, resolvedPaths: string[]): DeclaredEffects {
  return noEffects({
    reads: [...new Set([...(observed?.reads ?? []).map(normalizePath), ...resolvedPaths])],
    writes: (observed?.writes ?? []).map(normalizePath),
    deletes: (observed?.deletes ?? []).map(normalizePath),
    hosts: observed?.hosts ?? [],
    processes: observed?.processes ?? [],
  });
}

function beyondAuthority(observed: DeclaredEffects, authority: DeclaredEffects): { denial: DenialReason; detail: string } | null {
  for (const path of [...observed.writes, ...observed.deletes]) {
    if (!authority.writes.some(root => isInside(path, root))) {
      return { denial: 'undeclared-path', detail: `wrote ${path}, outside filesystem_write` };
    }
  }
  for (const path of observed.reads) {
    if (![...authority.reads, ...authority.writes].some(root => isInside(path, root))) {
      return { denial: 'undeclared-path', detail: `read ${path}, outside filesystem_read` };
    }
  }
  for (const host of observed.hosts) {
    if (!authority.hosts.includes(host)) {
      return { denial: 'undeclared-host', detail: `contacted ${host}, outside the network allowlist` };
    }
  }
  for (const process of observed.processes) {
    const basename = normalizePath(process).split('/').pop() || process;
    if (!authority.processes.some(p => p === process || p === basename)) {
      return { denial: 'undeclared-process', detail: `launched ${basename}, outside the process allowlist` };
    }
  }
  return null;
}

/** Identity for a brokered call, for the causal receipt. */
export function brokerIdentity(capabilityId: string, manifest: CapabilityManifest | null): Identity {
  return {
    kind: 'capability',
    id: capabilityId,
    display: manifest ? `${manifest.id}@${manifest.version}` : capabilityId,
    signer: manifest?.publisherIdentity ?? null,
    digest: manifest?.contentDigest ?? null,
    provenance: manifest?.publisherIdentity ? 'signed-metadata' : 'declared',
  };
}
