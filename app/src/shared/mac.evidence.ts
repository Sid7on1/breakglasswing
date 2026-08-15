// Mac action receipts → the shared causal vocabulary — Phase 8, owner section 28.
//
// The Phase 8 roadmap requires Computer Use operations to emit causal receipts like every other
// Bimax-owned subsystem. Desktop already produces rich Mac action receipts (`app/src/capabilities/
// mac/action.receipt.ts`); this adapter translates one into an OperationIntent + Observation +
// ActionReceipt + Verification so it lands on the same Trust Center timeline as an engine tool call.
//
// The translation is where the honesty rules bite, and they bite hard here because a Mac action is
// the one place Bimax genuinely observes an end state:
//
//   - A Mac action's postcondition is `observed`, not `declared` — the AX tree was actually read.
//     That is the one subsystem allowed to produce `satisfied: true`.
//   - But a receipt whose observation is stale, or whose recipient did not match, must not. The
//     Desktop CU work already learned this the hard way; here it is the schema that enforces it.
//   - The renderer never sees a pid, an audit token, an element handle or a window id. The Identity
//     carries the app's bundle id and a human label, and nothing else crosses.

import {
  ActionReceipt, COMPLETE, Completeness, DeclaredEffects, EvidenceRecord, Identity, Observation,
  OperationIntent, Verification, concludeSatisfied, gap, noEffects, redactFacts,
} from './evidence.gen';

/** The subset of a Mac action Desktop can describe without leaking a native handle. */
export interface MacActionSummary {
  /** `mac.click`, `mac.type`, `mac.read`. */
  action: string;
  /** Bundle identifier of the app that was targeted. Never a pid. */
  targetBundleId: string;
  /** Human label for the window or element, already redacted of any typed content. */
  targetLabel: string;
  /** Which rung of the ladder actually delivered the action. */
  executor: 'native-semantic' | 'native-physical' | 'visual-recovery' | 'refused';
  outcome: ActionReceipt['outcome'];
  /** Whether the observation the action was planned against was still fresh at delivery. */
  observationAgeMs: number;
  /** The postcondition the provider checked, in words. */
  postcondition: string;
  /** Whether the provider observed that postcondition to hold. */
  postconditionHeld: boolean;
  /** Set when the provider knows its observation was partial — a dropped AX event, a lost frame. */
  observationGap: string | null;
  reason: string;
}

/** How fresh a Mac observation must be to certify an end state. A window moves in well under a second. */
export const MAC_FRESHNESS_BUDGET_MS = 1_500;

export interface MacEvidenceIds {
  taskIntentId: string;
  operationIntentId: string;
  observationId: string;
  actionReceiptId: string;
  verificationId: string;
}

export interface MacEvidenceBundle {
  operation: Omit<OperationIntent, 'id'> & { id: string };
  observation: Observation;
  receipt: ActionReceipt;
  verification: Verification;
}

/**
 * The identity of a Mac action's target.
 *
 * `provenance: 'macos'` is the strongest value in §2.3's trust hierarchy and is used here because a
 * bundle identifier genuinely comes from macOS. The label does not — it comes from the AX tree,
 * which apps author — so it is carried as a display string and never as the id.
 */
export function macTargetIdentity(bundleId: string, label: string): Identity {
  return { kind: 'app', id: bundleId, display: label, provenance: 'macos' };
}

/** Effects a Mac action had, in the shared vocabulary. A UI action touches no files. */
export function macEffects(summary: MacActionSummary): DeclaredEffects {
  return noEffects({
    processes: [summary.targetBundleId],
    readOnly: summary.action.endsWith('.read') || summary.action.endsWith('.observe'),
  });
}

/**
 * Turn a Mac action summary into evidence records.
 *
 * The caller supplies the ids because Desktop's sealing lives in the main process; this function is
 * the pure translation, so the same summary always produces the same records and the renderer-side
 * timeline tests can drive it directly.
 */
export function macActionEvidence(
  summary: MacActionSummary,
  ids: MacEvidenceIds,
  parentOperationId: string | null,
  createdAt: number,
): MacEvidenceBundle {
  const completeness: Completeness = summary.observationGap
    ? gap(summary.observationGap)
    : COMPLETE;
  const target = macTargetIdentity(summary.targetBundleId, summary.targetLabel);
  const effects = macEffects(summary);

  const operation: MacEvidenceBundle['operation'] = {
    schema: 'bimax.evidence/1',
    kind: 'OperationIntent',
    id: ids.operationIntentId,
    taskIntentId: ids.taskIntentId,
    parentOperationId,
    createdAt,
    subsystem: 'computer-use',
    operation: `${summary.action}(${summary.targetLabel})`,
    actor: { kind: 'agent', id: 'bimax.desktop.mac', display: 'Bimax for Mac', provenance: 'observed' },
    declared: effects,
    taint: [],
  };

  const observation: Observation = {
    schema: 'bimax.evidence/1',
    kind: 'Observation',
    id: ids.observationId,
    createdAt,
    sensor: 'desktop.mac',
    scope: 'app',
    sensitivity: 'project',
    retention: 'task',
    taskIntentId: ids.taskIntentId,
    operationIntentId: ids.operationIntentId,
    subject: target,
    relationship: { kind: 'connected-to', object: operation.actor },
    // The label is the only free text that crosses, and it is redacted the same way every other
    // fact is — a window title can contain a password field's placeholder or a document name.
    facts: redactFacts({
      action: summary.action,
      executor: summary.executor,
      targetLabel: summary.targetLabel,
      postconditionHeld: summary.postconditionHeld,
    }),
    freshnessMs: summary.observationAgeMs,
    completeness,
  };

  const receipt: ActionReceipt = {
    schema: 'bimax.evidence/1',
    kind: 'ActionReceipt',
    id: ids.actionReceiptId,
    createdAt,
    operationIntentId: ids.operationIntentId,
    approvalId: null,
    executor: summary.executor,
    outcome: summary.outcome,
    observed: effects,
    before: [],
    after: summary.outcome === 'applied' ? [ids.observationId] : [],
    reason: summary.reason,
  };

  // The only subsystem that can honestly say `satisfied: true`, and only when the frame it decided
  // on was fresh and nothing was dropped. `concludeSatisfied` is what makes that non-negotiable.
  const satisfied = concludeSatisfied(
    summary.postconditionHeld,
    summary.observationAgeMs,
    MAC_FRESHNESS_BUDGET_MS,
    completeness,
  );

  const verification: Verification = {
    schema: 'bimax.evidence/1',
    kind: 'Verification',
    id: ids.verificationId,
    createdAt,
    actionReceiptId: ids.actionReceiptId,
    postcondition: summary.postcondition,
    satisfied,
    freshnessMs: summary.observationAgeMs,
    freshnessBudgetMs: MAC_FRESHNESS_BUDGET_MS,
    completeness,
    basis: 'observed',
    evidence: [{ observationId: ids.observationId, why: 'the post-action accessibility read' }],
    reason: satisfied === null
      ? `the end state could not be established: ${summary.observationGap ?? `the observation was ${summary.observationAgeMs}ms old`}`
      : satisfied
        ? summary.reason
        : `the end state does not satisfy the postcondition: ${summary.reason}`,
  };

  return { operation, observation, receipt, verification };
}

/** Flatten a bundle into the records the store ingests, in causal order. */
export function macEvidenceRecords(bundle: MacEvidenceBundle): EvidenceRecord[] {
  return [bundle.operation as OperationIntent, bundle.observation, bundle.receipt, bundle.verification];
}
