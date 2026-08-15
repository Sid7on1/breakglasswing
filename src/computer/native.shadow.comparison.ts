import { createHash, randomUUID } from 'crypto';

import { cliEvents } from '../cli/events';
import type { DesktopResult } from './desktop.runtime';
import { NativeServiceOperationClient } from './native.bridge.transport';
import {
  NativeToolCoordinator,
  type NativeAXNode,
  type NativeAXSnapshot,
} from './native.tool.coordinator';
import {
  assessNativeShadowEligibility,
  globalNativeServiceCapabilityClient,
  type NativeServiceCapabilityClient,
  type NativeServiceHandshake,
} from './native.service.client';

const MAX_SHADOW_RECEIPTS = 64;
const MAX_SHADOW_CONCURRENCY = 2;

export interface NativeShadowComparisonReceipt {
  receiptId: string;
  taskDigest: string;
  createdAtMs: number;
  durationMs: number;
  outcome: 'compared' | 'skipped' | 'failed';
  reason?: string;
  compatibility: {
    frameId?: string;
    pid: number;
    windowId?: number;
    elements: number;
    signatureDigest: string;
  };
  native?: {
    snapshotId: string;
    pid: number;
    windowId?: number;
    nodes: number;
    signatureDigest: string;
    exactWindow: boolean;
    partial: boolean;
    truncated: boolean;
  };
  comparison?: {
    shared: number;
    union: number;
    jaccard: number | null;
    compatibilityCoverage: number | null;
    nativeCoverage: number | null;
    agreement: 'high' | 'medium' | 'low' | 'insufficient_evidence';
  };
}

export interface NativeShadowCompareOptions {
  query?: string;
  maxElements?: number;
}

export interface NativeShadowObserverPort {
  compare(
    taskSessionId: string,
    compatibility: DesktopResult,
    options?: NativeShadowCompareOptions,
  ): Promise<NativeShadowComparisonReceipt | null>;
  dispose(): Promise<void>;
}

export interface NativeShadowComparisonStatus {
  enabled: boolean;
  inFlight: number;
  receipts: number;
  compared: number;
  skipped: number;
  failed: number;
  lastOutcome?: NativeShadowComparisonReceipt['outcome'];
  lastAgreement?: NonNullable<NativeShadowComparisonReceipt['comparison']>['agreement'];
}

interface ReadyShadow {
  coordinator: NativeToolCoordinator;
  handshake: NativeServiceHandshake;
  profile: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function safeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase().slice(0, 512);
}

function signature(role: unknown, labels: unknown[]): string {
  const normalizedRole = safeText(role).replace(/^ax/, '');
  const label = labels.map(safeText).find(Boolean) ?? '';
  return digest(`${normalizedRole}\0${label}`);
}

function compatibilitySignatures(elements: unknown): Set<string> {
  if (!Array.isArray(elements)) return new Set();
  return new Set(elements.flatMap(element => {
    if (!element || typeof element !== 'object') return [];
    const record = element as Record<string, unknown>;
    return [signature(record.role, [record.label, record.name, record.title, record.description])];
  }));
}

function nativeSignatures(nodes: NativeAXNode[]): Set<string> {
  return new Set(nodes.map(node => signature(node.role, [node.label])));
}

