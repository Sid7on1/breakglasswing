// Bimax Task Guard — the deterministic detection floors of owner section 28 (V28B).
//
// Layers A, B and C from docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §6,
// implemented as pure functions over a TaskIntent, an OperationIntent and the observations backing
// them. There is no model here, no statistics and no network: §4 (S28-2) forbids anything but
// "precompiled, bounded, deterministic policy" on an authorization path, and this is that policy.
//
// The thing this file is most careful about is *not* firing. The section 28 gate requires that
// "benign multi-project corpora meet declared false-positive … budgets", and journeys S28-01 and
// S28-04 are explicitly about silence: a build deleting its own output and an approved install
// reaching its own registry must produce nothing. Every rule below therefore states the narrow
// condition under which it speaks, and the classifier in `path.class.ts` carries the breadth.
//
// The second thing it is careful about is ranking. S28-05 requires that a credential read followed
// by an undeclared destination outranks either signal alone. That is `causalCombination`: the guard
// is given the findings already raised on the same causal path, so the combination is evidence, not
// a coincidence of two separate alerts.

import {
  COMPLETE, Completeness, Decision, DeclaredEffects, DetectionLayer, Disposition, EvidenceBasis,
  EvidenceRef, Finding, Identity, Observation, OperationIntent, RULE_IDS, RiskFactors, Sensitivity,
  TaskIntent, admissible, basisOfProvenance, combineBasis, dispositionCeiling, dispositionRank, gap,
} from './schema';
import { record } from './ledger';
import { PathClass, classifyPath, isBrowserCredentialStore, isInside, normalizePath } from './path.class';

/** Version of this deterministic rule set. Every Decision records it; changing rules changes this. */
export const RULE_VERSION = 'bimax.rules/1.0.0';

/** Executables whose purpose is mutating macOS security state. Never a Bimax-owned operation. */
const SECURITY_MUTATION_PROCESSES = new Set([
  'csrutil', 'spctl', 'tccutil', 'nvram', 'bputil', 'systemsetup', 'socketfilterfw',
]);

/** A finding plus the disposition it argues for, before the Decision takes the maximum. */
interface RuleHit { finding: Finding; disposition: Disposition }

export type Stage = 'proposed' | 'observed';

export interface GuardInput {
  task: TaskIntent;
  operation: OperationIntent;
  /**
   * `proposed` evaluates `operation.declared` before the operation runs — this is the pause/block
   * path. `observed` evaluates what an ActionReceipt actually recorded, which is the only way
   * S28-05's "install contacted an undeclared host" and the receipt/intent contradiction are seen.
   */
  stage: Stage;
  effects: DeclaredEffects;
  /** Observations backing this evaluation. Findings cite these; without them a finding is vacuous. */
  observations: Observation[];
  /** Findings already raised anywhere on this operation's causal path. Drives causalCombination. */
  priorFindings?: { ruleId: string; operationIntentId: string }[];
  /**
   * Hosts this task has already contacted successfully. Novelty is per-task, never per-device:
   * S28-04 forbids an anomaly raised "solely because traffic is new to the device".
   */
  knownHosts?: string[];
  /**
   * The capability/MCP manifest bounding this operation, when one exists. Exceeding it is
   * S29-05's `MANIFEST_EXCEEDED`, and it is deterministic because the manifest is signed data.
   */
  manifest?: DeclaredEffects | null;
  home?: string;
  now?: number;
}

const observationRef = (observations: Observation[], why: string): EvidenceRef[] =>
  observations.map(o => ({ observationId: o.id, why }));

/**
 * The observations that actually mention a path, so a finding cites the evidence for *its* claim
 * rather than every observation in the batch. Falls back to the whole batch when nothing matches —
 * a finding must never end up vacuous, and an over-broad citation is visible while an empty one is
 * a schema violation.
 */
function refsFor(observations: Observation[], target: string, why: string): EvidenceRef[] {
  const normalized = normalizePath(target);
  const matching = observations.filter(o => normalizePath(o.subject.id) === normalized
    || (o.relationship && normalizePath(o.relationship.object.id) === normalized));
  return observationRef(matching.length ? matching : observations, why);
}

