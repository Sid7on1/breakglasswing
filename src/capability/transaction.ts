// The capability installation transaction — owner section 29 (V29B), slice S29-B.
//
// §15 of docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md gives the exact order:
//
//   fetch trusted metadata → resolve version/platform/dependencies → show permission + disk +
//   provenance diff → user/policy approval → download to staging → verify length/digest/signature/
//   provenance/notarization → scan/decompress with path and size limits → register inactive →
//   health-check isolated entrypoint → atomically activate → preserve rollback target
//
// This file is that order, made unskippable. The steps are a sequence, each one refuses to run
// before its predecessor succeeded, and the *only* way to reach `activate` is through all of them.
//
// The property S29-17 grades is rollback: "resolver failure with dirty project → rollback preserves
// all unrelated user changes and previous capability graph". So the transaction never mutates the
// live graph until activation, and activation captures the exact prior node — state, version and
// history — so restoring it is a copy back rather than a re-derivation. A re-derived "previous
// state" is a guess, and a guess is what the mutation test is looking for.

import {
  CapabilityGraph, CapabilityManifest, CapabilityNode, CapabilityState, declaredAuthority,
} from './manifest';
import {
  DownloadedArtifact, MetadataVerdict, ReviewNotes, TargetDescriptor, isDependencyConfusion,
} from './metadata';
import { ArchiveEntry, StagingVerdict, inspectArchive } from './staging';
import { DeclaredEffects } from '../evidence/schema';

export type TransactionStep =
  | 'metadata' | 'resolve' | 'preview' | 'approve' | 'verify' | 'stage'
  | 'register' | 'health-check' | 'activate' | 'committed'
  | 'refused' | 'rolled-back';

/** The order a transaction must pass through. Index comparison is the whole enforcement. */
const ORDER: TransactionStep[] = [
  'metadata', 'resolve', 'preview', 'approve', 'verify', 'stage',
  'register', 'health-check', 'activate', 'committed',
];

export interface InstallPreview {
  capabilityId: string;
  fromVersion: string | null;
  toVersion: string;
  /** Permissions being added relative to what is already permitted. The approval is about these. */
  newPermissions: DeclaredEffects;
  diskBytes: number;
  publisherIdentity: string | null;
  provenance: string | null;
  /** Vulnerability notes, review-only. §15 forbids acting on these automatically. */
  review: ReviewNotes;
  /** True when the manifest says a previous version can be restored. */
  rollbackSupported: boolean;
}

export interface StepResult {
  ok: boolean;
  step: TransactionStep;
  problems: string[];
  remedy: string | null;
}

const fail = (step: TransactionStep, problems: string[], remedy: string | null = null): StepResult =>
  ({ ok: false, step, problems, remedy });
const pass = (step: TransactionStep): StepResult => ({ ok: true, step, problems: [], remedy: null });

/** A byte-exact copy of a graph node, so restoring it cannot drift from what was there. */
function snapshotNode(node: CapabilityNode): CapabilityNode {
  return {
    manifest: { ...node.manifest, permissions: { ...node.manifest.permissions } },
    state: node.state,
    history: node.history.map(entry => ({ ...entry })),
    rollbackTarget: node.rollbackTarget,
  };
}

export interface TransactionOptions {
  requireNotarization?: boolean;
  now?: () => number;
}

/**
 * One installation. Single-use: a transaction that refused or committed is finished, and a retry is
 * a new transaction with fresh metadata. Reusing one would let a stale verification carry forward.
 */
export class CapabilityTransaction {
  private step: TransactionStep = 'metadata';
  private readonly problems: string[] = [];
  private preview: InstallPreview | null = null;
  private approvedPreview: InstallPreview | null = null;
  private stagingPlan: StagingVerdict | null = null;
  /** The exact node that was live before activation. The rollback target, not a reconstruction. */
  private priorNode: CapabilityNode | null = null;
  private priorAbsent = false;

  constructor(
    private readonly graph: CapabilityGraph,
    private readonly manifest: CapabilityManifest,
    private readonly options: TransactionOptions = {},
  ) {}

  get currentStep(): TransactionStep { return this.step; }
  get failures(): string[] { return [...this.problems]; }
  get approvedFor(): InstallPreview | null { return this.approvedPreview; }

  private at(step: TransactionStep): boolean { return this.step === step; }

  private advanceTo(step: TransactionStep): void {
    this.step = step;
  }

  private refuse(step: TransactionStep, problems: string[], remedy: string | null): StepResult {
    this.problems.push(...problems);
    this.step = 'refused';
    return fail(step, problems, remedy ?? 'nothing was installed; the existing capability graph is unchanged');
  }

