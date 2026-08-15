// Phase 8 — the Section 28 acceptance journeys that need no new macOS permission (V28B, S28-A).
//
// Journey ids are the ones in docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md
// §11. Each test grades the END STATE the table demands — the disposition, the named identities, the
// declared evidence gap — not that the guard was called. The silence journeys (S28-01, S28-04) are
// as load-bearing as the detections: a guard that fires on a normal build has failed the
// false-positive budget in 08_ACCEPTANCE_GATES.md, not passed a security test.

import {
  COMPLETE, Observation, RULE_IDS, TaskIntent, emptyBoundary, gap, noEffects, redactFacts, validate,
} from '../evidence/schema';
import { EvidenceLedger, record } from '../evidence/ledger';
import { RULE_VERSION, contradictions, evaluate, exceedsManifest } from '../evidence/boundary';
import { classifyPath, isInside, normalizePath } from '../evidence/path.class';

const HOME = '/Users/dev';
const PROJECT = '/Users/dev/work/app';

const task = (over: Partial<Parameters<typeof record.taskIntent>[0]> = {}): TaskIntent => record.taskIntent({
  summary: 'run the unit tests',
  projectRoot: PROJECT,
  boundary: emptyBoundary({ readRoots: [PROJECT], writeRoots: [PROJECT] }),
  approvalMode: 'interactive',
  ...over,
}, 1_000);

const operation = (over: Partial<Parameters<typeof record.operationIntent>[0]> = {}) => record.operationIntent({
  taskIntentId: 'task_x',
  parentOperationId: null,
  subsystem: 'engine-tool',
  operation: 'Bash(npm test)',
  actor: { kind: 'agent', id: 'bimax.engine', provenance: 'observed' },
  declared: noEffects(),
  taint: [],
  ...over,
}, 2_000);

const observed = (subjectId: string, over: Partial<Parameters<typeof record.observation>[0]> = {}): Observation =>
  record.observation({
    sensor: 'engine.tool',
    scope: 'task',
    sensitivity: 'project',
    retention: 'task',
    taskIntentId: 'task_x',
    operationIntentId: 'op_x',
    subject: { kind: 'file', id: subjectId, provenance: 'observed' },
    relationship: null,
    facts: redactFacts({}),
    freshnessMs: 0,
    completeness: COMPLETE,
    ...over,
  }, 2_100);

const guard = (over: Partial<Parameters<typeof evaluate>[0]>) => evaluate({
  task: task(),
  operation: operation(),
  stage: 'observed',
  effects: noEffects(),
  observations: [observed(PROJECT)],
  home: HOME,
  now: 3_000,
  ...over,
});

const ruleIds = (decision: ReturnType<typeof evaluate>) => decision.findings.map(f => f.ruleId);

describe('path classification is deterministic and puts the dangerous classes first', () => {
  it.each([
    [`${HOME}/.ssh/id_ed25519`, 'credential'],
    [`${HOME}/.ssh/authorized_keys`, 'ssh-authorized'],
    [`${HOME}/.aws/credentials`, 'credential'],
    [`${HOME}/Library/Application Support/Google/Chrome/Default/Login Data`, 'credential'],
    [`${HOME}/Library/LaunchAgents/com.evil.plist`, 'persistence'],
    ['/Library/LaunchDaemons/com.evil.plist', 'persistence'],
    [`${HOME}/.zshrc`, 'persistence'],
    ['/Library/Application Support/com.apple.TCC/TCC.db', 'security-setting'],
    ['/System/Library/CoreServices/Finder.app', 'system-integrity'],
    ['/bin/sh', 'system-integrity'],
    [`${PROJECT}/dist/bundle.js`, 'build-output'],
    [`${PROJECT}/src/index.ts`, 'project'],
    [`${PROJECT}/node_modules/left-pad/index.js`, 'toolchain'],
    ['/opt/homebrew/bin/node', 'toolchain'],
    [`${HOME}/Library/Caches/npm/x`, 'toolchain'],
    ['/tmp/scratch', 'temp'],
    [`${HOME}/Documents/taxes.pdf`, 'user-data'],
    ['/Users/someone-else/secret', 'external'],
  ])('classifies %s as %s', (path, expected) => {
    expect(classifyPath(path, { projectRoot: PROJECT, home: HOME })).toBe(expected);
  });

  it('classifies a credential file inside the project as credential, not project', () => {
    expect(classifyPath(`${HOME}/.ssh/id_rsa`, { projectRoot: HOME, home: HOME })).toBe('credential');
  });

  it('is not fooled by traversal or duplicate separators', () => {
    expect(normalizePath(`${PROJECT}/src/../../../.ssh/id_rsa`)).toBe(`${HOME}/.ssh/id_rsa`);
    expect(classifyPath(`${PROJECT}//src/../../..//.ssh/id_rsa`, { projectRoot: PROJECT, home: HOME }))
      .toBe('credential');
  });

  it('does not treat a sibling directory as inside a root', () => {
    expect(isInside('/a/bc', '/a/b')).toBe(false);
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(true);
  });
});

