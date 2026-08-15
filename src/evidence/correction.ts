// Reversible correction — owner section 28 (V28B), slice S28-C.
//
// §8 of docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md gives the transaction:
//
//   detect → collect fresh minimal evidence → classify ownership and authority → build correction
//   preview → capture reversible snapshot or declare non-reversible impact → request policy/user
//   approval → re-check preconditions → apply one bounded mutation → observe independent
//   postcondition → commit receipt or roll back
//
// S28-C's exit is "mutation testing proves a fake repair cannot pass when end state is wrong", and
// journeys S28-07 ("correction fails halfway → before-state restored and independently verified")
// and S28-08 ("dirty repository correction → unrelated user changes survive byte-for-byte") are what
// it is graded on. Three properties carry that:
//
//   **One bounded mutation.** A correction touches exactly the paths it previewed. `apply` refuses a
//   mutator that reports touching anything else, *after* the fact, and rolls back — so exceeding the
//   preview is a failed correction rather than a wider one.
//
//   **Independent postcondition.** The thing that checks the end state is not the thing that made
//   it. `verify` takes a separate probe, and a correction whose probe is the mutator's own return
//   value cannot be expressed: the probe reads the world.
//
//   **Dirty state is sacred.** The snapshot covers only the previewed paths, and restoration writes
//   only those paths back. Nothing in this file can touch a file the correction did not name, which
//   is what makes S28-08's "byte-for-byte" claim structural rather than careful.

import {
  COMPLETE, Completeness, DeclaredEffects, EvidenceRef, Identity, Observation, Verification,
  admissible, concludeSatisfied, gap, noEffects, redactFacts,
} from './schema';
import { EvidenceLedger, record } from './ledger';
import { PathClass, classifyPath, isInside, normalizePath } from './path.class';

/** §8's correction classes. macOS mutation is deliberately absent: it needs a supported API first. */
export type CorrectionClass =
  | 'project'      // restore a lockfile, remove an unapproved generated executable
  | 'environment'  // restore a virtual environment, select a known-good runtime
  | 'bimax'        // stop a tool, revoke a grant, clear a cache, roll back a signed package
  | 'macos-recommendation'; // explain and deep-link; Bimax mutates nothing

export type CorrectionStep =
  | 'proposed' | 'previewed' | 'snapshotted' | 'approved' | 'precondition'
  | 'applied' | 'verified' | 'committed' | 'rolled-back' | 'refused';

export interface CorrectionPreview {
  correctionClass: CorrectionClass;
  summary: string;
  /** Exactly the paths this correction will touch. The bound on everything that follows. */
  paths: string[];
  /** A human-readable before → after per path. */
  changes: { path: string; from: string; to: string }[];
  /** Set when some part of the impact cannot be undone. §8 requires declaring it, not hiding it. */
  nonReversibleImpact: string[];
  /** The postcondition an independent probe will check afterwards. */
  postcondition: string;
}

/** A byte-exact capture of the previewed paths, and nothing else. */
export interface CorrectionSnapshot {
  /** path → contents, or null when the file did not exist (restoring means deleting it again). */
  contents: Record<string, string | null>;
  takenAt: number;
}

export interface CorrectionHost {
  /** Read a file, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  /** Write a file. Only ever called with a previewed path. */
  write(path: string, contents: string): Promise<void>;
  /** Remove a file. Only ever called with a previewed path that did not exist at snapshot time. */
  remove(path: string): Promise<void>;
}

export interface MutationResult {
  ok: boolean;
  /** Every path the mutator actually touched. Checked against the preview; not trusted. */
  touched: string[];
  detail: string;
}

/** The independent probe. Reads the world; never told what the mutator thinks it did. */
export type PostconditionProbe = () => Promise<{ satisfied: boolean; detail: string; freshnessMs: number }>;

export interface CorrectionOutcome {
  step: CorrectionStep;
  ok: boolean;
  detail: string;
  /** Ledger ids for the receipt, verification and rollback this correction produced. */
  receiptId: string | null;
  verificationId: string | null;
  rollbackId: string | null;
}

export interface CorrectionOptions {
  home?: string;
  projectRoot?: string | null;
  now?: () => number;
  /** How old the postcondition evidence may be before the verdict collapses to unknown. */
  freshnessBudgetMs?: number;
}

/**
 * Path classes a correction may never mutate.
 *
 * Three of these are Layer A hard floors the Task Guard already refuses; listing them again here is
 * deliberate, because a *correction* is the one code path whose whole job is to write, and it must
 * not become the way around a floor. `persistence` is here for the §7/§8 reason above.
 */
const UNCORRECTABLE: ReadonlySet<PathClass> = new Set<PathClass>([
  'system-integrity', 'security-setting', 'credential', 'ssh-authorized', 'persistence',
]);

