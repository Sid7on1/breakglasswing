// Phase 8 slice 1 — the causal evidence vocabulary (V28B/V29B, S28-A step 1).
//
// These tests exist to fail when the honesty invariants are removed. Each block names the rule from
// docs/product-reset/08_ACCEPTANCE_GATES.md or 11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md that
// it is protecting, and asserts the end state (the record is rejected / the verdict is unknown) —
// not that a function was called.

import {
  COMPLETE, EVIDENCE_SCHEMA, RULE_IDS, admissible, canonicalJson, combineBasis, concludeSatisfied,
  dispositionCeiling, emptyBoundary, factsRedacted, gap, isRuleId, noEffects, redactFacts,
  ruleLayer, validate, Decision, Finding, Observation, Verification, Rollback,
} from '../evidence/schema';
import { EvidenceLedger, EvidenceRejected, evidenceId, record, seal } from '../evidence/ledger';

const observationDraft = (over: Partial<Parameters<typeof record.observation>[0]> = {}) => record.observation({
  sensor: 'engine.tool',
  scope: 'task',
  sensitivity: 'project',
  retention: 'task',
  taskIntentId: 'task_a',
  operationIntentId: 'op_a',
  subject: { kind: 'file', id: '/work/app/src/index.ts', provenance: 'observed' },
  relationship: null,
  facts: redactFacts({ bytes: 12 }),
  freshnessMs: 0,
  completeness: COMPLETE,
  ...over,
}, 1_000);

const finding = (over: Partial<Finding> = {}): Finding => ({
  ruleId: RULE_IDS.WRITE_OUTSIDE_BOUNDARY,
  layer: 'B',
  what: 'wrote outside the approved project root',
  violated: 'TaskBoundary.writeRoots',
  subjects: [{ kind: 'agent', id: 'bimax.engine' }, { kind: 'file', id: '/work/other/x' }],
  benignExplanations: ['a build tool with a configured out-of-tree cache'],
  evidence: [{ observationId: 'obs_1', why: 'the write itself' }],
  ...over,
});

const decisionDraft = (over: Partial<Parameters<typeof record.decision>[0]> = {}) => record.decision({
  taskIntentId: 'task_a',
  operationIntentId: 'op_a',
  ruleVersion: 'bimax.rules/1',
  modelVersion: null,
  layer: 'B',
  factors: {
    hardBoundary: false, taskMismatch: true, identityTrust: 'known', targetSensitivity: 'project',
    persistencePotential: false, networkNovelty: false, causalCombination: false,
    observationCompleteness: COMPLETE, anomalyConfidence: null,
  },
  disposition: 'block',
  findings: [finding()],
  evidenceBasis: 'observed',
  modelExplanation: null,
  ...over,
}, 2_000);

describe('evidence schema — content addressing', () => {
  it('derives the same id for identical content and a different id for mutated content', () => {
    const a = observationDraft();
    const b = observationDraft();
    expect(a.id).toBe(b.id);
    const tampered = { ...a, facts: { bytes: 13 } } as Observation;
    expect(evidenceId({ ...tampered, id: '' } as Observation)).not.toBe(a.id);
  });

  it('canonicalises key order so two spellings of one record hash alike', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }))
      .toBe(canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
  });

  it('stamps every record with the shared schema line', () => {
    expect(observationDraft().schema).toBe(EVIDENCE_SCHEMA);
  });
});