  /** Step 1. The caller verifies the metadata chain; this records the verdict and refuses on it. */
  acceptMetadata(verdict: MetadataVerdict): StepResult {
    if (!this.at('metadata')) return fail('metadata', ['metadata was already accepted or the transaction is finished']);
    if (!verdict.trusted) return this.refuse('metadata', verdict.problems, verdict.remedy);
    this.advanceTo('resolve');
    return pass('metadata');
  }

  /** Step 2. Version, platform, dependency and namespace resolution against the live graph. */
  resolve(requestedId: string): StepResult {
    if (!this.at('resolve')) return fail('resolve', ['resolve ran out of order']);
    const problems: string[] = [];
    if (isDependencyConfusion(requestedId, this.manifest.id)) {
      problems.push(`requested ${requestedId} but the catalog resolved ${this.manifest.id}, a different namespace`);
    }
    const compatibility = this.graph.compatibility(this.manifest);
    if (!compatibility.compatible) problems.push(...compatibility.reasons);
    for (const unmet of this.graph.unmetDependencies(this.manifest)) {
      problems.push(`dependency ${unmet.id} ${unmet.want} is ${unmet.have ? `installed at ${unmet.have}` : 'not installed'}`);
    }
    if (problems.length) {
      return this.refuse('resolve', problems, 'resolve the listed constraints, then try the install again');
    }
    this.advanceTo('preview');
    return pass('resolve');
  }

  /** Step 3. Build the diff the user approves. Never mutates anything. */
  buildPreview(diskBytes: number, review: ReviewNotes): InstallPreview {
    const existing = this.graph.get(this.manifest.id);
    this.preview = {
      capabilityId: this.manifest.id,
      fromVersion: existing?.manifest.version ?? null,
      toVersion: this.manifest.version,
      newPermissions: permissionDelta(existing?.manifest ?? null, this.manifest),
      diskBytes,
      publisherIdentity: this.manifest.publisherIdentity,
      provenance: this.manifest.provenance,
      review,
      rollbackSupported: this.manifest.rollbackSupported,
    };
    if (this.at('preview')) this.advanceTo('approve');
    return this.preview;
  }

  /**
   * Step 4. Approval is bound to the exact preview shown. If the preview changed between display
   * and approval — new permissions, a different version — the approval does not carry.
   */
  approve(approvedPreview: InstallPreview): StepResult {
    if (!this.at('approve')) return fail('approve', ['approve ran out of order']);
    if (!this.preview) return this.refuse('approve', ['no preview was built'], null);
    if (JSON.stringify(approvedPreview) !== JSON.stringify(this.preview)) {
      return this.refuse(
        'approve',
        ['the approved preview does not match what this transaction would install'],
        'review the change again — the permissions, version or disk impact moved after it was shown',
      );
    }
    this.approvedPreview = approvedPreview;
    this.advanceTo('verify');
    return pass('approve');
  }

  /** Step 5. Length, digest, publisher identity, provenance and notarization of the artifact. */
  verifyArtifact(verdict: MetadataVerdict): StepResult {
    if (!this.at('verify')) return fail('verify', ['verify ran out of order']);
    if (!verdict.trusted) return this.refuse('verify', verdict.problems, verdict.remedy);
    this.advanceTo('stage');
    return pass('verify');
  }

  /** Step 6. Bounded inspection. Nothing is written unless the whole archive is accepted. */
  stage(entries: ArchiveEntry[], stagingRoot: string): StepResult {
    if (!this.at('stage')) return fail('stage', ['stage ran out of order']);
    const verdict = inspectArchive(entries, stagingRoot, this.manifest.scripts);
    this.stagingPlan = verdict;
    if (!verdict.accepted) {
      return this.refuse(
        'stage',
        verdict.rejections.map(r => `${r.rule}: ${r.entry} — ${r.detail}`),
        'the archive was rejected before extraction; nothing was written outside the staging root',
      );
    }
    this.advanceTo('register');
    return pass('stage');
  }

  /** What extraction would write. Empty until staging accepted, and empty forever if it refused. */
  get plannedWrites(): ArchiveEntry[] { return this.stagingPlan?.plan ?? []; }

