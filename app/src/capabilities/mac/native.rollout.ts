import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

export type NativeRolloutMode = 'off' | 'manual' | 'cohort' | 'native';
export type NativeRolloutOutcome = 'success' | 'failure' | 'safety_failure';

interface NativeRolloutSample {
  atMs: number;
  outcome: NativeRolloutOutcome;
  tool: string;
  code?: string;
}

interface NativeRolloutStateFile {
  version: 1;
  rolloutDigest: string;
  operatorMode?: NativeRolloutMode;
  tripped: boolean;
  tripReason?: string;
  trippedAtMs?: number;
  samples: NativeRolloutSample[];
}

export interface NativeRolloutStatus {
  mode: NativeRolloutMode;
  state: 'off' | 'blocked' | 'holdout' | 'eligible' | 'rolled_back';
  selected: boolean;
  rolloutDigest: string;
  cohortBps: number;
  bucket?: number;
  blockers: string[];
  samples: number;
  successes: number;
  failures: number;
  safetyFailures: number;
  failureBps: number;
  minSamples: number;
  maxFailureBps: number;
  tripped: boolean;
  tripReason?: string;
  trippedAtMs?: number;
}

export interface NativeRolloutControllerOptions {
  mode?: NativeRolloutMode;
  rolloutId?: string;
  cohortBps?: number;
  cohortKey?: string;
  evidenceApproved?: boolean;
  minSamples?: number;
  maxFailureBps?: number;
  maxSamples?: number;
  statePath?: string | null;
  now?: () => number;
}

const SAFETY_CODES = new Set([
  'bridge_correlation_failed',
  'bridge_malformed_response',
  'bridge_protocol_error',
  'bridge_response_too_large',
  'bridge_timeout',
  'service_correlation_failed',
  'service_malformed_error',
  'unexpected_service_response',
  'xpc_malformed_response',
  'xpc_timeout',
]);

const FAILURE_CODES = new Set([
  'accessibility_not_granted',
  'bridge_disposed',
  'bridge_exited',
  'bridge_failed',
  'bridge_parent_invalid',
  'bridge_spawn_failed',
  'bridge_unavailable',
  'bridge_write_failed',
  'capture_unavailable',
  'permission_denied',
  'service_unavailable',
  'xpc_bridge_failed',
  'xpc_unavailable',
]);

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

/** Stable assignment in basis points. Changing rolloutId deliberately reshuffles the cohort. */
export function nativeRolloutBucket(rolloutId: string, cohortKey: string): number {
  const bytes = createHash('sha256').update(rolloutId).update('\0').update(cohortKey).digest();
  return bytes.readUInt32BE(0) % 10_000;
}

function configuredMode(): NativeRolloutMode {
  const explicit = process.env.BIMAX_CU_NATIVE_ROLLOUT_MODE;
  if (explicit === 'off' || explicit === 'manual' || explicit === 'cohort' || explicit === 'native') {
    return explicit;
  }
  if (process.env.BIMAX_CU_NATIVE_ROUTING_ENABLED === '1'
      || process.env.BIMAX_CU_NATIVE_SEMANTIC_ROUTING_ENABLED === '1') return 'manual';
  // Phase 9 native default is macOS-only. Structural signing/TCC/capability gates still run before
  // a tool is registered, and an operator can persist an immediate compatibility rollback.
  return process.platform === 'darwin' ? 'native' : 'off';
}

function defaultStatePath(): string {
  const root = process.env.BIMAX_BREAKGLASS_DIR || path.join(os.homedir(), '.breakglass');
  return path.join(root, 'native-rollout.json');
}

function safeCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,127}$/.test(value) ? value : undefined;
}

export function classifyNativeRolloutError(error: unknown): NativeRolloutOutcome | null {
  const code = safeCode(error);
  if (!code) return null; // validation, Governor refusal, and user cancellation are rollout-neutral.
  if (SAFETY_CODES.has(code)) return 'safety_failure';
  if (FAILURE_CODES.has(code) || code.startsWith('bridge_') || code.startsWith('xpc_')) return 'failure';
  return null; // typed application/target refusals do not condemn the backend.
}

export class NativeRolloutRollbackError extends Error {
  public readonly code = 'native_rollout_rolled_back';

  public constructor(reason: string) {
    super(`Native routing is unavailable (${reason}); use ComputerTool compatibility. `
      + 'The native call was not replayed because delivery may be ambiguous.');
    this.name = 'NativeRolloutRollbackError';
  }
}