describe('evidence schema — redaction (§4: never store credentials, env, contents)', () => {
  it.each([
    ['AWS_SECRET_ACCESS_KEY', { AWS_SECRET_ACCESS_KEY: 'AKIA…' }],
    ['apiKey', { apiKey: 'sk-live-1' }],
    ['Authorization', { Authorization: 'Bearer abc' }],
    ['env', { env: { PATH: '/usr/bin' } }],
    ['fileContents', { fileContents: 'private key material' }],
  ])('redacts %s', (_label, raw) => {
    const facts = redactFacts(raw);
    expect(JSON.stringify(facts)).not.toContain('AKIA');
    expect(JSON.stringify(facts)).not.toContain('sk-live-1');
    expect(JSON.stringify(facts)).not.toContain('Bearer abc');
    expect(JSON.stringify(facts)).not.toContain('/usr/bin');
    expect(JSON.stringify(facts)).not.toContain('private key material');
    expect(factsRedacted(facts)).toBe(true);
  });

  it('redacts nested secrets, not only top-level ones', () => {
    const facts = redactFacts({ request: { headers: { cookie: 'session=1' } } });
    expect(JSON.stringify(facts)).not.toContain('session=1');
    expect(factsRedacted(facts)).toBe(true);
  });

  it('drops URL query strings but keeps the endpoint identity a decision needs', () => {
    const facts = redactFacts({ url: 'https://registry.example.com/pkg?token=abc123' });
    expect(facts.url).toBe('https://registry.example.com/pkg?[redacted]');
  });

  it('rejects an Observation whose facts were hand-built around the redactor', () => {
    const smuggled = seal<Observation>({
      ...observationDraft(), id: '', facts: { password: 'hunter2' },
    } as Observation);
    expect(validate(smuggled).ok).toBe(false);
    expect(validate(smuggled).violations.join()).toMatch(/secret-bearing key/);
  });

  it('refuses to classify an observation as secret rather than redacting it', () => {
    const wrong = seal<Observation>({ ...observationDraft(), id: '', sensitivity: 'secret' } as Observation);
    expect(validate(wrong).ok).toBe(false);
  });
});

describe('evidence schema — trust hierarchy (§2.3, §6: no model-only block)', () => {
  it('bounds each detection layer by its ceiling', () => {
    expect(dispositionCeiling('A')).toBe('repair');
    expect(dispositionCeiling('B')).toBe('block');
    expect(dispositionCeiling('C')).toBe('require-approval');
    expect(dispositionCeiling('D')).toBe('recommend');
    expect(dispositionCeiling('E')).toBe('recommend');
    expect(dispositionCeiling('F')).toBe('explain');
  });

  it('rejects a model-layer decision that tries to block', () => {
    const modelBlock = decisionDraft({
      layer: 'F', disposition: 'block', modelVersion: 'test-model/1',
      modelExplanation: 'this looks like exfiltration',
      findings: [finding({ ruleId: RULE_IDS.MODEL_HYPOTHESIS, layer: 'F' })],
    });
    const result = validate(modelBlock);
    expect(result.ok).toBe(false);
    expect(result.violations.join()).toMatch(/layer F may not reach disposition block/);
  });

  it('rejects a statistical anomaly that tries to repair', () => {
    const anomalyRepair = decisionDraft({
      layer: 'E', disposition: 'repair',
      findings: [finding({ ruleId: RULE_IDS.STATISTICAL_ANOMALY, layer: 'E' })],
      factors: { ...decisionDraft().factors, anomalyConfidence: 0.99 },
    });
    expect(validate(anomalyRepair).ok).toBe(false);
  });

  it('accepts a deterministic Layer B block', () => {
    expect(validate(decisionDraft()).ok).toBe(true);
  });

  it('rejects a block backed only by advisory findings', () => {
    const advisoryOnly = decisionDraft({
      layer: 'B', disposition: 'block',
      findings: [finding({ ruleId: RULE_IDS.PROVENANCE_ANOMALY, layer: 'D' })],
    });
    expect(validate(advisoryOnly).violations.join()).toMatch(/deterministic Layer A\/B\/C finding/);
  });

  it('rejects a finding whose claimed layer contradicts its rule id', () => {
    const mislabelled = decisionDraft({
      findings: [finding({ ruleId: RULE_IDS.CREDENTIAL_READ, layer: 'B' })],
    });
    expect(validate(mislabelled).violations.join()).toMatch(/claims layer B/);
    expect(ruleLayer(RULE_IDS.CREDENTIAL_READ)).toBe('A');
  });

  it('rejects an unregistered rule id, so every finding is lookup-able', () => {
    const unknown = decisionDraft({ findings: [finding({ ruleId: 'BMX-B-MADE-UP' })] });
    expect(isRuleId('BMX-B-MADE-UP')).toBe(false);
    expect(validate(unknown).violations.join()).toMatch(/unregistered rule/);
  });

  it('rejects a vacuous finding that cites no observation', () => {
    const vacuous = decisionDraft({ findings: [finding({ evidence: [] })] });
    expect(validate(vacuous).violations.join()).toMatch(/vacuous finding/);
  });

  it('requires a benign explanation outside Layer A', () => {
    const noAlternative = decisionDraft({ findings: [finding({ benignExplanations: [] })] });
    expect(validate(noAlternative).violations.join()).toMatch(/plausible benign explanation/);
  });

  it('requires a model version whenever a model explanation is attached', () => {
    const unattributed = decisionDraft({ modelExplanation: 'probably fine', modelVersion: null });
    expect(validate(unattributed).violations.join()).toMatch(/model version/);
  });
});