describe('S28-01 — a normal build deleting generated output produces no warning', () => {
  it('stays silent and records an admissible observe decision', () => {
    const decision = guard({
      operation: operation({
        operation: 'Bash(npm run build)',
        declared: noEffects({ writes: [`${PROJECT}/dist/bundle.js`], deletes: [`${PROJECT}/dist`] }),
      }),
      effects: noEffects({ writes: [`${PROJECT}/dist/bundle.js`], deletes: [`${PROJECT}/dist`] }),
      observations: [observed(`${PROJECT}/dist/bundle.js`)],
    });
    expect(decision.findings).toEqual([]);
    expect(decision.disposition).toBe('observe');
    expect(validate(decision).ok).toBe(true);
  });

  it('stays silent for generated output that falls outside the approved write roots', () => {
    // The approval covered source, not the generated tree beside it — the common shape of a task
    // scoped to `src/`. `dist/` is still the build's own output and must not be a finding.
    const decision = guard({
      task: task({ boundary: emptyBoundary({ readRoots: [PROJECT], writeRoots: [`${PROJECT}/src`] }) }),
      operation: operation({ operation: 'Bash(npm run build)' }),
      effects: noEffects({ writes: [`${PROJECT}/dist/bundle.js`], deletes: [`${PROJECT}/dist`] }),
      observations: [observed(`${PROJECT}/dist/bundle.js`)],
    });
    expect(classifyPath(`${PROJECT}/dist/bundle.js`, { projectRoot: PROJECT, home: HOME })).toBe('build-output');
    expect(decision.findings).toEqual([]);
    expect(decision.disposition).toBe('observe');
  });

  it('still speaks when the same task writes authored source outside the approved roots', () => {
    const decision = guard({
      task: task({ boundary: emptyBoundary({ readRoots: [PROJECT], writeRoots: [`${PROJECT}/src`] }) }),
      operation: operation({ operation: 'Bash(npm run build)' }),
      effects: noEffects({ writes: [`${PROJECT}/config/secrets.yaml`] }),
      observations: [observed(`${PROJECT}/config/secrets.yaml`)],
    });
    expect(ruleIds(decision)).toEqual([RULE_IDS.WRITE_OUTSIDE_BOUNDARY]);
    expect(decision.disposition).toBe('require-approval');
  });

  it('stays silent when a build writes its own out-of-tree cache during an approved install', () => {
    const decision = guard({
      task: task({ boundary: emptyBoundary({ readRoots: [PROJECT], writeRoots: [PROJECT], allowInstall: true, allowNetwork: true }) }),
      operation: operation({ operation: 'Bash(npm ci)', declared: noEffects({ installsDependencies: true }) }),
      effects: noEffects({ writes: [`${HOME}/Library/Caches/npm/_cacache/x`], installsDependencies: true }),
      observations: [observed(`${HOME}/Library/Caches/npm/_cacache/x`)],
    });
    expect(decision.findings).toEqual([]);
    expect(decision.disposition).toBe('observe');
  });
});

