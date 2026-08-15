// Project and environment drift — owner section 28 (V28B), slice S28-B.
//
// §4 tier S28-1 of docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md is unusually
// specific about the sensor, and every sentence of it is a constraint here:
//
//   "Use project file watchers and FSEvents for coarse invalidation, then inspect only changed nodes
//    inside approved roots. FSEvents reports filesystem hierarchy changes; it is not a complete
//    security audit stream. The observer must tolerate coalescing, rescan after overflow, and never
//    infer a write's actor solely from an FSEvent."
//
// So: FSEvents is treated as an *invalidation hint*, never as evidence of who did what. A batch
// carries a coalescing flag and can declare overflow, overflow forces a full rescan of the approved
// roots, and no finding this file produces ever names an actor — because an FSEvent cannot identify
// one. Attribution comes from the causal graph the Task Guard already built, joined afterwards.
//
// S28-B's exit is "deterministic fixtures distinguish normal build cleanup from unrelated
// executable, persistence, and credential-path mutations", and its slice rule is "ship explain/
// recommend only". Nothing in this file can reach `require-approval` or above, and that ceiling is
// enforced rather than observed: `driftDisposition` cannot return anything higher.

import {
  COMPLETE, Completeness, DetectionLayer, Disposition, Finding, Identity, Observation, RULE_IDS,
  Sensitivity, gap, redactFacts,
} from './schema';
import { record } from './ledger';
import { PathClass, classifyPath, isInside, normalizePath } from './path.class';

/** One coarse change notification. Deliberately thin — this is all FSEvents actually gives us. */
export interface ChangeEvent {
  path: string;
  /** FSEvents coalesces; a single event can stand for many changes to the same node. */
  coalesced: boolean;
  at: number;
}

export interface ChangeBatch {
  events: ChangeEvent[];
  /**
   * The event queue dropped notifications. Per §4 this is an observation gap, and the only correct
   * response is a rescan — not a smaller finding list.
   */
  overflowed: boolean;
  /** Monotonic sequence the watcher was at. A jump is a gap even when `overflowed` is false. */
  sequence: number;
}

/** The declared shape of a project, captured when the task started. Drift is measured against it. */
export interface ProjectBaseline {
  projectRoot: string;
  /** Path → digest for declaration files (lockfiles, manifests, CI, deploy descriptors). */
  declarations: Record<string, string>;
  /** Paths that were executable at baseline. */
  executables: string[];
  /** Tool → version, from the read-only inventory. */
  toolchain: Record<string, string>;
  /** Hosts the project declares it talks to. */
  endpoints: string[];
  /** Directories the project generates into. Changes here are the S28-01 silence case. */
  buildRoots: string[];
}

/** The same shape, observed now. */
export interface ProjectSnapshot {
  declarations: Record<string, string>;
  executables: string[];
  toolchain: Record<string, string>;
  endpoints: string[];
}

export type DriftKind =
  | 'lockfile-changed'
  | 'declaration-changed'
  | 'executable-added'
  | 'executable-removed'
  | 'toolchain-changed'
  | 'endpoint-added'
  | 'credential-path-touched'
  | 'persistence-path-touched'
  | 'write-outside-project';

export interface DriftItem {
  kind: DriftKind;
  path: string;
  pathClass: PathClass;
  detail: string;
  /** Whether this is inside a declared build root — the difference S28-B's exit turns on. */
  inBuildOutput: boolean;
}

export interface DriftReport {
  items: DriftItem[];
  /** Set when the batch overflowed or a sequence gap was seen. Propagates into every Decision. */
  completeness: Completeness;
  /** True when a rescan is required before this report can be treated as whole. */
  rescanRequired: boolean;
  /** Events that were coalesced, so the user knows a single row may stand for several changes. */
  coalescedPaths: string[];
}

function unreachable(value: never): never {
  throw new Error(`unhandled drift kind: ${String(value)}`);
}

const LOCKFILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'go.sum',
  'poetry.lock', 'Gemfile.lock', 'Podfile.lock', 'composer.lock',
]);

const basename = (path: string): string => normalizePath(path).split('/').pop() ?? '';

/**
 * Compare a batch of change notifications and a fresh snapshot against the baseline.
 *
 * The batch decides *what to look at*; the snapshot decides *what changed*. Keeping them separate is
 * what makes coalescing and overflow survivable: a lost event costs coverage of a path, not a wrong
 * answer about a path we did look at.
 */