describe('evidence schema — an evidence gap can never read as safe', () => {
  it('marks a dropped-event completeness inadmissible', () => {
    expect(admissible(COMPLETE)).toBe(true);
    expect(admissible(gap('XPC queue overflowed', 12))).toBe(false);
  });

  it('refuses to let a decision on incomplete evidence settle at observe', () => {
    const quiet = decisionDraft({
      layer: 'B', disposition: 'observe', findings: [],
      factors: { ...decisionDraft().factors, observationCompleteness: gap('event queue overflowed', 3) },
    });
    expect(validate(quiet).violations.join()).toMatch(/may not settle at observe/);
  });

  it('downgrades a positive verification to unknown when evidence is stale', () => {
    expect(concludeSatisfied(true, 9_000, 2_000, COMPLETE)).toBeNull();
  });

  it('downgrades a positive verification to unknown when events were dropped', () => {
    expect(concludeSatisfied(true, 0, 2_000, gap('sensor unavailable', 1))).toBeNull();
  });

  it('keeps a negative verdict negative even on patchy evidence', () => {
    expect(concludeSatisfied(false, 9_000, 2_000, gap('sensor unavailable', 1))).toBe(false);
  });

  it('rejects a hand-written satisfied verification built on stale evidence', () => {
    const lie = seal<Verification>({
      schema: EVIDENCE_SCHEMA, kind: 'Verification', id: '', createdAt: 3_000,
      actionReceiptId: 'rcp_1', postcondition: 'the lockfile matches the approved digest',
      satisfied: true, freshnessMs: 60_000, freshnessBudgetMs: 5_000, completeness: COMPLETE,
      basis: 'observed', evidence: [{ observationId: 'obs_1', why: 'the lockfile digest' }],
      reason: 'looked right',
    } as Verification);
    const result = validate(lie);
    expect(result.ok).toBe(false);
    expect(result.violations.join()).toMatch(/complete, fresh evidence/);
  });

  it('rejects a satisfied verification that cites nothing', () => {
    const uncited = seal<Verification>({
      schema: EVIDENCE_SCHEMA, kind: 'Verification', id: '', createdAt: 3_000,
      actionReceiptId: 'rcp_1', postcondition: 'p', satisfied: true, freshnessMs: 0,
      freshnessBudgetMs: 5_000, completeness: COMPLETE, basis: 'observed', evidence: [], reason: 'trust me',
    } as Verification);
    expect(validate(uncited).violations.join()).toMatch(/cite the observations/);
  });

  it('rejects a restored rollback with no independent verification (S28-C fake-repair mutant)', () => {
    const fakeRepair = seal<Rollback>({
      schema: EVIDENCE_SCHEMA, kind: 'Rollback', id: '', createdAt: 4_000,
      actionReceiptId: 'rcp_1', target: 'checkpoint_7', result: 'restored',
      verificationId: null, reason: 'restored the lockfile',
    } as Rollback);
    expect(validate(fakeRepair).violations.join()).toMatch(/independent Verification/);
  });
});