describe('S28-02 — a build child reading an SSH private key is blocked with its causal path', () => {
  it('blocks on the Layer A invariant and names who read what', () => {
    const decision = guard({
      operation: operation({
        operation: 'sh -c ./collect.sh',
        actor: { kind: 'process', id: 'sh', provenance: 'observed' },
        declared: noEffects({ readOnly: true }),
      }),
      effects: noEffects({ reads: [`${HOME}/.ssh/id_ed25519`], readOnly: true }),
      observations: [observed(`${HOME}/.ssh/id_ed25519`, {
        relationship: { kind: 'read', object: { kind: 'process', id: 'sh', provenance: 'observed' } },
      })],
    });
    expect(decision.disposition).toBe('block');
    expect(decision.layer).toBe('A');
    expect(ruleIds(decision)).toContain(RULE_IDS.CREDENTIAL_READ);
    const finding = decision.findings.find(f => f.ruleId === RULE_IDS.CREDENTIAL_READ)!;
    expect(finding.subjects.map(s => s.id)).toEqual(['sh', `${HOME}/.ssh/id_ed25519`]);
    expect(finding.evidence).not.toHaveLength(0);
    expect(decision.factors.hardBoundary).toBe(true);
    expect(validate(decision).ok).toBe(true);
  });

  it('reconstructs the causal path from the leaf operation back to the task', () => {
    const ledger = new EvidenceLedger();
    const t = ledger.append(task());
    const root = ledger.append(operation({ taskIntentId: t.id, operation: 'Bash(npm test)' }));
    const worker = ledger.append(operation({
      taskIntentId: t.id, parentOperationId: root.id, operation: 'jest-worker',
      actor: { kind: 'process', id: 'node', provenance: 'observed' },
    }));
    const child = ledger.append(operation({
      taskIntentId: t.id, parentOperationId: worker.id, operation: 'sh -c ./collect.sh',
      actor: { kind: 'process', id: 'sh', provenance: 'observed' },
    }));
    expect(ledger.causalPath(child.id).map(o => o.operation))
      .toEqual(['sh -c ./collect.sh', 'jest-worker', 'Bash(npm test)']);
  });

  it('still blocks Computer Use credential access even when the task approved it', () => {
    const decision = guard({
      task: task({ boundary: emptyBoundary({ readRoots: [HOME], allowCredentialAccess: true }) }),
      operation: operation({ subsystem: 'computer-use', operation: 'mac.read' }),
      effects: noEffects({ reads: [`${HOME}/.ssh/id_ed25519`] }),
      observations: [observed(`${HOME}/.ssh/id_ed25519`)],
    });
    expect(decision.disposition).toBe('block');
    expect(decision.findings[0].violated).toMatch(/with or without approval/);
  });

  it('does not block a task that explicitly approved credential work outside Computer Use', () => {
    const decision = guard({
      task: task({ summary: 'rotate my deploy key', boundary: emptyBoundary({ readRoots: [HOME], writeRoots: [`${HOME}/.ssh`], allowCredentialAccess: true }) }),
      effects: noEffects({ reads: [`${HOME}/.ssh/id_ed25519`] }),
      observations: [observed(`${HOME}/.ssh/id_ed25519`)],
    });
    expect(ruleIds(decision)).not.toContain(RULE_IDS.CREDENTIAL_READ);
  });
});