function subjectsFor(operation: OperationIntent, target: Identity): Identity[] {
  return [operation.actor, target];
}

const fileIdentity = (path: string): Identity => ({ kind: 'file', id: normalizePath(path), provenance: 'observed' });
const endpointIdentity = (host: string): Identity => ({ kind: 'endpoint', id: host, provenance: 'observed' });

/** Every path the effects touch, tagged with how. */
function effectPaths(effects: DeclaredEffects): { path: string; how: 'read' | 'write' | 'delete' }[] {
  return [
    ...effects.reads.map(path => ({ path, how: 'read' as const })),
    ...effects.writes.map(path => ({ path, how: 'write' as const })),
    ...effects.deletes.map(path => ({ path, how: 'delete' as const })),
  ];
}

const sensitivityOfClass = (cls: PathClass): Sensitivity => {
  switch (cls) {
    case 'credential': case 'ssh-authorized': return 'sensitive';
    case 'security-setting': case 'system-integrity': case 'persistence': return 'sensitive';
    case 'user-data': case 'external': return 'sensitive';
    default: return 'project';
  }
};

// --- Layer A: invariants ------------------------------------------------------------------------

function layerA(input: GuardInput): RuleHit[] {
  const { task, operation, effects, observations, home } = input;
  const hits: RuleHit[] = [];
  const options = { projectRoot: task.projectRoot, home };
  const mutations = [...effects.writes, ...effects.deletes];

  if (task.approvalMode === 'plan' && (mutations.length || effects.installsDependencies)) {
    hits.push({
      disposition: 'block',
      finding: {
        ruleId: RULE_IDS.PLAN_MODE_WRITE, layer: 'A',
        what: `${operation.operation} proposed ${mutations.length || 'a dependency'} mutation while the session is in plan mode`,
        violated: 'plan mode is research-only until the plan is approved',
        subjects: subjectsFor(operation, fileIdentity(mutations[0] ?? task.projectRoot ?? '/')),
        benignExplanations: [],
        evidence: observationRef(observations, 'the proposed mutation'),
      },
    });
  }

  for (const path of mutations) {
    const cls = classifyPath(path, options);
    if (cls === 'system-integrity') {
      hits.push({
        disposition: 'block',
        finding: {
          ruleId: RULE_IDS.SYSTEM_INTEGRITY, layer: 'A',
          what: `${operation.operation} proposed writing ${path}, inside macOS system-integrity protection`,
          violated: 'Bimax never modifies the Signed System Volume or SIP-protected system paths',
          subjects: subjectsFor(operation, fileIdentity(path)),
          benignExplanations: [],
          evidence: refsFor(observations, path, 'the system-integrity write'),
        },
      });
    }
    if (cls === 'security-setting') {
      hits.push({
        disposition: 'block',
        finding: {
          ruleId: RULE_IDS.SECURITY_SETTING_MUTATION, layer: 'A',
          what: `${operation.operation} proposed writing ${path}, a macOS security setting`,
          violated: 'TaskBoundary.allowSecuritySettings can never be granted',
          subjects: subjectsFor(operation, fileIdentity(path)),
          benignExplanations: [],
          evidence: refsFor(observations, path, 'the security-setting write'),
        },
      });
    }
    if ((cls === 'persistence' || cls === 'ssh-authorized') && !task.boundary.allowPersistence) {
      hits.push({
        disposition: 'block',
        finding: {
          ruleId: RULE_IDS.PERSISTENCE_WRITE, layer: 'A',
          what: `${operation.operation} proposed writing ${path}, which survives this task and this login`,
          violated: 'the task did not approve creating or changing persistence',
          subjects: subjectsFor(operation, fileIdentity(path)),
          benignExplanations: [],
          evidence: refsFor(observations, path, 'the persistence write'),
        },
      });
    }
  }

  for (const { path, how } of effectPaths(effects)) {
    const cls = classifyPath(path, options);
    if (cls !== 'credential') continue;
    // "never read credential stores on behalf of Computer Use" is unconditional (§6 Layer A). For
    // every other subsystem the task may have approved credential work explicitly — rotating an SSH
    // key is a real task — and then this is not a violation at all.
    const forbidden = operation.subsystem === 'computer-use' || !task.boundary.allowCredentialAccess;
    if (!forbidden) continue;
    hits.push({
      disposition: 'block',
      finding: {
        ruleId: RULE_IDS.CREDENTIAL_READ, layer: 'A',
        what: `${operation.operation} proposed to ${how} the credential store ${path}`,
        violated: operation.subsystem === 'computer-use'
          ? 'Computer Use may never reach a credential store, with or without approval'
          : 'the task did not approve credential access',
        subjects: subjectsFor(operation, fileIdentity(path)),
        benignExplanations: [],
        evidence: refsFor(observations, path, 'the credential access'),
      },
    });
  }

  for (const process of effects.processes) {
    const basename = normalizePath(process).split('/').pop() || process;
    if (!SECURITY_MUTATION_PROCESSES.has(basename)) continue;
    hits.push({
      disposition: 'block',
      finding: {
        ruleId: RULE_IDS.SECURITY_SETTING_MUTATION, layer: 'A',
        what: `${operation.operation} proposed running ${basename}, which changes macOS security state`,
        violated: 'TaskBoundary.allowSecuritySettings can never be granted',
        subjects: subjectsFor(operation, { kind: 'executable', id: process, provenance: 'declared' }),
        benignExplanations: [],
        evidence: observationRef(observations, 'the proposed security-state process'),
      },
    });
  }

  return hits;
}