export function detectDrift(
  baseline: ProjectBaseline,
  snapshot: ProjectSnapshot,
  batch: ChangeBatch,
  options: { home?: string; lastSequence?: number } = {},
): DriftReport {
  const home = options.home;
  const classify = (path: string): PathClass =>
    classifyPath(path, { projectRoot: baseline.projectRoot, home });
  const inBuildOutput = (path: string): boolean =>
    baseline.buildRoots.some(root => isInside(path, root)) || classify(path) === 'build-output';

  const items: DriftItem[] = [];
  const push = (kind: DriftKind, path: string, detail: string) => {
    items.push({ kind, path: normalizePath(path), pathClass: classify(path), detail, inBuildOutput: inBuildOutput(path) });
  };

  for (const [path, digest] of Object.entries(snapshot.declarations)) {
    const before = baseline.declarations[path];
    if (before === digest) continue;
    const kind: DriftKind = LOCKFILES.has(basename(path)) ? 'lockfile-changed' : 'declaration-changed';
    push(kind, path, before === undefined
      ? 'appeared since the task started'
      : `changed since the task started (${before.slice(0, 12)}… → ${digest.slice(0, 12)}…)`);
  }
  for (const path of Object.keys(baseline.declarations)) {
    if (path in snapshot.declarations) continue;
    push('declaration-changed', path, 'removed since the task started');
  }

  const baselineExecutables = new Set(baseline.executables.map(normalizePath));
  const currentExecutables = new Set(snapshot.executables.map(normalizePath));
  for (const path of currentExecutables) {
    if (baselineExecutables.has(path)) continue;
    push('executable-added', path, 'this path is executable now and was not when the task started');
  }
  for (const path of baselineExecutables) {
    if (currentExecutables.has(path)) continue;
    push('executable-removed', path, 'this executable is gone');
  }

  for (const [tool, version] of Object.entries(snapshot.toolchain)) {
    const before = baseline.toolchain[tool];
    if (before === undefined || before === version) continue;
    push('toolchain-changed', tool, `${tool} moved from ${before} to ${version}`);
  }

  const declaredEndpoints = new Set(baseline.endpoints);
  for (const endpoint of snapshot.endpoints) {
    if (declaredEndpoints.has(endpoint)) continue;
    push('endpoint-added', endpoint, 'this project did not declare this destination');
  }

  // The change batch contributes only the classes it can contribute honestly: that *something*
  // touched a sensitive path. It never says who.
  for (const event of batch.events) {
    const cls = classify(event.path);
    if (cls === 'credential' || cls === 'ssh-authorized') {
      push('credential-path-touched', event.path, 'a credential path changed inside an approved root');
    } else if (cls === 'persistence' || cls === 'security-setting') {
      push('persistence-path-touched', event.path, 'a persistence or security path changed inside an approved root');
    } else if (!isInside(event.path, baseline.projectRoot) && cls !== 'temp' && cls !== 'toolchain') {
      push('write-outside-project', event.path, 'a watched path outside the project changed');
    }
  }

  const sequenceGap = options.lastSequence !== undefined && batch.sequence > options.lastSequence + 1;
  const completeness = batch.overflowed
    ? gap('the change-event queue overflowed; this report is partial until a rescan completes', batch.events.length, batch.sequence)
    : sequenceGap
      ? gap(`the watcher sequence jumped from ${options.lastSequence} to ${batch.sequence}; events were lost`, 0, batch.sequence)
      : COMPLETE;

  return {
    items: dedupe(items),
    completeness,
    rescanRequired: batch.overflowed || sequenceGap,
    coalescedPaths: [...new Set(batch.events.filter(e => e.coalesced).map(e => normalizePath(e.path)))],
  };
}

function dedupe(items: DriftItem[]): DriftItem[] {
  const seen = new Set<string>();
  const out: DriftItem[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (a.path === b.path ? a.kind.localeCompare(b.kind) : a.path.localeCompare(b.path)));
}

/**
 * The disposition a drift item argues for.
 *
 * Hard-capped at `recommend`. S28-B ships "explain/recommend only", and a drift observation cannot
 * identify an actor, so it must never be able to pause or refuse anything on its own. When drift
 * matters enough to stop work, it is the Task Guard's causal finding that stops it — this layer
 * hands over evidence, not authority.
 */
export function driftDisposition(item: DriftItem): Extract<Disposition, 'observe' | 'explain' | 'recommend'> {
  if (item.inBuildOutput) return 'observe';
  switch (item.kind) {
    case 'credential-path-touched':
    case 'persistence-path-touched':
      return 'recommend';
    case 'executable-added':
    case 'toolchain-changed':
      return item.pathClass === 'toolchain' ? 'explain' : 'recommend';
    case 'lockfile-changed':
    case 'endpoint-added':
    case 'write-outside-project':
      return 'explain';
    case 'executable-removed':
    case 'declaration-changed':
      return 'explain';
  }
  return unreachable(item.kind);
}

const KIND_RULE: Record<DriftKind, { ruleId: string; layer: DetectionLayer }> = {
  'lockfile-changed': { ruleId: RULE_IDS.UNDECLARED_INSTALL, layer: 'B' },
  'declaration-changed': { ruleId: RULE_IDS.WRITE_OUTSIDE_BOUNDARY, layer: 'B' },
  'executable-added': { ruleId: RULE_IDS.EXECUTABLE_REPLACED, layer: 'C' },
  'executable-removed': { ruleId: RULE_IDS.EXECUTABLE_REPLACED, layer: 'C' },
  'toolchain-changed': { ruleId: RULE_IDS.PROVENANCE_ANOMALY, layer: 'D' },
  'endpoint-added': { ruleId: RULE_IDS.UNDECLARED_HOST, layer: 'B' },
  'credential-path-touched': { ruleId: RULE_IDS.BROWSER_CREDENTIAL_STORE, layer: 'C' },
  'persistence-path-touched': { ruleId: RULE_IDS.LAUNCH_ITEM_CHANGE, layer: 'C' },
  'write-outside-project': { ruleId: RULE_IDS.WRITE_OUTSIDE_BOUNDARY, layer: 'B' },
};