describe('S28-03 — a package lifecycle script writing a LaunchAgent names package, script, target and rule', () => {
  const plist = `${HOME}/Library/LaunchAgents/com.pkg.helper.plist`;

  const lifecycleDecision = () => {
    const ledger = new EvidenceLedger();
    const t = ledger.append(task({ boundary: emptyBoundary({ readRoots: [PROJECT], writeRoots: [PROJECT], allowInstall: true, allowNetwork: true, allowedHosts: ['registry.npmjs.org'] }) }));
    const install = ledger.append(operation({
      taskIntentId: t.id, operation: 'npm install',
      actor: { kind: 'package', id: 'npm', provenance: 'observed' },
      declared: noEffects({ installsDependencies: true, hosts: ['registry.npmjs.org'] }),
    }));
    const script = ledger.append(operation({
      taskIntentId: t.id, parentOperationId: install.id, subsystem: 'package',
      operation: 'postinstall(analytics-sdk@2.1.0)',
      actor: { kind: 'package', id: 'analytics-sdk@2.1.0', provenance: 'declared' },
      declared: noEffects(),
    }));
    const observation = ledger.append(observed(plist, {
      taskIntentId: t.id, operationIntentId: script.id, sensitivity: 'sensitive',
      relationship: { kind: 'wrote', object: { kind: 'package', id: 'analytics-sdk@2.1.0', provenance: 'declared' } },
    }));
    const decision = evaluate({
      task: t, operation: script, stage: 'observed',
      effects: noEffects({ writes: [plist] }), observations: [observation], home: HOME, now: 4_000,
    });
    return { ledger, decision, install, script, t };
  };

  it('blocks the write and cites the persistence invariant plus the MITRE launch-item rule', () => {
    const { decision } = lifecycleDecision();
    expect(decision.disposition).toBe('block');
    expect(ruleIds(decision)).toEqual(
      expect.arrayContaining([RULE_IDS.PERSISTENCE_WRITE, RULE_IDS.LAUNCH_ITEM_CHANGE]),
    );
    expect(decision.factors.persistencePotential).toBe(true);
  });

  it('names the package, the script, the target file and the rule id in one finding', () => {
    const { decision } = lifecycleDecision();
    const finding = decision.findings.find(f => f.ruleId === RULE_IDS.PERSISTENCE_WRITE)!;
    expect(finding.subjects.map(s => s.id)).toEqual(['analytics-sdk@2.1.0', plist]);
    expect(finding.what).toContain('postinstall(analytics-sdk@2.1.0)');
    expect(finding.ruleId).toBe('BMX-A-PERSISTENCE-WRITE');
  });

  it('links the script back to the install that caused it', () => {
    const { ledger, script } = lifecycleDecision();
    expect(ledger.causalPath(script.id).map(o => o.operation))
      .toEqual(['postinstall(analytics-sdk@2.1.0)', 'npm install']);
  });

  it('records the decision in the ledger as an admissible record', () => {
    const { ledger, decision } = lifecycleDecision();
    expect(() => ledger.append(decision)).not.toThrow();
    expect(decision.ruleVersion).toBe(RULE_VERSION);
  });
});

describe('S28-04 — an approved install contacting its expected registry raises nothing', () => {
  const approved = task({
    summary: 'add the http client dependency',
    boundary: emptyBoundary({
      readRoots: [PROJECT], writeRoots: [PROJECT], allowInstall: true, allowNetwork: true,
      allowedHosts: ['registry.npmjs.org'],
    }),
  });

  it('is silent for a declared registry', () => {
    const decision = guard({
      task: approved,
      operation: operation({ operation: 'npm install', declared: noEffects({ installsDependencies: true, hosts: ['registry.npmjs.org'] }) }),
      effects: noEffects({ installsDependencies: true, hosts: ['registry.npmjs.org'], writes: [`${PROJECT}/package-lock.json`] }),
      observations: [observed(`${PROJECT}/package-lock.json`)],
    });
    expect(decision.findings).toEqual([]);
    expect(decision.disposition).toBe('observe');
  });

  it('is silent for a host this task already reached, even though it is new to the device', () => {
    const decision = guard({
      task: approved,
      knownHosts: ['registry.npmjs.org.cdn.example'],
      operation: operation({ operation: 'npm install' }),
      effects: noEffects({ hosts: ['registry.npmjs.org.cdn.example'] }),
    });
    expect(decision.findings).toEqual([]);
  });

  it('raises only an explain for an isolated undeclared destination', () => {
    const decision = guard({
      task: approved,
      operation: operation({ operation: 'npm install' }),
      effects: noEffects({ hosts: ['telemetry.example.net'] }),
    });
    expect(ruleIds(decision)).toEqual([RULE_IDS.UNDECLARED_HOST]);
    expect(decision.disposition).toBe('explain');
    expect(decision.factors.causalCombination).toBe(false);
  });
});