const ACTOR: Identity = {
  kind: 'agent', id: 'bimax.correction', display: 'Bimax correction', provenance: 'observed',
};

/**
 * One correction. Single-use, and the step order is enforced the same way the capability
 * transaction enforces its own: a correction that skipped its snapshot cannot be rolled back, so
 * skipping it is refused rather than survived.
 */
export class Correction {
  private step: CorrectionStep = 'proposed';
  private preview: CorrectionPreview | null = null;
  private snapshot: CorrectionSnapshot | null = null;
  private approvalId: string | null = null;
  private receiptId: string | null = null;
  private readonly now: () => number;
  private readonly freshnessBudgetMs: number;

  constructor(
    private readonly ledger: EvidenceLedger,
    private readonly taskIntentId: string,
    private readonly operationIntentId: string,
    private readonly host: CorrectionHost,
    private readonly options: CorrectionOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.freshnessBudgetMs = options.freshnessBudgetMs ?? 5_000;
  }

  get currentStep(): CorrectionStep { return this.step; }
  get previewed(): CorrectionPreview | null { return this.preview; }

  private refuse(detail: string): CorrectionOutcome {
    this.step = 'refused';
    return { step: 'refused', ok: false, detail, receiptId: null, verificationId: null, rollbackId: null };
  }

  /**
   * Step 1–2: classify authority and build the preview.
   *
   * A correction may never touch a path class Bimax must not mutate — system integrity, security
   * settings, or a credential store. That is the same Layer A floor the Task Guard enforces, applied
   * here so a *correction* cannot become the way around it.
   */
  propose(preview: CorrectionPreview): CorrectionOutcome {
    if (this.step !== 'proposed') return this.refuse('propose ran out of order');
    if (!preview.paths.length && preview.correctionClass !== 'macos-recommendation') {
      return this.refuse('a correction that names no path cannot be bounded');
    }
    if (!preview.postcondition.trim()) {
      return this.refuse('a correction must declare the postcondition that will be checked');
    }
    for (const path of preview.paths) {
      const cls = classifyPath(path, { projectRoot: this.options.projectRoot ?? null, home: this.options.home });
      // Persistence is on this list even though removing a hostile LaunchAgent is an obviously
      // useful repair. §7: "persistence removal … [is] never [a] silent automatic correction", and
      // §8 puts any macOS mutation behind a supported Apple API, explicit authority, a preview, a
      // rollback and a passing acceptance journey. None of those exist yet, so the honest answer is
      // that this slice explains persistence changes and refuses to undo them.
      if (UNCORRECTABLE.has(cls)) {
        return this.refuse(`a correction may not mutate ${path} (${cls}); Bimax explains these, it does not change them`);
      }
    }
    if (preview.correctionClass === 'macos-recommendation' && preview.paths.length) {
      return this.refuse('a macOS recommendation explains and deep-links; it never names paths to mutate');
    }
    this.preview = preview;
    this.step = 'previewed';
    return { step: 'previewed', ok: true, detail: 'preview built', receiptId: null, verificationId: null, rollbackId: null };
  }

  /**
   * Step 3: capture the reversible snapshot.
   *
   * Only the previewed paths are read. That bound is what makes S28-08 true: a correction physically
   * cannot restore — and therefore cannot clobber — a file it never named.
   */
  async captureSnapshot(): Promise<CorrectionOutcome> {
    if (this.step !== 'previewed' || !this.preview) return this.refuse('snapshot ran out of order');
    const contents: Record<string, string | null> = {};
    for (const path of this.preview.paths) {
      contents[normalizePath(path)] = await this.host.read(normalizePath(path));
    }
    this.snapshot = { contents, takenAt: this.now() };
    this.step = 'snapshotted';
    return {
      step: 'snapshotted', ok: true,
      detail: `captured ${Object.keys(contents).length} path(s)`,
      receiptId: null, verificationId: null, rollbackId: null,
    };
  }

  /** Step 4: approval, bound to the exact preview. */
  approve(approvedPreview: CorrectionPreview, grantedBy: 'user' | 'policy'): CorrectionOutcome {
    if (this.step !== 'snapshotted' || !this.preview) return this.refuse('approve ran out of order');
    if (JSON.stringify(approvedPreview) !== JSON.stringify(this.preview)) {
      return this.refuse('the approved preview is not the correction that would be applied');
    }
    const approval = this.ledger.append(record.approval({
      operationIntentId: this.operationIntentId,
      decisionId: null,
      grantedBy,
      scope: previewScope(this.preview),
      expiresAt: null,
    }, this.now()));
    this.approvalId = approval.id;
    this.step = 'approved';
    return { step: 'approved', ok: true, detail: `approved by ${grantedBy}`, receiptId: null, verificationId: null, rollbackId: null };
  }