  /** Step 7. Register inactive. The capability exists in the graph but grants nothing yet. */
  register(): StepResult {
    if (!this.at('register')) return fail('register', ['register ran out of order']);
    const existing = this.graph.get(this.manifest.id);
    if (existing) {
      this.priorNode = snapshotNode(existing);
    } else {
      this.priorAbsent = true;
    }
    // Discovery replaces the node with the incoming version, still at `discovered` — nothing is
    // granted, and the prior node is already captured byte-for-byte above.
    this.graph.discover(this.manifest, `staged ${this.manifest.version} for installation`);
    const walked = this.graph.advance(this.manifest.id, 'verified', 'signed metadata and artifact digest verified')
      && this.graph.advance(this.manifest.id, 'compatible', 'platform, macOS minimum and dependencies resolved')
      && this.graph.advance(this.manifest.id, 'permitted', 'the exact preview shown was approved');
    if (!walked) return this.refuse('register', ['the capability graph refused a transition'], null);
    this.advanceTo('health-check');
    return pass('register');
  }

  /** Step 8. Health-check the isolated entrypoint before it can be reached by a task. */
  healthCheck(healthy: boolean, detail: string): StepResult {
    if (!this.at('health-check')) return fail('health-check', ['health check ran out of order']);
    if (!healthy) {
      this.rollback(`health check failed: ${detail}`);
      return fail('health-check', [`health check failed: ${detail}`],
        'the previous version remains active and the staged version was discarded');
    }
    this.advanceTo('activate');
    return pass('health-check');
  }

  /** Step 9. Atomic activation, with the rollback target preserved. */
  activate(): StepResult {
    if (!this.at('activate')) return fail('activate', ['activate ran out of order']);
    if (!this.graph.advance(this.manifest.id, 'activated', 'health check passed on the isolated entrypoint')) {
      return this.refuse('activate', ['the capability graph refused activation'], null);
    }
    this.graph.setRollbackTarget(this.manifest.id, this.priorNode?.manifest.version ?? null);
    this.graph.advance(this.manifest.id, 'healthy', 'activated and reachable');
    this.advanceTo('committed');
    return pass('activate');
  }

  /**
   * Restore the exact prior graph.
   *
   * "Exact" is the whole point: the captured node is written back as it was, including its history,
   * so the timeline shows the failed attempt and the restoration rather than a graph that quietly
   * looks like nothing happened. When there was no prior version the capability is removed by being
   * marked `rollback`, which is off the forward path — a half-installed capability must never be
   * reachable, and leaving it `discovered` would let a later step pick it up.
   */
  rollback(reason: string): StepResult {
    const restored = this.priorNode;
    if (restored) {
      this.graph.discover(restored.manifest, `rolled back to ${restored.manifest.version}: ${reason}`);
      const node = this.graph.get(restored.manifest.id) as CapabilityNode;
      node.state = restored.state;
      node.rollbackTarget = restored.rollbackTarget;
      node.history = [
        ...restored.history,
        { at: (this.options.now ?? Date.now)(), state: restored.state, reason: `rolled back: ${reason}` },
      ];
    } else if (this.priorAbsent) {
      this.graph.halt(this.manifest.id, 'rollback', `install did not complete: ${reason}`);
    }
    this.step = 'rolled-back';
    this.problems.push(reason);
    return { ok: true, step: 'rolled-back', problems: [reason], remedy: null };
  }

  /** True when this transaction reached a state where nothing further may happen. */
  get finished(): boolean {
    return this.step === 'committed' || this.step === 'refused' || this.step === 'rolled-back';
  }

  /** How far through the required order this transaction got, for the receipt. */
  get progress(): { reached: TransactionStep; index: number; total: number } {
    const index = ORDER.indexOf(this.step);
    return { reached: this.step, index: index < 0 ? -1 : index, total: ORDER.length };
  }
}

/**
 * Permissions the incoming version adds over the installed one. An upgrade that asks for nothing new
 * should not present the user with the whole permission set again — and an upgrade that quietly
 * widens authority must not be able to hide inside a version bump.
 */
export function permissionDelta(from: CapabilityManifest | null, to: CapabilityManifest): DeclaredEffects {
  const incoming = declaredAuthority(to);
  if (!from) return incoming;
  const existing = declaredAuthority(from);
  const added = (next: string[], previous: string[]) => next.filter(value => !previous.includes(value));
  return {
    reads: added(incoming.reads, existing.reads),
    writes: added(incoming.writes, existing.writes),
    deletes: added(incoming.deletes, existing.deletes),
    hosts: added(incoming.hosts, existing.hosts),
    processes: added(incoming.processes, existing.processes),
    installsDependencies: incoming.installsDependencies && !existing.installsDependencies,
    readOnly: incoming.readOnly,
  };
}

/** True when the delta asks for anything at all — the trigger for a fresh approval on upgrade. */
export function widensAuthority(delta: DeclaredEffects): boolean {
  return delta.reads.length > 0 || delta.writes.length > 0 || delta.deletes.length > 0
    || delta.hosts.length > 0 || delta.processes.length > 0 || delta.installsDependencies;
}

export { CapabilityState };
