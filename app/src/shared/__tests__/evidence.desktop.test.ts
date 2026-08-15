// Phase 8 completion — the Desktop half of the contextual evidence plane.
//
// Grades three things the engine-side suites cannot:
//   - the store's ingest boundary (§9: main validates; the renderer is never trusted with a record);
//   - the Mac action adapter, the one subsystem that genuinely observes an end state;
//   - S28-09: "permission denied/revoked → core Code works; sensor reports unavailable without
//     retry storm".

import {
  DesktopEvidenceStore, MAX_BACKOFF_MS, codingAffectedBy, nextAttempt, sensorStatus,
} from '../../main/evidence.store';
import {
  MAC_FRESHNESS_BUDGET_MS, MacActionSummary, macActionEvidence, macEvidenceRecords, macTargetIdentity,
} from '../mac.evidence';
import { COMPLETE, EvidenceRecord, Observation, redactFacts, validate } from '../evidence.gen';
import { buildEvidenceTimeline } from '../evidence.timeline';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../evidence.gen';

const TASK = 'task_1';

/** Seal a record the way the engine does, so the store's recomputed check passes. */
function seal<T extends EvidenceRecord>(draft: Omit<T, 'id'> & { id?: string }, prefix: string): T {
  const withoutId = { ...draft, id: '' } as T;
  const { id: _ignored, ...rest } = withoutId as T & { id: string };
  const digest = createHash('sha256').update(canonicalJson(rest)).digest('hex').slice(0, 24);
  return { ...withoutId, id: `${prefix}_${digest}` } as T;
}

const observation = (over: Partial<Observation> = {}): Observation => seal<Observation>({
  schema: 'bimax.evidence/1', kind: 'Observation', createdAt: 1_000,
  sensor: 'engine.tool', scope: 'task', sensitivity: 'project', retention: 'task',
  taskIntentId: TASK, operationIntentId: 'op_1',
  subject: { kind: 'file', id: '/work/app/src/a.ts', provenance: 'observed' },
  relationship: null, facts: redactFacts({}), freshnessMs: 0, completeness: COMPLETE,
  ...over,
} as Omit<Observation, 'id'>, 'obs');