  /**
   * Step 5: re-check preconditions against a *fresh* read.
   *
   * The snapshot is not the precondition. Between approval and application the world may have moved,
   * and §8 asks for "re-check preconditions" precisely because an approval is about a state, not a
   * moment. A path that changed since the snapshot invalidates the correction.
   */
  async checkPreconditions(): Promise<CorrectionOutcome> {
    if (this.step !== 'approved' || !this.preview || !this.snapshot) return this.refuse('precondition check ran out of order');
    for (const path of Object.keys(this.snapshot.contents)) {
      const current = await this.host.read(path);
      if (current !== this.snapshot.contents[path]) {
        return this.refuse(`${path} changed between the snapshot and the correction; the approval no longer describes reality`);
      }
    }
    this.step = 'precondition';
    return { step: 'precondition', ok: true, detail: 'preconditions still hold', receiptId: null, verificationId: null, rollbackId: null };
  }

  /**
   * Step 6: apply exactly one bounded mutation, then step 7: check it independently.
   *
   * A mutator that reports touching a path outside the preview is rolled back even when it claims
   * success — exceeding the bound is itself the failure. Likewise a probe that cannot establish the
   * postcondition on fresh evidence yields `null`, and `null` rolls back: §8 commits on an observed
   * postcondition, and "we could not tell" is not one.
   */
  async apply(mutate: () => Promise<MutationResult>, probe: PostconditionProbe): Promise<CorrectionOutcome> {
    if (this.step !== 'precondition' || !this.preview || !this.snapshot) return this.refuse('apply ran out of order');
    const previewed = new Set(this.preview.paths.map(normalizePath));

    let mutation: MutationResult;
    try {
      mutation = await mutate();
    } catch (error) {
      const rollback = await this.rollback(`the mutation threw: ${(error as Error).message}`);
      return { ...rollback, step: 'rolled-back', ok: false, detail: `the mutation threw: ${(error as Error).message}` };
    }

    const strayed = mutation.touched.map(normalizePath).filter(path => !previewed.has(path));
    if (strayed.length) {
      const rollback = await this.rollback(`the correction touched ${strayed.join(', ')}, which its preview did not name`);
      return { ...rollback, ok: false, detail: `the correction exceeded its preview: ${strayed.join(', ')}` };
    }

    const receipt = this.ledger.append(record.actionReceipt({
      operationIntentId: this.operationIntentId,
      approvalId: this.approvalId,
      executor: `correction:${this.preview.correctionClass}`,
      outcome: mutation.ok ? 'applied' : 'failed',
      observed: previewScope(this.preview),
      before: [],
      after: mutation.ok ? [this.observe('after', mutation.detail).id] : [],
      reason: mutation.detail,
    }, this.now()));
    this.receiptId = receipt.id;
    this.step = 'applied';

    if (!mutation.ok) {
      const rollback = await this.rollback(`the mutation reported failure: ${mutation.detail}`);
      return { ...rollback, ok: false, detail: mutation.detail, receiptId: receipt.id };
    }

    const probed = await probe();
    const evidence = this.observe('postcondition', probed.detail, probed.freshnessMs);
    const satisfied = concludeSatisfied(probed.satisfied, probed.freshnessMs, this.freshnessBudgetMs, COMPLETE);
    const verification = this.ledger.append(record.verification({
      actionReceiptId: receipt.id,
      postcondition: this.preview.postcondition,
      satisfied,
      freshnessMs: probed.freshnessMs,
      freshnessBudgetMs: this.freshnessBudgetMs,
      completeness: COMPLETE,
      basis: 'observed',
      evidence: [{ observationId: evidence.id, why: 'the independent postcondition probe' }],
      reason: satisfied === null
        ? `the postcondition could not be established: ${probed.detail}`
        : satisfied ? probed.detail : `the end state does not satisfy the postcondition: ${probed.detail}`,
    }, this.now()));
    this.step = 'verified';

    if (satisfied !== true) {
      const rollback = await this.rollback(
        satisfied === null
          ? 'the postcondition could not be established on fresh evidence'
          : 'the end state does not satisfy the postcondition',
      );
      return { ...rollback, ok: false, detail: verification.reason, receiptId: receipt.id, verificationId: verification.id };
    }

    this.step = 'committed';
    return {
      step: 'committed', ok: true, detail: verification.reason,
      receiptId: receipt.id, verificationId: verification.id, rollbackId: null,
    };
  }