// --- Layer B: task and capability mismatch ------------------------------------------------------

function layerB(input: GuardInput): RuleHit[] {
  const { task, operation, effects, observations, home, manifest } = input;
  const hits: RuleHit[] = [];
  const options = { projectRoot: task.projectRoot, home };
  const boundary = task.boundary;

  for (const path of [...effects.writes, ...effects.deletes]) {
    if (boundary.writeRoots.some(root => isInside(path, root))) continue;
    const cls = classifyPath(path, options);
    // Silence is the requirement, not a nicety: S28-01 grades a build deleting its own output, and
    // an install that was approved necessarily writes package caches it never declared by name.
    if (cls === 'temp' || cls === 'build-output') continue;
    if (cls === 'toolchain' && (boundary.allowInstall || effects.installsDependencies)) continue;
    // Layer A already owns these and says it better; a second Layer B finding would be noise.
    if (cls === 'system-integrity' || cls === 'security-setting') continue;
    if ((cls === 'persistence' || cls === 'ssh-authorized') && !boundary.allowPersistence) continue;
    hits.push({
      disposition: 'require-approval',
      finding: {
        ruleId: RULE_IDS.WRITE_OUTSIDE_BOUNDARY, layer: 'B',
        what: `${operation.operation} wrote ${path} (${cls}), outside every approved write root`,
        violated: `TaskBoundary.writeRoots = [${boundary.writeRoots.join(', ') || 'none'}]`,
        subjects: subjectsFor(operation, fileIdentity(path)),
        benignExplanations: [
          'a tool configured with an out-of-tree output or cache directory',
          'a monorepo whose sibling package was not included in the approved roots',
        ],
        evidence: refsFor(observations, path, 'the out-of-boundary write'),
      },
    });
  }

  for (const path of effects.reads) {
    if (boundary.readRoots.some(root => isInside(path, root))) continue;
    const cls = classifyPath(path, options);
    // Reads of the system, toolchains and scratch are how every compiler works. Only the user's own
    // data and paths Bimax cannot place are worth a word.
    if (cls !== 'user-data' && cls !== 'external') continue;
    hits.push({
      disposition: 'explain',
      finding: {
        ruleId: RULE_IDS.READ_OUTSIDE_BOUNDARY, layer: 'B',
        what: `${operation.operation} read ${path} (${cls}), outside every approved read root`,
        violated: `TaskBoundary.readRoots = [${boundary.readRoots.join(', ') || 'none'}]`,
        subjects: subjectsFor(operation, fileIdentity(path)),
        benignExplanations: [
          'a global tool configuration the user maintains outside the project',
          'a sibling repository referenced by a local dependency link',
        ],
        evidence: refsFor(observations, path, 'the out-of-boundary read'),
      },
    });
  }

  if (effects.installsDependencies && !boundary.allowInstall) {
    hits.push({
      disposition: 'require-approval',
      finding: {
        ruleId: RULE_IDS.UNDECLARED_INSTALL, layer: 'B',
        what: `${operation.operation} changed dependencies during a task that did not approve installs`,
        violated: 'TaskBoundary.allowInstall is false',
        subjects: subjectsFor(operation, { kind: 'package', id: operation.operation, provenance: 'declared' }),
        benignExplanations: [
          'a test script whose preflight installs missing dev dependencies',
          'a lockfile-driven install the user considers part of running tests',
        ],
        evidence: observationRef(observations, 'the dependency change'),
      },
    });
  }

  const known = new Set([...(input.knownHosts ?? []), ...boundary.allowedHosts]);
  for (const host of effects.hosts) {
    if (known.has(host)) continue;
    if (boundary.allowedHosts.length === 0 && boundary.allowNetwork) {
      // The task allowed network use without naming hosts. Novelty alone is not a finding here —
      // that is exactly the false positive S28-04 forbids.
      continue;
    }
    hits.push({
      disposition: boundary.allowNetwork ? 'explain' : 'require-approval',
      finding: {
        ruleId: RULE_IDS.UNDECLARED_HOST, layer: 'B',
        what: `${operation.operation} contacted ${host}, which this task never declared`,
        violated: boundary.allowNetwork
          ? `TaskBoundary.allowedHosts = [${boundary.allowedHosts.join(', ')}]`
          : 'the task did not approve network access',
        subjects: subjectsFor(operation, endpointIdentity(host)),
        benignExplanations: [
          'a registry mirror or CDN redirect the declared host resolves to',
          'a telemetry or update endpoint belonging to an approved tool',
        ],
        evidence: observationRef(observations, 'the connection'),
      },
    });
  }

  if (manifest) {
    const exceeded = exceedsManifest(effects, manifest);
    for (const excess of exceeded) {
      hits.push({
        disposition: 'block',
        finding: {
          ruleId: RULE_IDS.MANIFEST_EXCEEDED, layer: 'B',
          what: `${operation.operation} exercised ${excess.what}, which its manifest does not declare`,
          violated: `capability manifest declares ${excess.declared}`,
          subjects: subjectsFor(operation, excess.subject),
          benignExplanations: ['a capability whose manifest is out of date for this version'],
          evidence: observationRef(observations, 'the undeclared capability use'),
        },
      });
    }
  }

  if (input.stage === 'observed') {
    for (const contradiction of contradictions(operation.declared, effects)) {
      hits.push({
        disposition: 'block',
        finding: {
          ruleId: RULE_IDS.RECEIPT_CONTRADICTS_INTENT, layer: 'B',
          what: `${operation.operation} declared ${contradiction.declared} but its receipt shows ${contradiction.observed}`,
          violated: 'an operation may not exceed the effects it declared before approval',
          subjects: subjectsFor(operation, contradiction.subject),
          benignExplanations: ['a tool whose declared effects are incomplete for this invocation'],
          evidence: observationRef(observations, 'the receipt'),
        },
      });
    }
  }

  return hits;
}