describe('the Desktop store validates at the door', () => {
  it('accepts a well-formed record', () => {
    const store = new DesktopEvidenceStore();
    expect(store.ingest(observation()).accepted).toBe(true);
    expect(store.size).toBe(1);
  });

  it('refuses a record whose content was edited after sealing', () => {
    const store = new DesktopEvidenceStore();
    const record = observation();
    const result = store.ingest({ ...record, freshnessMs: 90_000 });
    expect(result.accepted).toBe(false);
    expect(result.violations).toEqual(['record id does not match its content']);
    expect(store.size).toBe(0);
  });

  it('refuses a record that fails a schema honesty invariant', () => {
    const store = new DesktopEvidenceStore();
    const smuggled = seal<Observation>({
      ...observation(), id: undefined, facts: { password: 'hunter2' },
    } as unknown as Omit<Observation, 'id'>, 'obs');
    const result = store.ingest(smuggled);
    expect(result.accepted).toBe(false);
    expect(result.violations.join()).toMatch(/secret-bearing key/);
  });

  it('reports each refusal in a batch without losing the good records', () => {
    const store = new DesktopEvidenceStore();
    const good = observation();
    const bad = { ...observation({ freshnessMs: 5 }), id: 'obs_forged' } as Observation;
    const result = store.ingestAll([good, bad]);
    expect(result.accepted).toBe(1);
    expect(result.refused).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it('is idempotent for the same content', () => {
    const store = new DesktopEvidenceStore();
    store.ingest(observation());
    store.ingest(observation());
    expect(store.size).toBe(1);
  });
});

describe('deletion is real and visible', () => {
  it('removes a task\'s records and records the eviction', () => {
    const store = new DesktopEvidenceStore();
    store.ingest(observation());
    store.ingest(observation({ taskIntentId: 'task_2', facts: redactFacts({ n: 2 }) }));
    expect(store.deleteTask(TASK)).toBe(1);
    expect(store.size).toBe(1);
    expect(store.evictionLog()[0]).toMatchObject({ reason: 'user-deletion', droppedRecords: 1 });
  });

  it('removes every observation on request', () => {
    const store = new DesktopEvidenceStore();
    store.ingest(observation());
    store.ingest(observation({ facts: redactFacts({ n: 2 }) }));
    expect(store.deleteObservations()).toBe(2);
    expect(store.size).toBe(0);
  });

  it('removes everything on request', () => {
    const store = new DesktopEvidenceStore();
    store.ingest(observation());
    expect(store.deleteAll()).toBe(1);
    expect(store.size).toBe(0);
  });

  it('expires observations by retention class and says it did', () => {
    let clock = 1_000;
    const store = new DesktopEvidenceStore({ now: () => clock });
    store.ingest(observation({ retention: 'session' }));
    clock = 1_000 + 13 * 60 * 60 * 1000;
    expect(store.applyRetention()).toBe(1);
    expect(store.evictionLog()[0].reason).toBe('retention');
  });

  it('evicts on capacity and the timeline reads that as a gap', () => {
    const store = new DesktopEvidenceStore({ maxRecords: 1 });
    store.ingest(observation());
    store.ingest(observation({ facts: redactFacts({ n: 2 }) }));
    expect(store.size).toBe(1);
    const timeline = buildEvidenceTimeline(store.all(), [...store.evictionLog()]);
    expect(timeline.hasEvidenceGap).toBe(true);
  });
});

describe('a Mac action becomes evidence on the same timeline', () => {
  const summary = (over: Partial<MacActionSummary> = {}): MacActionSummary => ({
    action: 'mac.click',
    targetBundleId: 'com.apple.Notes',
    targetLabel: 'New Note',
    executor: 'native-semantic',
    outcome: 'applied',
    observationAgeMs: 40,
    postcondition: 'a new note is focused and editable',
    postconditionHeld: true,
    observationGap: null,
    reason: 'the focused element became an editable text area',
    ...over,
  });

  const ids = {
    taskIntentId: TASK, operationIntentId: 'op_mac', observationId: 'obs_mac',
    actionReceiptId: 'rcp_mac', verificationId: 'ver_mac',
  };

  it('produces records that all validate', () => {
    const bundle = macActionEvidence(summary(), ids, null, 2_000);
    for (const record of macEvidenceRecords(bundle)) expect(validate(record).ok).toBe(true);
    expect(bundle.operation.subsystem).toBe('computer-use');
  });

  it('is the one subsystem that can certify an end state', () => {
    const bundle = macActionEvidence(summary(), ids, null, 2_000);
    expect(bundle.verification.basis).toBe('observed');
    expect(bundle.verification.satisfied).toBe(true);
  });

  it('collapses to unknown when the frame it decided on was stale', () => {
    const bundle = macActionEvidence(
      summary({ observationAgeMs: MAC_FRESHNESS_BUDGET_MS + 1 }), ids, null, 2_000,
    );
    expect(bundle.verification.satisfied).toBeNull();
    expect(bundle.verification.reason).toContain('could not be established');
    expect(validate(bundle.verification).ok).toBe(true);
  });

  it('collapses to unknown when the provider knows its observation was partial', () => {
    const bundle = macActionEvidence(
      summary({ observationGap: 'an accessibility notification was dropped' }), ids, null, 2_000,
    );
    expect(bundle.verification.satisfied).toBeNull();
    expect(bundle.observation.completeness.complete).toBe(false);
  });

  it('reports a genuine negative as false, not as unknown', () => {
    const bundle = macActionEvidence(summary({ postconditionHeld: false }), ids, null, 2_000);
    expect(bundle.verification.satisfied).toBe(false);
  });

  it('never lets a pid or a native handle cross the boundary', () => {
    const bundle = macActionEvidence(summary(), ids, null, 2_000);
    const serialised = JSON.stringify(macEvidenceRecords(bundle));
    expect(serialised).not.toMatch(/"pid"/);
    expect(serialised).not.toMatch(/auditToken/i);
    expect(bundle.observation.subject.id).toBe('com.apple.Notes');
    expect(macTargetIdentity('com.apple.Notes', 'x').provenance).toBe('macos');
  });

  it('nests under the tool call that requested it', () => {
    const bundle = macActionEvidence(summary(), ids, 'op_parent', 2_000);
    expect(bundle.operation.parentOperationId).toBe('op_parent');
  });

  it('cites no after-state when the action was refused', () => {
    const bundle = macActionEvidence(
      summary({ outcome: 'refused', executor: 'refused', postconditionHeld: false }), ids, null, 2_000,
    );
    expect(bundle.receipt.after).toEqual([]);
    expect(validate(bundle.receipt).ok).toBe(true);
  });
});

describe('S28-09 — a denied or revoked sensor does not become a retry storm', () => {
  it('never schedules another attempt after a denial', () => {
    const status = sensorStatus('accessibility', 'denied', 1, 1_000);
    expect(status.nextAttemptAt).toBeNull();
    expect(status.detail).toContain('will not ask again');
  });

  it('never schedules another attempt after a revocation', () => {
    const status = sensorStatus('screenRecording', 'revoked', 4, 1_000);
    expect(status.nextAttemptAt).toBeNull();
    expect(status.detail).toContain('will not re-prompt');
  });

  it('backs off a transient outage and caps the backoff', () => {
    expect(nextAttempt('unavailable', 1, 0)).toBe(5_000);
    expect(nextAttempt('unavailable', 2, 0)).toBe(10_000);
    expect(nextAttempt('unavailable', 20, 0)).toBe(MAX_BACKOFF_MS);
  });

  it('schedules nothing when the sensor is available', () => {
    expect(nextAttempt('available', 3, 0)).toBeNull();
  });

  it('leaves coding unaffected whatever the sensor is doing', () => {
    for (const availability of ['available', 'denied', 'revoked', 'unavailable'] as const) {
      expect(codingAffectedBy(sensorStatus('accessibility', availability, 1, 0))).toBe(false);
    }
  });
});