/**
 * Turn a drift item into a Finding.
 *
 * The subject is the *path*, and the actor is deliberately the watcher rather than any process:
 * "never infer a write's actor solely from an FSEvent". Naming the watcher is the honest answer to
 * §5's "which identity performed it" when the sensor genuinely cannot say.
 */
export function driftFinding(item: DriftItem, observation: Observation): Finding {
  const rule = KIND_RULE[item.kind];
  return {
    ruleId: rule.ruleId,
    layer: rule.layer,
    what: `${item.path}: ${item.detail}`,
    violated: `the project's declared shape at the start of this task (${item.kind})`,
    subjects: [WATCHER_IDENTITY, { kind: 'file', id: item.path, provenance: 'observed' }],
    benignExplanations: benignFor(item),
    evidence: [{ observationId: observation.id, why: 'the observed drift' }],
  };
}

export const WATCHER_IDENTITY: Identity = {
  kind: 'agent',
  id: 'bimax.project-watcher',
  display: 'project watcher',
  // `observed` is right: the watcher genuinely saw a change. What it cannot see is who made it,
  // which is why it is the subject rather than an attributed actor.
  provenance: 'observed',
};

function benignFor(item: DriftItem): string[] {
  switch (item.kind) {
    case 'lockfile-changed':
      return ['an install the user ran in another terminal', 'a lockfile refreshed by an editor integration'];
    case 'declaration-changed':
      return ['the user editing project configuration alongside this task'];
    case 'executable-added':
      return ['a package manager linking a newly installed binary', 'a build producing a CLI'];
    case 'executable-removed':
      return ['a clean step removing generated binaries'];
    case 'toolchain-changed':
      return ['a version manager switching runtimes for another project in the same shell'];
    case 'endpoint-added':
      return ['a registry mirror or CDN the declared host resolves to'];
    case 'credential-path-touched':
      return ['the user adding a key by hand while the task ran', 'an SSH agent rewriting its own state'];
    case 'persistence-path-touched':
      return ['a developer tool registering its background helper on first run'];
    case 'write-outside-project':
      return ['a global tool configuration the user maintains outside the project'];
  }
  return unreachable(item.kind);
}

/** An Observation for a drift item, so its Finding is never vacuous. */
export function driftObservation(
  item: DriftItem,
  taskIntentId: string,
  completeness: Completeness,
  now: number,
): Observation {
  const sensitivity: Sensitivity =
    item.pathClass === 'credential' || item.pathClass === 'ssh-authorized'
      || item.pathClass === 'persistence' || item.pathClass === 'security-setting'
      || item.pathClass === 'user-data' || item.pathClass === 'external'
      ? 'sensitive' : 'project';
  return record.observation({
    sensor: 'environment.inventory',
    scope: 'project',
    sensitivity,
    retention: 'task',
    taskIntentId,
    operationIntentId: null,
    subject: { kind: 'file', id: item.path, provenance: 'observed' },
    relationship: null,
    facts: redactFacts({
      driftKind: item.kind,
      pathClass: item.pathClass,
      inBuildOutput: item.inBuildOutput,
      detail: item.detail,
    }),
    freshnessMs: 0,
    completeness,
  }, now);
}

export interface AlertBudget {
  /** Maximum drift findings surfaced per batch. Beyond this they are aggregated, per §2.1. */
  maxSurfaced: number;
}

export const DEFAULT_ALERT_BUDGET: AlertBudget = { maxSurfaced: 10 };

export interface SurfacedDrift {
  surfaced: DriftItem[];
  /** Items folded into a count rather than shown individually. §2.1 forbids per-datum jitter. */
  aggregated: { kind: DriftKind; count: number }[];
}

/**
 * Apply the alert-volume budget.
 *
 * §2.1: "Signals below their effect threshold are aggregated, sampled, or discarded." Items are
 * ranked by the disposition they argue for, so a credential-path touch is never dropped in favour
 * of twenty lockfile lines — the budget bounds noise, it does not bound severity.
 */
export function applyAlertBudget(items: DriftItem[], budget: AlertBudget = DEFAULT_ALERT_BUDGET): SurfacedDrift {
  const rank = (item: DriftItem) => ({ recommend: 2, explain: 1, observe: 0 })[driftDisposition(item)];
  const ranked = items.slice().sort((a, b) => rank(b) - rank(a));
  const surfaced = ranked.slice(0, budget.maxSurfaced);
  const rest = ranked.slice(budget.maxSurfaced);
  const counts = new Map<DriftKind, number>();
  for (const item of rest) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return {
    surfaced,
    aggregated: [...counts.entries()].map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
  };
}