interface ManifestExcess { what: string; declared: string; subject: Identity }

/** Effects the operation exercised that its signed manifest does not cover. S29-05. */
export function exceedsManifest(effects: DeclaredEffects, manifest: DeclaredEffects): ManifestExcess[] {
  const excess: ManifestExcess[] = [];
  for (const path of effects.writes.concat(effects.deletes)) {
    if (manifest.writes.some(root => isInside(path, root))) continue;
    excess.push({
      what: `a write to ${path}`,
      declared: `filesystem_write = [${manifest.writes.join(', ') || 'none'}]`,
      subject: fileIdentity(path),
    });
  }
  for (const path of effects.reads) {
    if (manifest.reads.some(root => isInside(path, root))) continue;
    excess.push({
      what: `a read of ${path}`,
      declared: `filesystem_read = [${manifest.reads.join(', ') || 'none'}]`,
      subject: fileIdentity(path),
    });
  }
  for (const host of effects.hosts) {
    if (manifest.hosts.includes(host)) continue;
    excess.push({
      what: `a connection to ${host}`,
      declared: `network = [${manifest.hosts.join(', ') || 'none'}]`,
      subject: endpointIdentity(host),
    });
  }
  for (const process of effects.processes) {
    const basename = normalizePath(process).split('/').pop() || process;
    if (manifest.processes.some(p => p === process || p === basename)) continue;
    excess.push({
      what: `launching ${basename}`,
      declared: `process = [${manifest.processes.join(', ') || 'none'}]`,
      subject: { kind: 'executable', id: process, provenance: 'observed' },
    });
  }
  return excess;
}