function setDigest(values: Set<string>): string {
  return digest([...values].sort().join('\n'));
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function comparison(
  compatibility: Set<string>,
  native: Set<string>,
): NonNullable<NativeShadowComparisonReceipt['comparison']> {
  const shared = [...compatibility].filter(value => native.has(value)).length;
  const union = new Set([...compatibility, ...native]).size;
  const jaccard = ratio(shared, union);
  const compatibilityCoverage = ratio(shared, compatibility.size);
  const nativeCoverage = ratio(shared, native.size);
  const agreement = jaccard === null
    ? 'insufficient_evidence'
    : jaccard >= 0.75 ? 'high' : jaccard >= 0.4 ? 'medium' : 'low';
  return { shared, union, jaccard, compatibilityCoverage, nativeCoverage, agreement };
}

function exactWindow(
  workspace: unknown,
  pid: number,
  windowId: number | undefined,
): { pid: number; windowId: number; generation: number } | null {
  if (!windowId || !workspace || typeof workspace !== 'object') return null;
  const windows = (workspace as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) return null;
  for (const candidate of windows) {
    const window = candidate && typeof candidate === 'object'
      ? (candidate as { window?: unknown }).window : undefined;
    if (!window || typeof window !== 'object') continue;
    const ref = window as { pid?: unknown; windowId?: unknown; generation?: unknown };
    if (ref.pid === pid && ref.windowId === windowId && Number.isSafeInteger(ref.generation)) {
      return { pid, windowId, generation: ref.generation as number };
    }
  }
  return null;
}

/**
 * Fail-open, read-only Phase 9 shadow comparator.
 *
 * It is deliberately downstream of the compatibility observation. It never delays or changes the
 * model-visible result, never calls an action endpoint, stores no labels/values/pixels, and keeps a
 * bounded receipt ring containing only counts and digests. Capacity is shed instead of queued.
 */
export class NativeShadowComparisonController implements NativeShadowObserverPort {
  private readonly receipts: NativeShadowComparisonReceipt[] = [];
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly tasksInFlight = new Set<string>();
  private initialization: Promise<ReadyShadow | { blockers: string[] }> | null = null;
  private disposed = false;

  public constructor(
    private readonly enabled = process.env.BIMAX_CU_NATIVE_SHADOW_ENABLED === '1',
    private readonly capabilityClient: NativeServiceCapabilityClient = globalNativeServiceCapabilityClient,
    private readonly operationClientFactory: () => NativeServiceOperationClient = () =>
      new NativeServiceOperationClient(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  public compare(
    taskSessionId: string,
    compatibilityResult: DesktopResult,
    options: NativeShadowCompareOptions = {},
  ): Promise<NativeShadowComparisonReceipt | null> {
    if (!this.enabled || this.disposed) return Promise.resolve(null);
    const pid = compatibilityResult.pid;
    if (!compatibilityResult.ok || compatibilityResult.action !== 'observe'
        || !Number.isSafeInteger(pid) || (pid ?? 0) < 1) {
      return Promise.resolve(this.record(this.baseReceipt(
        taskSessionId, compatibilityResult, 'skipped', 'compatibility_observation_unavailable',
      )));
    }
    if (this.tasksInFlight.has(taskSessionId)) {
      return Promise.resolve(this.record(this.baseReceipt(
        taskSessionId, compatibilityResult, 'skipped', 'shadow_task_busy',
      )));
    }
    if (this.inFlight.size >= MAX_SHADOW_CONCURRENCY) {
      return Promise.resolve(this.record(this.baseReceipt(
        taskSessionId, compatibilityResult, 'skipped', 'shadow_capacity',
      )));
    }

    this.tasksInFlight.add(taskSessionId);
    const pending = this.runComparison(taskSessionId, compatibilityResult, options)
      .finally(() => {
        this.tasksInFlight.delete(taskSessionId);
        this.inFlight.delete(pending);
      });
    this.inFlight.add(pending);
    return pending;
  }

  public recent(limit = 20): NativeShadowComparisonReceipt[] {
    const bounded = Math.min(Math.max(0, Math.floor(limit)), MAX_SHADOW_RECEIPTS);
    if (bounded === 0) return [];
    return this.receipts.slice(-bounded).map(receipt => structuredClone(receipt));
  }

  public status(): NativeShadowComparisonStatus {
    const compared = this.receipts.filter(receipt => receipt.outcome === 'compared').length;
    const skipped = this.receipts.filter(receipt => receipt.outcome === 'skipped').length;
    const failed = this.receipts.filter(receipt => receipt.outcome === 'failed').length;
    const last = this.receipts.at(-1);
    return {
      enabled: this.enabled && !this.disposed,
      inFlight: this.inFlight.size,
      receipts: this.receipts.length,
      compared,
      skipped,
      failed,
      ...(last ? { lastOutcome: last.outcome } : {}),
      ...(last?.comparison ? { lastAgreement: last.comparison.agreement } : {}),
    };
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.inFlight]);
    const ready = await this.initialization?.catch(() => null);
    if (ready && 'coordinator' in ready) await ready.coordinator.dispose();
    this.initialization = null;
    this.tasksInFlight.clear();
  }

  private async runComparison(
    taskSessionId: string,
    compatibilityResult: DesktopResult,
    options: NativeShadowCompareOptions,
  ): Promise<NativeShadowComparisonReceipt> {
    const started = this.now();
    try {
      const initialized = await this.initialize();
      if ('blockers' in initialized) {
        return this.record(this.baseReceipt(
          taskSessionId, compatibilityResult, 'skipped', initialized.blockers.join(','), started,
        ));
      }
      const pid = compatibilityResult.pid!;
      const workspace = await initialized.coordinator.workspace(taskSessionId, {
        pid, includeOffscreenWindows: true,
      });
      const target = exactWindow(workspace, pid, compatibilityResult.windowId);
      const maxElements = Math.min(
        initialized.handshake.limits.maxElements,
        Math.max(1, Math.min(500, Math.floor(options.maxElements ?? 500))),
      );
      const request: Record<string, unknown> = {
        pid,
        scope: target ? 'window' : 'application',
        profile: initialized.profile,
        maxElements,
        ...(target ? {
          windowId: target.windowId,
          windowGeneration: target.generation,
        } : {}),
        ...(typeof options.query === 'string' && options.query.trim()
          ? { query: options.query.trim().slice(0, 512) } : {}),
      };
      const snapshot = await initialized.coordinator.observe(taskSessionId, request);
      return this.record(this.comparedReceipt(
        taskSessionId, compatibilityResult, snapshot, !!target, started,
      ));
    } catch (error) {
      const reason = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code) : 'shadow_observation_failed';
      return this.record(this.baseReceipt(
        taskSessionId, compatibilityResult, 'failed', reason, started,
      ));
    }
  }

  private initialize(): Promise<ReadyShadow | { blockers: string[] }> {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const probe = await this.capabilityClient.probe();
      // The same standing ad-hoc approval the probe was assessed against. The shadow gate and the
      // cutover gate share `signingBlockers` precisely so they cannot disagree about signing; not
      // passing the approval here would reintroduce that drift one level up, leaving an approved
      // service running native tools while its shadow comparison refused it as unsigned.
      const approval = probe.adHocApproval;
      const discovered = assessNativeShadowEligibility(probe.handshake, true, approval);
      if (!probe.reachable) return { blockers: ['service_unreachable'] };
      if (!discovered.eligible) return { blockers: discovered.blockers };
      const client = this.operationClientFactory();
      if (!client.available()) return { blockers: ['bridge_unavailable'] };
      try {
        const handshake = await client.handshake();
        const live = assessNativeShadowEligibility(handshake, true, approval);
        if (!live.eligible) {
          await client.dispose().catch(() => {});
          return { blockers: live.blockers };
        }
        return {
          coordinator: new NativeToolCoordinator(handshake, client),
          handshake,
          profile: handshake.capabilities.observe.profiles.includes('balanced')
            ? 'balanced' : handshake.capabilities.observe.profiles[0],
        };
      } catch {
        await client.dispose().catch(() => {});
        return { blockers: ['shadow_initialization_failed'] };
      }
    })();
    return this.initialization;
  }

  private comparedReceipt(
    taskSessionId: string,
    compatibilityResult: DesktopResult,
    snapshot: NativeAXSnapshot,
    isExactWindow: boolean,
    started: number,
  ): NativeShadowComparisonReceipt {
    const compatibility = compatibilitySignatures(compatibilityResult.elements);
    const native = nativeSignatures(snapshot.nodes);
    return {
      ...this.baseReceipt(taskSessionId, compatibilityResult, 'compared', undefined, started),
      native: {
        snapshotId: snapshot.snapshotId,
        pid: snapshot.pid,
        ...(snapshot.windowId !== undefined ? { windowId: snapshot.windowId } : {}),
        nodes: snapshot.nodes.length,
        signatureDigest: setDigest(native),
        exactWindow: isExactWindow,
        partial: snapshot.partial,
        truncated: snapshot.truncated,
      },
      comparison: comparison(compatibility, native),
    };
  }

  private baseReceipt(
    taskSessionId: string,
    result: DesktopResult,
    outcome: NativeShadowComparisonReceipt['outcome'],
    reason?: string,
    started = this.now(),
  ): NativeShadowComparisonReceipt {
    const signatures = compatibilitySignatures(result.elements);
    return {
      receiptId: randomUUID(),
      taskDigest: digest(taskSessionId),
      createdAtMs: this.now(),
      durationMs: Math.max(0, this.now() - started),
      outcome,
      ...(reason ? { reason } : {}),
      compatibility: {
        ...(result.frameId ? { frameId: result.frameId } : {}),
        pid: Number.isSafeInteger(result.pid) ? result.pid! : 0,
        ...(Number.isSafeInteger(result.windowId) ? { windowId: result.windowId } : {}),
        elements: Array.isArray(result.elements) ? result.elements.length : 0,
        signatureDigest: setDigest(signatures),
      },
    };
  }

  private record(receipt: NativeShadowComparisonReceipt): NativeShadowComparisonReceipt {
    this.receipts.push(receipt);
    while (this.receipts.length > MAX_SHADOW_RECEIPTS) this.receipts.shift();
    const comparisonNote = receipt.comparison
      ? ` · ${receipt.comparison.agreement} agreement (${receipt.comparison.shared}/${receipt.comparison.union})`
      : receipt.reason ? ` · ${receipt.reason}` : '';
    cliEvents.emit('log', {
      id: this.now(), level: receipt.outcome === 'failed' ? 'warn' : 'info',
      text: `[Bimax-Cu shadow] ${receipt.outcome}${comparisonNote}`,
      timestamp: new Date(this.now()),
    });
    return structuredClone(receipt);
  }
}

export const globalNativeComputerShadowObserver = new NativeShadowComparisonController();
