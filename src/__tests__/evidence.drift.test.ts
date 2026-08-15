// Phase 8 completion — project and environment drift (V28B, S28-B).
//
// The slice exit in docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §10:
// "deterministic fixtures distinguish normal build cleanup from unrelated executable, persistence,
// and credential-path mutations". The slice rule is "ship explain/recommend only", and §4's sensor
// constraints — tolerate coalescing, rescan after overflow, never infer an actor from an FSEvent —
// are graded here as behaviour, not read as advice.

import {
  ChangeBatch, DEFAULT_ALERT_BUDGET, DriftItem, ProjectBaseline, ProjectSnapshot, WATCHER_IDENTITY,
  applyAlertBudget, detectDrift, driftDisposition, driftFinding, driftObservation,
} from '../evidence/drift';
import { admissible, dispositionRank, validate } from '../evidence/schema';
import { EvidenceLedger, record } from '../evidence/ledger';

const HOME = '/Users/dev';
const PROJECT = '/Users/dev/work/app';

const baseline = (over: Partial<ProjectBaseline> = {}): ProjectBaseline => ({
  projectRoot: PROJECT,
  declarations: { [`${PROJECT}/package-lock.json`]: 'digest-a', [`${PROJECT}/package.json`]: 'digest-p' },
  executables: [`${PROJECT}/node_modules/.bin/tsc`],
  toolchain: { node: '20.11.1', pnpm: '9.1.0' },
  endpoints: ['registry.npmjs.org'],
  buildRoots: [`${PROJECT}/dist`],
  ...over,
});

const snapshot = (over: Partial<ProjectSnapshot> = {}): ProjectSnapshot => ({
  declarations: { [`${PROJECT}/package-lock.json`]: 'digest-a', [`${PROJECT}/package.json`]: 'digest-p' },
  executables: [`${PROJECT}/node_modules/.bin/tsc`],
  toolchain: { node: '20.11.1', pnpm: '9.1.0' },
  endpoints: ['registry.npmjs.org'],
  ...over,
});

const batch = (paths: string[], over: Partial<ChangeBatch> = {}): ChangeBatch => ({
  events: paths.map(path => ({ path, coalesced: false, at: 1_000 })),
  overflowed: false,
  sequence: 1,
  ...over,
});

const kinds = (items: DriftItem[]) => items.map(i => i.kind);

describe('normal build activity is not drift', () => {
  it('says nothing about writes and deletes inside a declared build root', () => {
    const report = detectDrift(
      baseline(), snapshot(),
      batch([`${PROJECT}/dist/bundle.js`, `${PROJECT}/dist/chunk-1.js`]),
      { home: HOME },
    );
    expect(report.items).toEqual([]);
    expect(admissible(report.completeness)).toBe(true);
  });

  it('keeps a build-output item at observe even if one is produced', () => {
    const item: DriftItem = {
      kind: 'executable-added', path: `${PROJECT}/dist/cli`, pathClass: 'build-output',
      detail: 'built', inBuildOutput: true,
    };
    expect(driftDisposition(item)).toBe('observe');
  });

  it('does not treat toolchain caches or temp paths as writes outside the project', () => {
    const report = detectDrift(
      baseline(), snapshot(),
      batch([`${HOME}/Library/Caches/npm/x`, '/tmp/build-scratch']),
      { home: HOME },
    );
    expect(report.items).toEqual([]);
  });
});