interface Contradiction { declared: string; observed: string; subject: Identity }

/** Where a receipt exceeds what the operation said it would do. */
export function contradictions(declared: DeclaredEffects, observed: DeclaredEffects): Contradiction[] {
  const found: Contradiction[] = [];
  const mutated = [...observed.writes, ...observed.deletes];
  if (declared.readOnly && mutated.length) {
    found.push({
      declared: 'a read-only operation',
      observed: `${mutated.length} mutation(s), starting with ${mutated[0]}`,
      subject: fileIdentity(mutated[0]),
    });
  }
  if (!declared.installsDependencies && observed.installsDependencies) {
    found.push({
      declared: 'no dependency change',
      observed: 'a dependency change',
      subject: { kind: 'package', id: 'dependency-graph', provenance: 'observed' },
    });
  }
  return found;
}

// --- Layer C: known risky macOS behavior --------------------------------------------------------

function layerC(input: GuardInput): RuleHit[] {
  const { task, operation, effects, observations, home } = input;
  const hits: RuleHit[] = [];
  const options = { projectRoot: task.projectRoot, home };

  for (const path of [...effects.writes, ...effects.deletes]) {
    const cls = classifyPath(path, options);
    if (cls === 'persistence') {
      hits.push({
        disposition: 'require-approval',
        finding: {
          ruleId: RULE_IDS.LAUNCH_ITEM_CHANGE, layer: 'C',
          what: `${operation.operation} changed the launch/startup item ${path}`,
          violated: 'MITRE T1543/T1546: launch items and shell profiles run again after this task ends',
          subjects: subjectsFor(operation, fileIdentity(path)),
          benignExplanations: ['a developer tool registering its own background helper on first run'],
          evidence: refsFor(observations, path, 'the launch-item change'),
        },
      });
    }
    if (cls === 'ssh-authorized') {
      hits.push({
        disposition: 'require-approval',
        finding: {
          ruleId: RULE_IDS.SSH_AUTHORIZED_KEYS, layer: 'C',
          what: `${operation.operation} changed ${path}`,
          violated: 'MITRE T1098.004: an authorized_keys entry grants durable remote access',
          subjects: subjectsFor(operation, fileIdentity(path)),
          benignExplanations: ['a user deliberately enrolling a new development machine'],
          evidence: refsFor(observations, path, 'the authorized_keys change'),
        },
      });
    }
  }

  for (const { path } of effectPaths(effects)) {
    if (!isBrowserCredentialStore(path, home)) continue;
    hits.push({
      disposition: 'require-approval',
      finding: {
        ruleId: RULE_IDS.BROWSER_CREDENTIAL_STORE, layer: 'C',
        what: `${operation.operation} reached the browser credential store ${path}`,
        violated: 'MITRE T1555.003: browser credential databases hold saved passwords and cookies',
        subjects: subjectsFor(operation, fileIdentity(path)),
        benignExplanations: ['a browser automation profile stored beside the credential database'],
        evidence: refsFor(observations, path, 'the browser credential access'),
      },
    });
  }

  // An observation is the only thing that can tell us a written path was an executable; the effects
  // list carries paths, not modes.
  for (const observation of observations) {
    if (observation.facts.executable !== true) continue;
    if (observation.relationship?.kind !== 'wrote' && observation.relationship?.kind !== 'installed-by') continue;
    const path = observation.subject.id;
    const cls = classifyPath(path, options);
    if (cls === 'build-output' || cls === 'temp') continue;
    hits.push({
      disposition: 'require-approval',
      finding: {
        ruleId: RULE_IDS.EXECUTABLE_REPLACED, layer: 'C',
        what: `${operation.operation} created or replaced the executable ${path}`,
        violated: 'a new executable outside build output changes what this machine will run later',
        subjects: subjectsFor(operation, { ...observation.subject, kind: 'executable' }),
        benignExplanations: ['a package manager linking a newly installed binary into its bin directory'],
        evidence: [{ observationId: observation.id, why: 'the executable write' }],
      },
    });
  }

  return hits;
}

