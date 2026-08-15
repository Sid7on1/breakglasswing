import { createHash, randomUUID } from 'node:crypto';

/**
 * Phase 9 / V28B / S28-D — bounded provenance for processes launched by Bimax itself.
 *
 * This is intentionally not a system monitor. It needs no Endpoint Security entitlement and makes
 * no claim about processes Bimax did not launch. PID is an attribute, never the record identity, so
 * PID reuse cannot join two launches. Arguments are classifications supplied by the launcher; raw
 * argv and environment variables are never retained.
 */

export type EvidenceCompleteness = 'complete' | 'partial' | 'gap';
export type ProcessOutcome = 'running' | 'exited' | 'signalled' | 'spawn-error';

export interface EndpointMetadata {
  host: string;
  port: number;
  transport: 'tcp' | 'udp' | 'quic' | 'unknown';
  direction: 'outbound' | 'inbound';
  bytesBand: 'none' | 'tiny' | 'small' | 'medium' | 'large' | 'unknown';
  declared: boolean;
  observedAt: number;
}

export interface ProcessProvenanceRecord {
  launchId: string;
  pid: number | null;
  parentLaunchId: string | null;
  executable: { basename: string; digest: string | null; signer: string | null };
  cwdClass: 'project' | 'app-support' | 'temporary' | 'other';
  argumentClasses: string[];
  startedAt: number;
  endedAt: number | null;
  outcome: ProcessOutcome;
  exitCode: number | null;
  signal: string | null;
  endpoints: EndpointMetadata[];
  completeness: EvidenceCompleteness;
}

export interface BeginProcessInput {
  pid?: number;
  parentLaunchId?: string;
  executableBasename: string;
  executableDigest?: string;
  signer?: string;
  cwdClass: ProcessProvenanceRecord['cwdClass'];
  argumentClasses: string[];
}

function cleanLabel(value: string, max = 80): string {
  return value.replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanHost(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || host.includes('/') || host.includes('@')) return null;
  if (!/^[a-z0-9:[\]._-]+$/.test(host)) return null;
  return host;
}

export class ProcessProvenanceTracker {
  private readonly records = new Map<string, ProcessProvenanceRecord>();
  private readonly order: string[] = [];

  constructor(
    private readonly options: { capacity?: number; now?: () => number; id?: () => string } = {},
  ) {}

  begin(input: BeginProcessInput): string {
    const now = this.options.now?.() ?? Date.now();
    const launchId = `launch_${this.options.id?.() ?? randomUUID()}`;
    const record: ProcessProvenanceRecord = {
      launchId,
      pid: Number.isInteger(input.pid) && (input.pid ?? 0) > 0 ? input.pid! : null,
      parentLaunchId: input.parentLaunchId ?? null,
      executable: {
        basename: cleanLabel(input.executableBasename, 128),
        digest: input.executableDigest?.startsWith('sha256:') ? input.executableDigest : null,
        signer: input.signer ? cleanLabel(input.signer, 160) : null,
      },
      cwdClass: input.cwdClass,
      argumentClasses: [...new Set(input.argumentClasses.map((v) => cleanLabel(v)).filter(Boolean))].slice(0, 24),
      startedAt: now,
      endedAt: null,
      outcome: 'running',
      exitCode: null,
      signal: null,
      endpoints: [],
      completeness: 'complete',
    };
    this.records.set(launchId, record);
    this.order.push(launchId);
    this.evict();
    return launchId;
  }

  endpoint(
    launchId: string,
    input: Omit<EndpointMetadata, 'host' | 'observedAt'> & { host: string },
  ): boolean {
    const record = this.records.get(launchId);
    const host = cleanHost(input.host);
    if (!record || record.outcome !== 'running' || !host) return false;
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) return false;
    record.endpoints.push({ ...input, host, observedAt: this.options.now?.() ?? Date.now() });
    if (record.endpoints.length > 128) {
      record.endpoints.splice(0, record.endpoints.length - 128);
      record.completeness = 'partial';
    }
    return true;
  }

  markGap(launchId: string): boolean {
    const record = this.records.get(launchId);
    if (!record) return false;
    record.completeness = 'gap';
    return true;
  }

  finish(launchId: string, result: { exitCode?: number | null; signal?: string | null; spawnError?: boolean }): boolean {
    const record = this.records.get(launchId);
    if (!record || record.outcome !== 'running') return false;
    record.endedAt = this.options.now?.() ?? Date.now();
    record.exitCode = Number.isInteger(result.exitCode) ? result.exitCode! : null;
    record.signal = result.signal ? cleanLabel(result.signal, 40) : null;
    record.outcome = result.spawnError ? 'spawn-error' : record.signal ? 'signalled' : 'exited';
    return true;
  }

  snapshot(): ProcessProvenanceRecord[] {
    return this.order.flatMap((id) => {
      const record = this.records.get(id);
      return record ? [{ ...record, executable: { ...record.executable }, argumentClasses: [...record.argumentClasses], endpoints: record.endpoints.map((e) => ({ ...e })) }] : [];
    });
  }

  /** A privacy-safe identity for diagnostics; it cannot be reversed into arguments or paths. */
  digest(): string {
    const safe = this.snapshot().map(({ pid: _pid, ...record }) => record);
    return `sha256:${createHash('sha256').update(JSON.stringify(safe)).digest('hex')}`;
  }

  private evict(): void {
    const capacity = Math.max(8, Math.min(10_000, this.options.capacity ?? 512));
    while (this.order.length > capacity) {
      const id = this.order.shift();
      if (id) this.records.delete(id);
    }
  }
}