/**
 * Phase 9 rollout authority. It stores no task ids, arguments, labels, values, screenshots, or AX
 * content—only a bounded outcome ring, coarse tool names, redacted error codes, and circuit state.
 */
export class NativeRolloutController {
  private readonly rolloutId: string;
  private readonly rolloutDigest: string;
  private readonly cohortBps: number;
  private readonly cohortKey: string;
  private readonly evidenceApproved: boolean;
  private readonly minSamples: number;
  private readonly maxFailureBps: number;
  private readonly maxSamples: number;
  private readonly statePath: string | null;
  private readonly now: () => number;
  private configured: NativeRolloutMode;
  private state: NativeRolloutStateFile;

  public constructor(options: NativeRolloutControllerOptions = {}) {
    this.configured = options.mode ?? configuredMode();
    this.rolloutId = options.rolloutId ?? process.env.BIMAX_CU_NATIVE_ROLLOUT_ID ?? 'bimax-cu-native-v1';
    this.rolloutDigest = digest(this.rolloutId);
    this.cohortBps = boundedInteger(
      options.cohortBps ?? process.env.BIMAX_CU_NATIVE_COHORT_BPS, 0, 0, 10_000,
    );
    this.cohortKey = (options.cohortKey ?? process.env.BIMAX_CU_NATIVE_COHORT_KEY ?? '').trim();
    this.evidenceApproved = options.evidenceApproved
      ?? process.env.BIMAX_CU_NATIVE_COHORT_EVIDENCE_APPROVED === '1';
    this.minSamples = boundedInteger(
      options.minSamples ?? process.env.BIMAX_CU_NATIVE_ROLLOUT_MIN_SAMPLES, 20, 5, 1_000,
    );
    this.maxFailureBps = boundedInteger(
      options.maxFailureBps ?? process.env.BIMAX_CU_NATIVE_ROLLOUT_MAX_FAILURE_BPS, 1_000, 0, 10_000,
    );
    this.maxSamples = boundedInteger(options.maxSamples, 100, this.minSamples, 1_000);
    this.statePath = options.statePath === undefined ? defaultStatePath() : options.statePath;
    this.now = options.now ?? (() => Date.now());
    this.state = this.load();
  }

  public status(): NativeRolloutStatus {
    const mode = this.state.operatorMode ?? this.configured;
    const blockers: string[] = [];
    let bucket: number | undefined;
    if (mode === 'off') blockers.push('rollout_disabled');
    if (mode === 'cohort') {
      if (!this.rolloutId.trim()) blockers.push('rollout_id_missing');
      if (!this.cohortKey) blockers.push('cohort_key_missing');
      if (!this.evidenceApproved) blockers.push('cohort_evidence_not_approved');
      if (this.cohortBps < 1) blockers.push('cohort_empty');
      if (this.rolloutId.trim() && this.cohortKey) {
        bucket = nativeRolloutBucket(this.rolloutId, this.cohortKey);
        if (bucket >= this.cohortBps) blockers.push('cohort_holdout');
      }
    }
    if (this.state.tripped) blockers.push('automatic_rollback_active');

    const successes = this.state.samples.filter(sample => sample.outcome === 'success').length;
    const failures = this.state.samples.filter(sample => sample.outcome === 'failure').length;
    const safetyFailures = this.state.samples.filter(sample => sample.outcome === 'safety_failure').length;
    const samples = successes + failures + safetyFailures;
    const failureBps = samples > 0 ? Math.round(((failures + safetyFailures) / samples) * 10_000) : 0;
    const selected = blockers.length === 0;
    const state: NativeRolloutStatus['state'] = this.state.tripped ? 'rolled_back'
      : blockers.includes('cohort_holdout') ? 'holdout'
        : mode === 'off' ? 'off' : blockers.length ? 'blocked' : 'eligible';
    return {
      mode, state, selected, rolloutDigest: this.rolloutDigest, cohortBps: this.cohortBps,
      ...(bucket !== undefined ? { bucket } : {}), blockers,
      samples, successes, failures, safetyFailures, failureBps,
      minSamples: this.minSamples, maxFailureBps: this.maxFailureBps,
      tripped: this.state.tripped,
      ...(this.state.tripReason ? { tripReason: this.state.tripReason } : {}),
      ...(this.state.trippedAtMs ? { trippedAtMs: this.state.trippedAtMs } : {}),
    };
  }

