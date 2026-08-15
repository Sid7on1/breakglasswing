// The append-only causal evidence ledger — the store behind `src/evidence/schema.ts`.
//
// This file is deliberately NOT mirrored into Desktop. The vocabulary is shared; the store is not.
// Desktop's broker owns its own bounded, deletable store under the Trust Center, and Terminal owns
// this in-memory, task-scoped one. What they must agree on is the id: both sides derive it from
// `identityPayload(record)`, so the same record has the same id in both products and an edited
// record cannot keep the id it was admitted under.
//
// Append-only means: a record can be added, and a record can be *deleted* under a retention or
// user-deletion policy — but no record can be changed in place. §2.2: "Observations are append-only.
// Interpretations may be recomputed when policy changes." Recomputation therefore appends a new
// Decision rather than editing the old one, and the timeline shows both.

import { createHash } from 'node:crypto';
import {
  ActionReceipt, Approval, Decision, EvidenceRecord, Observation, OperationIntent, Retention,
  Rollback, TaskIntent, Verification, identityPayload, idPrefix, validate,
} from './schema';

export class EvidenceRejected extends Error {
  constructor(public readonly violations: string[], kind: string) {
    super(`inadmissible ${kind}: ${violations.join('; ')}`);
    this.name = 'EvidenceRejected';
  }
}

/** The content address of a record: sha256 over its canonical form, minus its own id. */
export function evidenceId(record: EvidenceRecord): string {
  const digest = createHash('sha256').update(identityPayload(record)).digest('hex');
  return `${idPrefix(record.kind)}_${digest.slice(0, 24)}`;
}

/** Stamp a record with its own content address. The only supported way to mint an id. */
export function seal<T extends EvidenceRecord>(record: Omit<T, 'id'> & { id?: string }): T {
  const draft = { ...record, id: '' } as T;
  return { ...draft, id: evidenceId(draft) } as T;
}

/** True when the record's id is the one its content implies — the tamper check. */
export function sealIntact(record: EvidenceRecord): boolean {
  return evidenceId({ ...record, id: '' } as EvidenceRecord) === record.id;
}

/** How long each retention class survives, in ms. `audit` is bounded too — nothing is forever. */
export const RETENTION_MS: Record<Retention, number> = {
  none: 0,
  session: 12 * 60 * 60 * 1000,
  task: 7 * 24 * 60 * 60 * 1000,
  bounded: 30 * 24 * 60 * 60 * 1000,
  audit: 180 * 24 * 60 * 60 * 1000,
};

export interface LedgerLimits {
  /** Hard cap on retained records. The oldest are evicted first, and eviction is itself visible. */
  maxRecords: number;
}

export interface EvictionNote {
  at: number;
  droppedRecords: number;
  reason: 'capacity' | 'retention' | 'user-deletion';
}

const DEFAULT_LIMITS: LedgerLimits = { maxRecords: 5000 };

/**
 * A bounded, append-only ledger with an honest eviction record.
 *
 * The eviction log matters as much as the records: a consumer that asks for the causal path of an
 * operation whose observations were evicted must be told the graph is incomplete, not handed a
 * shorter graph that looks whole. `completenessOf` is how it finds out.
 */
export class EvidenceLedger {
  private readonly records = new Map<string, EvidenceRecord>();
  private readonly order: string[] = [];
  private readonly evictions: EvictionNote[] = [];
  private readonly limits: LedgerLimits;

  constructor(limits: Partial<LedgerLimits> = {}, private readonly now: () => number = Date.now) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * Admit a record. Throws `EvidenceRejected` when the record fails a schema honesty invariant or
   * its seal does not match its content — a producer bug must not become a silent gap.
   */
  append<T extends EvidenceRecord>(record: T): T {
    const result = validate(record);
    if (!result.ok) throw new EvidenceRejected(result.violations, record.kind);
    if (!sealIntact(record)) {
      throw new EvidenceRejected(['record id does not match its content'], record.kind);
    }
    if (this.records.has(record.id)) return this.records.get(record.id) as T;
    this.records.set(record.id, record);
    this.order.push(record.id);
    this.enforceCapacity();
    return record;
  }

  get(id: string): EvidenceRecord | undefined { return this.records.get(id); }

  has(id: string): boolean { return this.records.has(id); }

  get size(): number { return this.records.size; }

  /** Records in admission order. The timeline the Trust Center renders. */
  all(): EvidenceRecord[] {
    return this.order.map(id => this.records.get(id)).filter(Boolean) as EvidenceRecord[];
  }

  ofKind<K extends EvidenceRecord['kind']>(kind: K): Extract<EvidenceRecord, { kind: K }>[] {
    return this.all().filter(r => r.kind === kind) as Extract<EvidenceRecord, { kind: K }>[];
  }