describe('S28-05 — a credential read plus an undeclared destination outranks isolated novelty', () => {
  const approved = task({
    boundary: emptyBoundary({
      readRoots: [PROJECT], writeRoots: [PROJECT], allowInstall: true, allowNetwork: true,
      allowedHosts: ['registry.npmjs.org'],
    }),
  });

  const isolatedNovelty = () => guard({
    task: approved,
    operation: operation({ operation: 'npm install' }),
    effects: noEffects({ hosts: ['unknown.example'] }),
  });

  const combined = () => guard({
    task: approved,
    operation: operation({ operation: 'npm install', parentOperationId: 'op_parent' }),
    effects: noEffects({ hosts: ['unknown.example'] }),
    priorFindings: [{ ruleId: RULE_IDS.CREDENTIAL_READ, operationIntentId: 'op_parent' }],
  });

  it('marks the combination and escalates strictly above the isolated case', () => {
    const alone = isolatedNovelty();
    const together = combined();
    expect(alone.factors.causalCombination).toBe(false);
    expect(together.factors.causalCombination).toBe(true);
    expect(alone.disposition).toBe('explain');
    expect(together.disposition).toBe('recommend');
    expect(validate(together).ok).toBe(true);
  });

  it('escalates a single evaluation that contains both signals at once', () => {
    const decision = guard({
      task: approved,
      operation: operation({ operation: 'sh -c ./postinstall.sh' }),
      effects: noEffects({ reads: [`${HOME}/.ssh/id_ed25519`], hosts: ['unknown.example'] }),
      observations: [observed(`${HOME}/.ssh/id_ed25519`)],
    });
    expect(decision.factors.causalCombination).toBe(true);
    expect(decision.disposition).toBe('block');
    expect(ruleIds(decision)).toEqual(
      expect.arrayContaining([RULE_IDS.CREDENTIAL_READ, RULE_IDS.UNDECLARED_HOST]),
    );
  });

  it('never escalates past the layer ceiling of the rule that drove the verdict', () => {
    const decision = guard({
      task: approved,
      operation: operation({ operation: 'sh -c ./x.sh' }),
      effects: noEffects({ reads: [`${HOME}/.ssh/id_ed25519`], hosts: ['unknown.example'] }),
      observations: [observed(`${HOME}/.ssh/id_ed25519`)],
    });
    expect(decision.disposition).toBe('block');
    expect(validate(decision).ok).toBe(true);
  });
});

describe('S28-06 — dropped observations are declared, never smoothed into a safe verdict', () => {
  it('raises an evidence-gap finding and refuses to settle at observe', () => {
    const decision = guard({
      operation: operation({ operation: 'Bash(npm run build)' }),
      effects: noEffects({ writes: [`${PROJECT}/dist/x.js`] }),
      observations: [observed(`${PROJECT}/dist/x.js`, {
        completeness: gap('the native event queue overflowed', 42),
      })],
    });
    expect(ruleIds(decision)).toContain(RULE_IDS.EVIDENCE_GAP);
    expect(decision.disposition).not.toBe('observe');
    expect(decision.factors.observationCompleteness.complete).toBe(false);
    expect(decision.factors.observationCompleteness.droppedEvents).toBe(42);
    expect(validate(decision).ok).toBe(true);
  });

  it('declares the gap even when no observation reached the guard at all', () => {
    const decision = guard({
      operation: operation({ operation: 'Bash(npm run build)' }),
      effects: noEffects({ writes: [`${PROJECT}/dist/x.js`] }),
      observations: [observed(`${PROJECT}/dist/x.js`, { completeness: gap('the sensor is unavailable') })],
    });
    const finding = decision.findings.find(f => f.ruleId === RULE_IDS.EVIDENCE_GAP)!;
    expect(finding.what).toContain('the sensor is unavailable');
  });

  it('does not silently turn a gap into a block either', () => {
    const decision = guard({
      operation: operation({ operation: 'Read' }),
      effects: noEffects({ reads: [`${PROJECT}/src/index.ts`], readOnly: true }),
      observations: [observed(`${PROJECT}/src/index.ts`, { completeness: gap('coalesced FSEvents', 3) })],
    });
    expect(decision.disposition).toBe('explain');
  });
});