  /**
   * Restore the snapshot, then prove the restoration independently.
   *
   * The Rollback record cannot claim `restored` without a Verification id — the schema rejects it —
   * so this re-reads every snapshotted path and compares. A restoration that did not take is
   * reported as `partial` or `failed`, which is the honest outcome and the one S28-07 grades.
   */
  async rollback(reason: string): Promise<CorrectionOutcome> {
    if (!this.snapshot) {
      const record0 = this.ledger.append(record.rollback({
        actionReceiptId: this.receiptId ?? this.operationIntentId,
        target: 'no snapshot',
        result: 'failed',
        verificationId: null,
        reason: `${reason}; no snapshot was captured, so nothing could be restored`,
      }, this.now()));
      this.step = 'rolled-back';
      return { step: 'rolled-back', ok: false, detail: record0.reason, receiptId: this.receiptId, verificationId: null, rollbackId: record0.id };
    }

    const failures: string[] = [];
    for (const [path, before] of Object.entries(this.snapshot.contents)) {
      try {
        if (before === null) await this.host.remove(path);
        else await this.host.write(path, before);
      } catch (error) {
        failures.push(`${path}: ${(error as Error).message}`);
      }
    }

    // Independent check that the restoration actually happened.
    const mismatched: string[] = [];
    for (const [path, before] of Object.entries(this.snapshot.contents)) {
      const current = await this.host.read(path).catch(() => undefined);
      if (current === undefined || current !== before) mismatched.push(path);
    }
    const restored = failures.length === 0 && mismatched.length === 0;
    const evidence = this.observe(
      'rollback',
      restored ? 'every snapshotted path matches its captured contents' : `unrestored: ${[...failures, ...mismatched].join(', ')}`,
    );
    const verification = this.ledger.append(record.verification({
      actionReceiptId: this.receiptId ?? this.operationIntentId,
      postcondition: 'every path this correction touched is back to its captured contents',
      satisfied: restored ? true : false,
      freshnessMs: 0,
      freshnessBudgetMs: this.freshnessBudgetMs,
      completeness: COMPLETE,
      basis: 'observed',
      evidence: [{ observationId: evidence.id, why: 'the restoration re-read' }],
      reason: restored ? 'the before state was restored and re-read' : 'the before state was not fully restored',
    }, this.now()));

    const rollbackRecord = this.ledger.append(record.rollback({
      actionReceiptId: this.receiptId ?? this.operationIntentId,
      target: `snapshot@${this.snapshot.takenAt}`,
      result: restored ? 'restored' : (failures.length === Object.keys(this.snapshot.contents).length ? 'failed' : 'partial'),
      verificationId: verification.id,
      reason,
    }, this.now()));

    this.step = 'rolled-back';
    return {
      step: 'rolled-back', ok: restored, detail: rollbackRecord.reason,
      receiptId: this.receiptId, verificationId: verification.id, rollbackId: rollbackRecord.id,
    };
  }

  private observe(phase: string, detail: string, freshnessMs = 0): Observation {
    return this.ledger.append(record.observation({
      sensor: 'engine.tool',
      scope: 'project',
      sensitivity: 'project',
      retention: 'task',
      taskIntentId: this.taskIntentId,
      operationIntentId: this.operationIntentId,
      subject: { kind: 'project', id: this.options.projectRoot ?? 'project', provenance: 'observed' },
      relationship: { kind: 'wrote', object: ACTOR },
      facts: redactFacts({ phase, detail, paths: this.preview?.paths ?? [] }),
      freshnessMs,
      completeness: COMPLETE,
    }, this.now()));
  }
}

function previewScope(preview: CorrectionPreview): DeclaredEffects {
  return noEffects({ writes: preview.paths.map(normalizePath) });
}

/**
 * Whether a correction's previewed paths stay inside the approved project.
 *
 * A correction is a mutation, and §8's project class is explicitly about "using git/checkpoint
 * evidence and never erasing unrelated dirty work". Containment is the cheapest half of that.
 */
export function correctionStaysInProject(preview: CorrectionPreview, projectRoot: string): boolean {
  return preview.paths.every(path => isInside(path, projectRoot));
}

/** Paths a correction would touch that the user has uncommitted changes in. §8's dirty-work rule. */
export function conflictsWithDirtyWork(preview: CorrectionPreview, dirtyPaths: string[]): string[] {
  const dirty = new Set(dirtyPaths.map(normalizePath));
  return preview.paths.map(normalizePath).filter(path => dirty.has(path));
}

/** Evidence refs for a correction's verification, for callers assembling a Trust Center row. */
export function correctionEvidence(verification: Verification): EvidenceRef[] { return verification.evidence; }

/** Completeness for a correction whose snapshot could not cover every previewed path. */
export function partialSnapshot(missing: string[]): Completeness {
  return missing.length
    ? gap(`the snapshot could not capture ${missing.join(', ')}; those paths cannot be restored`, missing.length)
    : COMPLETE;
}

export { admissible };
