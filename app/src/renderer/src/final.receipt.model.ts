import type { MacSession } from './mac.session.model';
import type { ReviewSnapshot } from './protocol';

/**
 * The final receipt: what Bimax claims, and the evidence each claim rests on.
 *
 * `competitive/05_GAP_REGISTER.md` records this as an open gap ("Rivals show tools/diffs; Bimax
 * needs a stronger proof surface… code/Mac final-receipt unification remains later shared work"),
 * and `03_PRODUCT_EXAMPLES.md` names the two lanes a Bimax task can produce evidence in.
 *
 * The hard rule from `08_ACCEPTANCE_GATES.md` is that an evidence gap "cannot produce an
 * unqualified safe verdict". So this model has an explicit `gaps` list, and `proven` is false
 * whenever a claim has no supporting evidence — an unproven claim is still SHOWN, labelled
 * unproven, rather than dropped so the receipt can look complete.
 */

export type ReceiptLane = 'code' | 'mac';

export interface ReceiptEvidence {
  lane: ReceiptLane;
  label: string;
  detail: string;
  /** True only when the underlying record itself reported success. */
  ok: boolean | null;
}

export interface ReceiptClaim {
  id: string;
  claim: string;
  proven: boolean;
  evidence: ReceiptEvidence[];
  /** Why this claim is not proven. Empty when it is. */
  gap: string;
}

export interface FinalReceipt {
  /** True only when every claim carries at least one successful piece of evidence. */
  complete: boolean;
  claims: ReceiptClaim[];
  gaps: string[];
  /** Everything the task did that has no claim attached — never silently dropped. */
  summary: string;
}

export interface FinalReceiptInput {
  review: ReviewSnapshot | null;
  mac: MacSession;
}

/**
 * Did the session ever identify what it was acting on?
 *
 * A receipt that says "performed 3 actions" without naming an app, a process and an observation is
 * not evidence — it is a count. `mac.session.model.ts` only advances the target from a payload that
 * actually named one, so this is a genuine check rather than a restatement of the request.
 */
function hasTargetBinding(mac: FinalReceiptInput['mac']): boolean {
  return !!mac.target?.app && mac.target.pid !== null && mac.target.windowId !== null
    && !!mac.evidence?.observation
    && mac.evidence.observation !== 'not reported';
}

export function buildFinalReceipt(input: FinalReceiptInput): FinalReceipt {
  const claims: ReceiptClaim[] = [];
  const review = input.review;

  if (review && review.changes.length > 0) {
    const verifications = review.verifications;
    const passing = verifications.filter(check => check.ok);
    const failing = verifications.filter(check => !check.ok);
    claims.push({
      id: 'code-changes',
      claim: `Changed ${review.changes.length} file${review.changes.length === 1 ? '' : 's'}`,
      // A change is proven by a check that passed AND nothing that failed. A green check beside a
      // red one is not a proof; it is a contradiction the user has to see.
      proven: passing.length > 0 && failing.length === 0,
      evidence: [
        ...review.changes.map((change): ReceiptEvidence => ({
          lane: 'code',
          label: change.file,
          detail: `${change.edits} edit${change.edits === 1 ? '' : 's'} · ${change.tools.join(', ') || 'no tool recorded'}`,
          // An edit record says the edit happened, not that it was correct. Only a check can say
          // that, so the file row deliberately carries no verdict.
          ok: null,
        })),
        ...verifications.map((check): ReceiptEvidence => ({
          lane: 'code',
          label: check.command,
          detail: check.ok ? 'passed' : 'failed',
          ok: check.ok,
        })),
      ],
      gap: failing.length > 0
        ? `${failing.length} check${failing.length === 1 ? '' : 's'} failed after these edits`
        : passing.length === 0
          ? 'no verification command was run against these edits'
          : '',
    });
  }

  const acted = input.mac.timeline.filter(entry => !entry.refusedForTakeover && entry.status !== 'running');
  if (acted.length > 0) {
    /**
     * What a proven Mac action requires. All four, per action — `05_TARGET_ARCHITECTURE.md`:
     * "Every action binds target app, target window, observation/frame ID, executor level,
     * start/end time, and postcondition."
     *
     * `unattributed` is the one that used to slip through. `executor.ladder.ts` returns it
     * precisely when the runtime could NOT say which executor acted — an uninstrumented
     * compatibility path. An action nobody can attribute is not a proven action, however green its
     * postcondition looks, because there is no record of what actually touched the machine.
     */
    const succeeded = acted.filter(entry => entry.status === 'success');
    const confirmed = succeeded.filter(entry => entry.postcondition.startsWith('matched'));
    const attributed = confirmed.filter(entry => entry.executor !== 'unattributed');
    const bound = attributed.filter(() => hasTargetBinding(input.mac));
    const unattributed = acted.filter(entry => entry.executor === 'unattributed');

    claims.push({
      id: 'mac-actions',
      claim: `Performed ${acted.length} action${acted.length === 1 ? '' : 's'} on ${input.mac.target?.app || 'your Mac'}`,
      proven: bound.length > 0 && bound.length === acted.length,
      evidence: acted.map((entry): ReceiptEvidence => ({
        lane: 'mac',
        label: entry.label,
        detail: `${entry.executor} · ${entry.focus} · ${entry.postcondition}`,
        ok: entry.status === 'success'
          && entry.postcondition.startsWith('matched')
          && entry.executor !== 'unattributed',
      })),
      gap: confirmed.length === 0
        ? 'no action confirmed its expected end state'
        : confirmed.length < acted.length
          ? `${acted.length - confirmed.length} action${acted.length - confirmed.length === 1 ? '' : 's'} did not confirm an end state`
          : unattributed.length > 0
            ? `${unattributed.length} action${unattributed.length === 1 ? '' : 's'} could not be attributed to an executor, so what touched your Mac is not recorded`
            : !hasTargetBinding(input.mac)
              ? 'the actions are not bound to an identified app, exact window, and observation'
              : '',
    });
  }

  const gaps = claims.filter(claim => claim.gap).map(claim => claim.gap);
  if (input.mac.evidence?.freshness === 'stale') {
    gaps.push('the newest Mac observation is older than the freshness budget');
  }
  if (input.mac.refusedWhilePaused > 0) {
    gaps.push(`${input.mac.refusedWhilePaused} action${input.mac.refusedWhilePaused === 1 ? ' was' : 's were'} refused while you held control`);
  }

  return {
    complete: claims.length > 0 && claims.every(claim => claim.proven) && gaps.length === 0,
    claims,
    gaps,
    summary: claims.length === 0
      ? 'This task has not produced a result to prove yet.'
      : claims.map(claim => claim.claim).join(' · '),
  };
}