// --- Evidence honesty ---------------------------------------------------------------------------

/**
 * Whether this evaluation rests on measurement or on declaration, taken from the provenance the
 * sensors recorded. `mixed` is the common case once a receipt joins a proposal.
 */
export function combinedBasis(observations: Observation[]): EvidenceBasis {
  if (!observations.length) return 'declared';
  return observations
    .map(o => basisOfProvenance(o.subject.provenance))
    .reduce(combineBasis);
}

/** The worst completeness among the observations backing this evaluation. */
export function combinedCompleteness(observations: Observation[]): Completeness {
  const gaps = observations.filter(o => !admissible(o.completeness));
  if (!gaps.length) return COMPLETE;
  const dropped = gaps.reduce((sum, o) => sum + o.completeness.droppedEvents, 0);
  const reasons = [...new Set(gaps.map(o => o.completeness.reason).filter(Boolean))].join('; ');
  return gap(reasons || 'a sensor reported an incomplete observation', dropped);
}

// --- Composition --------------------------------------------------------------------------------

/**
 * Rules that, seen together on one causal path, mean more than they do apart. S28-05: an install
 * that reads a credential store and then contacts an undeclared host is one finding, and it must
 * outrank the isolated novelty of a new destination.
 */
const COMBINATION_PARTNERS: Record<string, string[]> = {
  [RULE_IDS.UNDECLARED_HOST]: [RULE_IDS.CREDENTIAL_READ, RULE_IDS.BROWSER_CREDENTIAL_STORE, RULE_IDS.READ_OUTSIDE_BOUNDARY],
  [RULE_IDS.CREDENTIAL_READ]: [RULE_IDS.UNDECLARED_HOST],
  [RULE_IDS.EXECUTABLE_REPLACED]: [RULE_IDS.UNDECLARED_HOST, RULE_IDS.CREDENTIAL_READ],
};

function detectCombination(hits: RuleHit[], prior: { ruleId: string }[]): boolean {
  const present = new Set([...hits.map(h => h.finding.ruleId), ...prior.map(p => p.ruleId)]);
  for (const [rule, partners] of Object.entries(COMBINATION_PARTNERS)) {
    if (!present.has(rule)) continue;
    if (partners.some(partner => present.has(partner))) return true;
  }
  return false;
}