  public assertAllowed(): void {
    const status = this.status();
    if (!status.selected) throw new NativeRolloutRollbackError(status.blockers.join(',') || status.state);
  }

  public recordSuccess(tool: string): void {
    this.record(tool, 'success');
  }

  public recordError(tool: string, error: unknown): void {
    const outcome = classifyNativeRolloutError(error);
    if (outcome) this.record(tool, outcome, safeCode(error));
  }

  /** Explicit operator action used by `/computer backend`. */
  public setMode(mode: NativeRolloutMode): NativeRolloutStatus {
    this.state.operatorMode = mode;
    this.persist();
    return this.status();
  }

  /** Explicit operator acknowledgement; changing modes alone never clears a safety trip. */
  public resetCircuit(): NativeRolloutStatus {
    this.state.tripped = false;
    delete this.state.tripReason;
    delete this.state.trippedAtMs;
    this.state.samples = [];
    this.persist();
    return this.status();
  }

  private record(tool: string, outcome: NativeRolloutOutcome, code?: string): void {
    const sample: NativeRolloutSample = {
      atMs: this.now(), outcome, tool: tool.slice(0, 64), ...(code ? { code } : {}),
    };
    this.state.samples.push(sample);
    if (this.state.samples.length > this.maxSamples) {
      this.state.samples.splice(0, this.state.samples.length - this.maxSamples);
    }
    const status = this.status();
    if (!this.state.tripped && outcome === 'safety_failure') {
      this.trip(`safety_failure:${code ?? 'native_invariant'}`);
      return;
    }
    if (!this.state.tripped && status.samples >= this.minSamples
        && status.failureBps > this.maxFailureBps) {
      this.trip(`failure_budget_exceeded:${status.failureBps}bps`);
      return;
    }
    // Success telemetry is persisted in batches; faults persist immediately. This keeps the hot
    // action path free of per-call disk latency without letting a crash erase rollback evidence.
    if (outcome !== 'success' || this.state.samples.length % 10 === 0) this.persist();
  }

  private trip(reason: string): void {
    this.state.tripped = true;
    this.state.tripReason = reason.slice(0, 160);
    this.state.trippedAtMs = this.now();
    this.persist();
  }

  private load(): NativeRolloutStateFile {
    const empty = (): NativeRolloutStateFile => ({
      version: 1, rolloutDigest: this.rolloutDigest, tripped: false, samples: [],
    });
    if (!this.statePath || !existsSync(this.statePath)) return empty();
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<NativeRolloutStateFile>;
      if (parsed.version !== 1 || parsed.rolloutDigest !== this.rolloutDigest
          || typeof parsed.tripped !== 'boolean' || !Array.isArray(parsed.samples)) return empty();
      const samples = parsed.samples.filter((sample): sample is NativeRolloutSample => {
        if (!sample || typeof sample !== 'object') return false;
        return Number.isSafeInteger(sample.atMs)
          && (sample.outcome === 'success' || sample.outcome === 'failure' || sample.outcome === 'safety_failure')
          && typeof sample.tool === 'string' && sample.tool.length <= 64
          && (sample.code === undefined || (typeof sample.code === 'string' && sample.code.length <= 128));
      }).slice(-this.maxSamples);
      const operatorMode = parsed.operatorMode;
      return {
        version: 1, rolloutDigest: this.rolloutDigest, tripped: parsed.tripped,
        ...(operatorMode === 'off' || operatorMode === 'manual' || operatorMode === 'cohort'
          || operatorMode === 'native' ? { operatorMode } : {}),
        ...(typeof parsed.tripReason === 'string' ? { tripReason: parsed.tripReason.slice(0, 160) } : {}),
        ...(Number.isSafeInteger(parsed.trippedAtMs) ? { trippedAtMs: parsed.trippedAtMs } : {}),
        samples,
      };
    } catch { return empty(); }
  }

  private persist(): void {
    if (!this.statePath) return;
    try {
      mkdirSync(path.dirname(this.statePath), { recursive: true, mode: 0o700 });
      const temp = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, this.statePath);
    } catch { /* rollout persistence is best-effort; in-memory trip remains authoritative */ }
  }
}

export const globalNativeRolloutController = new NativeRolloutController();