describe('S28-B exit — unrelated executable, persistence and credential mutations are distinguished', () => {
  it('reports a new executable outside build output', () => {
    const report = detectDrift(
      baseline(), snapshot({ executables: [`${PROJECT}/node_modules/.bin/tsc`, `${PROJECT}/tools/collect`] }),
      batch([]), { home: HOME },
    );
    expect(kinds(report.items)).toEqual(['executable-added']);
    expect(driftDisposition(report.items[0])).toBe('recommend');
  });

  it('reports a persistence path that changed inside an approved root', () => {
    const report = detectDrift(
      baseline(), snapshot(),
      batch([`${HOME}/Library/LaunchAgents/com.pkg.helper.plist`]), { home: HOME },
    );
    expect(kinds(report.items)).toEqual(['persistence-path-touched']);
    expect(driftDisposition(report.items[0])).toBe('recommend');
  });

  it('reports a credential path that changed', () => {
    const report = detectDrift(baseline(), snapshot(), batch([`${HOME}/.ssh/id_ed25519`]), { home: HOME });
    expect(kinds(report.items)).toEqual(['credential-path-touched']);
    expect(report.items[0].pathClass).toBe('credential');
  });

  it('reports a lockfile change and an undeclared endpoint at explain, not higher', () => {
    const report = detectDrift(
      baseline(),
      snapshot({
        declarations: { [`${PROJECT}/package-lock.json`]: 'digest-b', [`${PROJECT}/package.json`]: 'digest-p' },
        endpoints: ['registry.npmjs.org', 'telemetry.example.net'],
      }),
      batch([]), { home: HOME },
    );
    expect(kinds(report.items).sort()).toEqual(['endpoint-added', 'lockfile-changed']);
    for (const item of report.items) expect(driftDisposition(item)).toBe('explain');
  });

  it('reports a toolchain version move', () => {
    const report = detectDrift(
      baseline(), snapshot({ toolchain: { node: '22.0.0', pnpm: '9.1.0' } }), batch([]), { home: HOME },
    );
    expect(kinds(report.items)).toEqual(['toolchain-changed']);
    expect(report.items[0].detail).toBe('node moved from 20.11.1 to 22.0.0');
  });

  it('is deterministic — the same inputs produce the same bytes', () => {
    const inputs = () => detectDrift(
      baseline(),
      snapshot({ executables: [`${PROJECT}/b`, `${PROJECT}/a`], endpoints: ['z.example', 'a.example'] }),
      batch([`${HOME}/.ssh/id_ed25519`, `${HOME}/Library/LaunchAgents/x.plist`]), { home: HOME },
    );
    expect(JSON.stringify(inputs())).toBe(JSON.stringify(inputs()));
  });
});

describe('drift can never reach an authority it has no right to', () => {
  it('caps every drift kind at recommend', () => {
    const everyKind: DriftItem['kind'][] = [
      'lockfile-changed', 'declaration-changed', 'executable-added', 'executable-removed',
      'toolchain-changed', 'endpoint-added', 'credential-path-touched', 'persistence-path-touched',
      'write-outside-project',
    ];
    for (const kind of everyKind) {
      const disposition = driftDisposition({ kind, path: '/x', pathClass: 'external', detail: '', inBuildOutput: false });
      expect(dispositionRank(disposition)).toBeLessThanOrEqual(dispositionRank('recommend'));
    }
  });

  it('never names a process as the actor — an FSEvent cannot identify one', () => {
    const ledger = new EvidenceLedger();
    const report = detectDrift(baseline(), snapshot(), batch([`${HOME}/.ssh/id_ed25519`]), { home: HOME });
    const observation = ledger.append(driftObservation(report.items[0], 'task_1', report.completeness, 2_000));
    const finding = driftFinding(report.items[0], observation);
    expect(finding.subjects[0]).toEqual(WATCHER_IDENTITY);
    expect(finding.subjects.map(s => s.kind)).toEqual(['agent', 'file']);
    expect(finding.subjects.some(s => s.kind === 'process')).toBe(false);
  });

  it('produces findings that survive schema validation inside a real Decision', () => {
    const ledger = new EvidenceLedger();
    const report = detectDrift(baseline(), snapshot(), batch([`${HOME}/Library/LaunchAgents/x.plist`]), { home: HOME });
    const observation = ledger.append(driftObservation(report.items[0], 'task_1', report.completeness, 2_000));
    const finding = driftFinding(report.items[0], observation);
    const decision = record.decision({
      taskIntentId: 'task_1', operationIntentId: 'op_1', ruleVersion: 'bimax.rules/1.0.0',
      modelVersion: null, layer: finding.layer,
      factors: {
        hardBoundary: false, taskMismatch: false, identityTrust: 'known', targetSensitivity: 'sensitive',
        persistencePotential: true, networkNovelty: false, causalCombination: false,
        observationCompleteness: report.completeness, anomalyConfidence: null,
      },
      disposition: driftDisposition(report.items[0]), findings: [finding],
      evidenceBasis: 'observed', modelExplanation: null,
    }, 3_000);
    expect(validate(decision).ok).toBe(true);
    expect(() => ledger.append(decision)).not.toThrow();
  });
});