const highestSensitivity = (a: Sensitivity, b: Sensitivity): Sensitivity => {
  const order: Sensitivity[] = ['public', 'project', 'sensitive', 'secret'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
};

/**
 * Run the deterministic floors and return one Decision.
 *
 * The disposition is the highest any single rule argued for, escalated one rung when the causal
 * combination fires — never lowered. The layer recorded is the layer of the rule that drove it, so
 * `validate` can check the ceiling against the reasoning that actually produced the verdict.
 */
export function evaluate(input: GuardInput): Decision {
  const now = input.now ?? Date.now();
  const prior = input.priorFindings ?? [];
  const hits = [...layerA(input), ...layerB(input), ...layerC(input)];
  const completeness = combinedCompleteness(input.observations);

  if (!admissible(completeness)) {
    hits.push({
      disposition: 'explain',
      finding: {
        ruleId: RULE_IDS.EVIDENCE_GAP, layer: 'B',
        what: `the evidence behind this decision is incomplete: ${completeness.reason}`,
        violated: 'a verdict on this operation cannot be complete while observations are missing',
        subjects: [input.operation.actor],
        benignExplanations: ['a busy sensor coalesced events without any change in behaviour'],
        evidence: input.observations.length
          ? observationRef(input.observations, 'the partial observation set')
          : [{ observationId: `${input.operation.id}#absent`, why: 'no observation was recorded at all' }],
      },
    });
  }

  const combined = detectCombination(hits, prior);
  let disposition: Disposition = 'observe';
  let layer: DetectionLayer = 'B';
  for (const hit of hits) {
    if (dispositionRank(hit.disposition) < dispositionRank(disposition)) continue;
    disposition = hit.disposition;
    layer = hit.finding.layer;
  }
  if (combined && hits.length) {
    const escalated = escalate(disposition);
    const ceiling = dispositionCeiling(layer);
    disposition = dispositionRank(escalated) <= dispositionRank(ceiling) ? escalated : ceiling;
  }
  // An unfinished picture may raise the verdict but never settle it at silence — the schema rejects
  // `observe` on incomplete evidence, and this is where that becomes true rather than a crash.
  if (!admissible(completeness) && disposition === 'observe') disposition = 'explain';

  const factors: RiskFactors = {
    hardBoundary: hits.some(h => h.finding.layer === 'A'),
    taskMismatch: hits.some(h => h.finding.layer === 'B' && h.finding.ruleId !== RULE_IDS.EVIDENCE_GAP),
    identityTrust: identityTrustOf(input),
    targetSensitivity: hits.reduce<Sensitivity>(
      (worst, hit) => highestSensitivity(worst, sensitivityOfHit(hit, input)),
      'project',
    ),
    persistencePotential: hits.some(h => (
      h.finding.ruleId === RULE_IDS.PERSISTENCE_WRITE
      || h.finding.ruleId === RULE_IDS.LAUNCH_ITEM_CHANGE
      || h.finding.ruleId === RULE_IDS.SSH_AUTHORIZED_KEYS
    )),
    networkNovelty: hits.some(h => h.finding.ruleId === RULE_IDS.UNDECLARED_HOST),
    causalCombination: combined,
    observationCompleteness: completeness,
    // No statistical layer runs in this slice. Reporting 0 would claim a measurement that never
    // happened; null is the honest value and the schema treats it as "no anomaly layer contributed".
    anomalyConfidence: null,
  };

  return record.decision({
    taskIntentId: input.task.id,
    operationIntentId: input.operation.id,
    ruleVersion: RULE_VERSION,
    modelVersion: null,
    layer,
    factors,
    disposition,
    findings: hits.map(h => h.finding),
    evidenceBasis: combinedBasis(input.observations),
    modelExplanation: null,
  }, now);
}

function escalate(disposition: Disposition): Disposition {
  switch (disposition) {
    case 'observe': return 'explain';
    case 'explain': return 'recommend';
    case 'recommend': return 'require-approval';
    case 'require-approval': return 'block';
    default: return disposition;
  }
}

function sensitivityOfHit(hit: RuleHit, input: GuardInput): Sensitivity {
  const target = hit.finding.subjects[hit.finding.subjects.length - 1];
  if (!target || target.kind !== 'file') return 'project';
  return sensitivityOfClass(classifyPath(target.id, { projectRoot: input.task.projectRoot, home: input.home }));
}

/** §2.3 trust hierarchy, applied to the actor: macOS-verified beats signed beats asserted. */
function identityTrustOf(input: GuardInput): RiskFactors['identityTrust'] {
  switch (input.operation.actor.provenance) {
    case 'macos': return 'macos-verified';
    case 'signed-metadata': return 'signed';
    case 'observed': return 'known';
    default: return 'unknown';
  }
}