describe('evidence schema — boundary and intent shape', () => {
  it('never grants security-setting mutation, even when a producer asks for it', () => {
    const intent = seal(record.taskIntent({
      summary: 'run tests', projectRoot: '/work/app',
      boundary: { ...emptyBoundary({ readRoots: ['/work/app'] }), allowSecuritySettings: true } as never,
      approvalMode: 'interactive',
    }, 100));
    expect(validate(intent).violations.join()).toMatch(/never be granted/);
  });

  it('requires absolute normalized boundary roots', () => {
    const intent = record.taskIntent({
      summary: 'run tests', projectRoot: '/work/app',
      boundary: emptyBoundary({ writeRoots: ['app/src'] }),
      approvalMode: 'interactive',
    }, 100);
    expect(validate(intent).violations.join()).toMatch(/absolute normalized paths/);
  });

  it('rejects an operation that declares itself read-only and mutating at once', () => {
    const op = record.operationIntent({
      taskIntentId: 'task_a', parentOperationId: null, subsystem: 'engine-tool',
      operation: 'Read', actor: { kind: 'agent', id: 'bimax.engine' },
      declared: noEffects({ readOnly: true, writes: ['/work/app/x'] }), taint: [],
    }, 200);
    expect(validate(op).violations.join()).toMatch(/readOnly and mutations/);
  });

  it('rejects an applied receipt with no after-state', () => {
    const receipt = record.actionReceipt({
      operationIntentId: 'op_a', approvalId: null, executor: 'bash', outcome: 'applied',
      observed: noEffects({ writes: ['/work/app/x'] }), before: ['obs_1'], after: [], reason: 'wrote',
    }, 300);
    expect(validate(receipt).violations.join()).toMatch(/after-state observations/);
  });
});

describe('evidence ledger — append-only, bounded, and honest about what it dropped', () => {
  it('refuses an inadmissible record instead of storing a silent gap', () => {
    const ledger = new EvidenceLedger();
    const bad = decisionDraft({ layer: 'F', disposition: 'repair', modelVersion: 'm/1' });
    expect(() => ledger.append(bad)).toThrow(EvidenceRejected);
    expect(ledger.size).toBe(0);
  });

  it('refuses a record whose seal no longer matches its content', () => {
    const ledger = new EvidenceLedger();
    const observation = observationDraft();
    const forged = { ...observation, freshnessMs: 999_999 } as Observation;
    expect(() => ledger.append(forged)).toThrow(/does not match its content/);
  });

  it('is idempotent — the same content admitted twice is one record', () => {
    const ledger = new EvidenceLedger();
    ledger.append(observationDraft());
    ledger.append(observationDraft());
    expect(ledger.size).toBe(1);
  });

  it('records an eviction note when capacity forces a drop', () => {
    const ledger = new EvidenceLedger({ maxRecords: 2 });
    ledger.append(observationDraft({ facts: redactFacts({ n: 1 }) }));
    ledger.append(observationDraft({ facts: redactFacts({ n: 2 }) }));
    ledger.append(observationDraft({ facts: redactFacts({ n: 3 }) }));
    expect(ledger.size).toBe(2);
    expect(ledger.evictionLog()).toEqual([
      expect.objectContaining({ reason: 'capacity', droppedRecords: 1 }),
    ]);
  });

  it('reports a decision as incomplete once its cited observation is gone', () => {
    let clock = 1_000;
    const ledger = new EvidenceLedger({}, () => clock);
    const observation = ledger.append(observationDraft({ retention: 'session' }));
    const decision = ledger.append(decisionDraft({
      findings: [finding({ evidence: [{ observationId: observation.id, why: 'the write' }] })],
    }) as Decision);
    expect(ledger.completenessOf(decision).complete).toBe(true);

    clock = 1_000 + 13 * 60 * 60 * 1000;
    expect(ledger.applyRetention()).toBe(1);
    const after = ledger.completenessOf(decision);
    expect(after.complete).toBe(false);
    expect(after.missing).toEqual([observation.id]);
  });

  it('deletes a task on request and says so in the eviction log', () => {
    const ledger = new EvidenceLedger();
    ledger.append(observationDraft({ taskIntentId: 'task_a' }));
    ledger.append(observationDraft({ taskIntentId: 'task_b', facts: redactFacts({ n: 2 }) }));
    expect(ledger.deleteTask('task_a')).toBe(1);
    expect(ledger.size).toBe(1);
    expect(ledger.evictionLog()[0]).toMatchObject({ reason: 'user-deletion' });
  });

  it('walks the causal path from a nested operation back to the task', () => {
    const ledger = new EvidenceLedger();
    const root = ledger.append(record.operationIntent({
      taskIntentId: 'task_a', parentOperationId: null, subsystem: 'engine-tool', operation: 'Bash',
      actor: { kind: 'agent', id: 'bimax.engine' }, declared: noEffects(), taint: [],
    }, 10));
    const child = ledger.append(record.operationIntent({
      taskIntentId: 'task_a', parentOperationId: root.id, subsystem: 'engine-tool',
      operation: 'npm test', actor: { kind: 'executable', id: '/usr/bin/npm' },
      declared: noEffects(), taint: [],
    }, 20));
    expect(ledger.causalPath(child.id).map(o => o.operation)).toEqual(['npm test', 'Bash']);
  });

  it('stops the causal walk at a missing link rather than inventing a shorter graph', () => {
    const ledger = new EvidenceLedger();
    const orphan = ledger.append(record.operationIntent({
      taskIntentId: 'task_a', parentOperationId: 'op_evicted', subsystem: 'mcp',
      operation: 'mcp:fs/read', actor: { kind: 'capability', id: 'fs' },
      declared: noEffects(), taint: [],
    }, 30));
    const path = ledger.causalPath(orphan.id);
    expect(path).toHaveLength(1);
    expect(path[0].parentOperationId).toBe('op_evicted');
    expect(ledger.has('op_evicted')).toBe(false);
  });
});