describe('the sensor is honest about what it missed', () => {
  it('declares an overflow as an evidence gap and demands a rescan', () => {
    const report = detectDrift(
      baseline(), snapshot(),
      batch([`${PROJECT}/src/a.ts`], { overflowed: true }), { home: HOME },
    );
    expect(report.rescanRequired).toBe(true);
    expect(admissible(report.completeness)).toBe(false);
    expect(report.completeness.reason).toContain('overflowed');
    expect(report.completeness.reason).toContain('rescan');
  });

  it('treats a sequence jump as lost events even when the queue did not report overflow', () => {
    const report = detectDrift(
      baseline(), snapshot(), batch([`${PROJECT}/src/a.ts`], { sequence: 9 }),
      { home: HOME, lastSequence: 4 },
    );
    expect(report.rescanRequired).toBe(true);
    expect(report.completeness.reason).toContain('jumped from 4 to 9');
  });

  it('does not call consecutive sequences a gap', () => {
    const report = detectDrift(
      baseline(), snapshot(), batch([`${PROJECT}/src/a.ts`], { sequence: 5 }),
      { home: HOME, lastSequence: 4 },
    );
    expect(report.rescanRequired).toBe(false);
    expect(admissible(report.completeness)).toBe(true);
  });

  it('says which paths were coalesced, so one row is not read as one change', () => {
    const report = detectDrift(
      baseline(), snapshot(),
      { events: [{ path: `${HOME}/.ssh/id_ed25519`, coalesced: true, at: 1 }], overflowed: false, sequence: 1 },
      { home: HOME },
    );
    expect(report.coalescedPaths).toEqual([`${HOME}/.ssh/id_ed25519`]);
  });

  it('carries the gap into the observation the finding cites', () => {
    const report = detectDrift(
      baseline(), snapshot(),
      batch([`${HOME}/.ssh/id_ed25519`], { overflowed: true }), { home: HOME },
    );
    const observation = driftObservation(report.items[0], 'task_1', report.completeness, 2_000);
    expect(observation.completeness.complete).toBe(false);
    expect(validate(observation).ok).toBe(true);
  });
});

describe('the alert-volume budget bounds noise without bounding severity', () => {
  const noisy = (count: number): DriftItem[] => Array.from({ length: count }, (_unused, i) => ({
    kind: 'lockfile-changed' as const, path: `${PROJECT}/lock-${i}.json`,
    pathClass: 'project' as const, detail: 'changed', inBuildOutput: false,
  }));

  it('aggregates beyond the budget instead of flooding', () => {
    const result = applyAlertBudget(noisy(25));
    expect(result.surfaced).toHaveLength(DEFAULT_ALERT_BUDGET.maxSurfaced);
    expect(result.aggregated).toEqual([{ kind: 'lockfile-changed', count: 15 }]);
  });

  it('never drops a credential finding in favour of lockfile noise', () => {
    const credential: DriftItem = {
      kind: 'credential-path-touched', path: `${HOME}/.ssh/id_ed25519`,
      pathClass: 'credential', detail: 'changed', inBuildOutput: false,
    };
    const result = applyAlertBudget([...noisy(50), credential]);
    expect(result.surfaced).toContainEqual(credential);
  });

  it('surfaces everything when the batch is under budget', () => {
    const result = applyAlertBudget(noisy(3));
    expect(result.surfaced).toHaveLength(3);
    expect(result.aggregated).toEqual([]);
  });
});