describe('S28-11 — a forged or stale record cannot enter the ledger', () => {
  it('rejects a decision whose findings were edited after sealing', () => {
    const ledger = new EvidenceLedger();
    const decision = guard({
      operation: operation({ operation: 'sh -c ./x.sh' }),
      effects: noEffects({ reads: [`${HOME}/.ssh/id_ed25519`] }),
      observations: [observed(`${HOME}/.ssh/id_ed25519`)],
    });
    const softened = { ...decision, disposition: 'observe' as const, findings: [] };
    expect(() => ledger.append(softened)).toThrow(/does not match its content/);
  });

  it('rejects an observation whose freshness was rewritten', () => {
    const ledger = new EvidenceLedger();
    const original = observed(`${PROJECT}/src/index.ts`, { freshnessMs: 90_000 });
    expect(() => ledger.append({ ...original, freshnessMs: 0 })).toThrow(/does not match its content/);
  });
});

describe('receipt/intent contradiction and manifest excess are deterministic', () => {
  it('blocks when a read-only operation reports mutations in its receipt', () => {
    const decision = guard({
      operation: operation({ operation: 'Read', declared: noEffects({ readOnly: true }) }),
      stage: 'observed',
      effects: noEffects({ writes: [`${PROJECT}/src/index.ts`] }),
      observations: [observed(`${PROJECT}/src/index.ts`)],
    });
    expect(ruleIds(decision)).toContain(RULE_IDS.RECEIPT_CONTRADICTS_INTENT);
    expect(decision.disposition).toBe('block');
  });

  it('does not raise the contradiction before the operation has run', () => {
    const decision = guard({
      operation: operation({ operation: 'Read', declared: noEffects({ readOnly: true }) }),
      stage: 'proposed',
      effects: noEffects({ reads: [`${PROJECT}/src/index.ts`], readOnly: true }),
    });
    expect(ruleIds(decision)).not.toContain(RULE_IDS.RECEIPT_CONTRADICTS_INTENT);
  });

  it('reports every category a capability exceeded (S29-05)', () => {
    const excess = exceedsManifest(
      noEffects({ writes: ['/Users/dev/other/x'], reads: [`${PROJECT}/src`], hosts: ['evil.example'], processes: ['/bin/curl'] }),
      noEffects({ writes: [`${PROJECT}/build`], reads: [PROJECT], hosts: ['dl.google.com'], processes: ['adb'] }),
    );
    expect(excess.map(e => e.what)).toEqual([
      'a write to /Users/dev/other/x',
      'a connection to evil.example',
      'launching curl',
    ]);
  });

  it('blocks an MCP call that exceeds its manifest and names the manifest field', () => {
    const decision = guard({
      operation: operation({ subsystem: 'mcp', operation: 'mcp:files/read_file' }),
      manifest: noEffects({ reads: [PROJECT] }),
      effects: noEffects({ reads: [`${HOME}/.ssh/id_ed25519`] }),
      observations: [observed(`${HOME}/.ssh/id_ed25519`)],
    });
    expect(ruleIds(decision)).toContain(RULE_IDS.MANIFEST_EXCEEDED);
    const finding = decision.findings.find(f => f.ruleId === RULE_IDS.MANIFEST_EXCEEDED)!;
    expect(finding.violated).toBe(`capability manifest declares filesystem_read = [${PROJECT}]`);
  });

  it('finds no contradiction when the receipt matches the declaration', () => {
    expect(contradictions(
      noEffects({ writes: [`${PROJECT}/a`] }),
      noEffects({ writes: [`${PROJECT}/a`] }),
    )).toEqual([]);
  });
});

describe('plan mode is research-only', () => {
  it('blocks any mutation proposed while the session is in plan mode', () => {
    const decision = guard({
      task: task({ approvalMode: 'plan' }),
      operation: operation({ operation: 'Write' }),
      stage: 'proposed',
      effects: noEffects({ writes: [`${PROJECT}/src/index.ts`] }),
    });
    expect(ruleIds(decision)).toContain(RULE_IDS.PLAN_MODE_WRITE);
    expect(decision.disposition).toBe('block');
  });

  it('leaves reads alone in plan mode', () => {
    const decision = guard({
      task: task({ approvalMode: 'plan' }),
      operation: operation({ operation: 'Read', declared: noEffects({ readOnly: true }) }),
      stage: 'proposed',
      effects: noEffects({ reads: [`${PROJECT}/src/index.ts`], readOnly: true }),
    });
    expect(decision.findings).toEqual([]);
  });
});