describe('evidence basis — a declaration may refuse, never certify', () => {
  it('treats an unstated provenance as a declaration, the weaker reading', () => {
    expect(combineBasis('observed', 'declared')).toBe('mixed');
    expect(combineBasis('observed', 'observed')).toBe('observed');
  });

  it('rejects a decision that does not say what its findings rest on', () => {
    const unstated = decisionDraft({ evidenceBasis: undefined as never });
    expect(validate(unstated).violations.join()).toMatch(/evidenceBasis must say/);
  });

  it('lets a declaration block, because refusing on intent is legitimate', () => {
    const declaredBlock = decisionDraft({ evidenceBasis: 'declared' });
    expect(validate(declaredBlock).ok).toBe(true);
  });

  it('refuses a repair that rests on a declaration rather than a measurement', () => {
    const declaredRepair = decisionDraft({
      layer: 'A', disposition: 'repair', evidenceBasis: 'declared',
      findings: [finding({ ruleId: RULE_IDS.CREDENTIAL_READ, layer: 'A', benignExplanations: [] })],
    });
    expect(validate(declaredRepair).violations.join()).toMatch(/repair requires observed evidence/);
  });

  it('refuses a satisfied verification that rests on a declaration', () => {
    const declaredPass = seal<Verification>({
      schema: EVIDENCE_SCHEMA, kind: 'Verification', id: '', createdAt: 3_000,
      actionReceiptId: 'rcp_1', postcondition: 'the bundle exists', satisfied: true,
      freshnessMs: 0, freshnessBudgetMs: 5_000, completeness: COMPLETE, basis: 'declared',
      evidence: [{ observationId: 'obs_1', why: 'the declared write' }], reason: 'the tool said so',
    } as Verification);
    expect(validate(declaredPass).violations.join()).toMatch(/requires observed evidence/);
  });

  it('rejects a verification that does not state its basis', () => {
    const unstated = seal<Verification>({
      schema: EVIDENCE_SCHEMA, kind: 'Verification', id: '', createdAt: 3_000,
      actionReceiptId: 'rcp_1', postcondition: 'p', satisfied: null,
      freshnessMs: 0, freshnessBudgetMs: 5_000, completeness: COMPLETE,
      evidence: [], reason: 'unknown',
    } as unknown as Verification);
    expect(validate(unstated).violations.join()).toMatch(/basis must say/);
  });

  it('rejects a finding that names no identity', () => {
    const anonymous = decisionDraft({ findings: [finding({ subjects: [] })] });
    expect(validate(anonymous).violations.join()).toMatch(/names no identity/);
  });
});