  /** Every eviction this ledger has performed, so a gap can be attributed rather than guessed at. */
  evictionLog(): readonly EvictionNote[] { return this.evictions; }

  /**
   * Drop records whose retention class has expired. Only Observations carry a retention class; the
   * intents, decisions and receipts that cite them are kept, which is why `completenessOf` exists —
   * a Decision can outlive its evidence, and when it does it must say so.
   */
  applyRetention(): number {
    const now = this.now();
    const expired = this.all().filter(record => (
      record.kind === 'Observation' && now - record.createdAt > RETENTION_MS[record.retention]
    ));
    return this.drop(expired.map(r => r.id), 'retention');
  }

  /** The Trust Center delete control. Returns how many records were removed. */
  deleteTask(taskIntentId: string): number {
    const doomed = this.all().filter(record => (
      ('taskIntentId' in record && record.taskIntentId === taskIntentId) || record.id === taskIntentId
    ));
    return this.drop(doomed.map(r => r.id), 'user-deletion');
  }

  /**
   * Whether every observation a record cites is still present. A record whose evidence has been
   * evicted is not wrong — it is unverifiable, and the difference must reach the user.
   */
  completenessOf(record: EvidenceRecord): { complete: boolean; missing: string[] } {
    const cited = citedObservations(record);
    const missing = cited.filter(id => !this.records.has(id));
    return { complete: missing.length === 0, missing };
  }

  /**
   * Walk from an operation to the task that authorized it, following `parentOperationId`. Returns
   * the chain nearest-first. A broken link stops the walk: a partial chain is returned and the
   * caller learns the graph is incomplete by comparing its head against the TaskIntent it wanted.
   */
  causalPath(operationIntentId: string): OperationIntent[] {
    const path: OperationIntent[] = [];
    const seen = new Set<string>();
    let cursor: string | null = operationIntentId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const record = this.records.get(cursor);
      if (!record || record.kind !== 'OperationIntent') break;
      path.push(record);
      cursor = record.parentOperationId;
    }
    return path;
  }

  private drop(ids: string[], reason: EvictionNote['reason']): number {
    let dropped = 0;
    for (const id of ids) {
      if (!this.records.delete(id)) continue;
      const index = this.order.indexOf(id);
      if (index >= 0) this.order.splice(index, 1);
      dropped += 1;
    }
    if (dropped) this.evictions.push({ at: this.now(), droppedRecords: dropped, reason });
    return dropped;
  }

  private enforceCapacity(): void {
    const excess = this.order.length - this.limits.maxRecords;
    if (excess <= 0) return;
    this.drop(this.order.slice(0, excess), 'capacity');
  }
}

/** Observation ids a record depends on for its claim. */
export function citedObservations(record: EvidenceRecord): string[] {
  switch (record.kind) {
    case 'Decision':
      return record.findings.flatMap(f => f.evidence.map(e => e.observationId));
    case 'Verification':
      return record.evidence.map(e => e.observationId);
    case 'ActionReceipt':
      return [...record.before, ...record.after];
    default:
      return [];
  }
}

// --- Typed constructors ------------------------------------------------------------------------
// Every producer goes through these so no subsystem hand-rolls a record, forgets `schema`, or mints
// an id that is not its content address.

type Draft<T extends EvidenceRecord> = Omit<T, 'schema' | 'kind' | 'id' | 'createdAt'>
  & { createdAt?: number };

const build = <T extends EvidenceRecord>(kind: T['kind'], draft: Draft<T>, now: number): T => seal<T>({
  ...(draft as object),
  schema: 'bimax.evidence/1',
  kind,
  createdAt: draft.createdAt ?? now,
} as Omit<T, 'id'>);

export const record = {
  taskIntent: (d: Draft<TaskIntent>, now = Date.now()) => build<TaskIntent>('TaskIntent', d, now),
  operationIntent: (d: Draft<OperationIntent>, now = Date.now()) => build<OperationIntent>('OperationIntent', d, now),
  observation: (d: Draft<Observation>, now = Date.now()) => build<Observation>('Observation', d, now),
  decision: (d: Draft<Decision>, now = Date.now()) => build<Decision>('Decision', d, now),
  approval: (d: Draft<Approval>, now = Date.now()) => build<Approval>('Approval', d, now),
  actionReceipt: (d: Draft<ActionReceipt>, now = Date.now()) => build<ActionReceipt>('ActionReceipt', d, now),
  verification: (d: Draft<Verification>, now = Date.now()) => build<Verification>('Verification', d, now),
  rollback: (d: Draft<Rollback>, now = Date.now()) => build<Rollback>('Rollback', d, now),
};
