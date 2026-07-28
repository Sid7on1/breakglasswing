/**
 * Bounded recovery controller for computer use.
 *
 * Turns a stream of per-action verification outcomes into the next control decision, with hard
 * budgets so a stuck agent escalates or stops instead of thrashing forever. This is the explicit
 * "continue / retry / recover / escalate / stop" machine the spec requires, with terminal states
 * that latch — once it decides to stop, it stays stopped.
 */

import { VerificationOutcome } from './verification';

export type RecoveryDecision =
  | 'continue'      // progress was made (or proven) — proceed to the next step
  | 'retry'         // the action failed transiently — try the same action again
  | 'recover'       // the action had no effect / hit the wrong window — take a corrective action
  | 'escalate'      // out of cheap options — ask the human / raise confidence bar
  | 'stop-success'  // the goal is proven complete
  | 'stop-failure'; // budgets exhausted — give up honestly rather than loop

export interface RecoveryBudget {
  /** How many times the SAME failing action may be retried. */
  maxRetries: number;
  /** How many corrective (recover) actions may be taken before giving up. */
  maxRecoveries: number;
  /** How many consecutive no-effect actions before we declare no progress and stop. */
  maxNoProgress: number;
}

export const DEFAULT_RECOVERY_BUDGET: RecoveryBudget = { maxRetries: 2, maxRecoveries: 3, maxNoProgress: 4 };

export class RecoveryController {
  private retries = 0;
  private recoveries = 0;
  private noProgress = 0;
  private terminal: 'stop-success' | 'stop-failure' | null = null;
  readonly log: Array<{ outcome: VerificationOutcome; decision: RecoveryDecision }> = [];

  constructor(private readonly budget: RecoveryBudget = DEFAULT_RECOVERY_BUDGET) {}

  /** Feed the latest verification outcome; get the next control decision. */
  record(outcome: VerificationOutcome): RecoveryDecision {
    const decision = this.decide(outcome);
    this.log.push({ outcome, decision });
    return decision;
  }

  private decide(outcome: VerificationOutcome): RecoveryDecision {
    if (this.terminal) return this.terminal;
    switch (outcome) {
      case 'confirmed':
        this.terminal = 'stop-success';
        return 'stop-success';
      case 'changed':
        // Real progress — reset the transient counters and keep going.
        this.retries = 0; this.noProgress = 0;
        return 'continue';
      case 'failed':
        this.retries++;
        return this.retries > this.budget.maxRetries ? this.recoverOrGiveUp() : 'retry';
      case 'rejected':
        // Repeating an operation the app explicitly rejected (unsupported attachment, invalid
        // format, permission dialog) is not a transient input retry. Change approach immediately.
        return this.recoverOrGiveUp();
      case 'no-change':
        this.noProgress++;
        if (this.noProgress >= this.budget.maxNoProgress) return this.giveUp();
        return this.recoverOrGiveUp();
      case 'expectation-missed':
        this.noProgress++;
        if (this.noProgress >= this.budget.maxNoProgress) return this.giveUp();
        return this.recoverOrGiveUp();
      case 'wrong-window':
        return this.recoverOrGiveUp();
      case 'unverified':
        // Can't prove anything — proceed cautiously; the caller should re-observe. Does not consume
        // a recovery, but a long run of unverified actions still trips no-progress via the caller.
        return 'continue';
    }
    // Exhaustive above; this guards against a future VerificationOutcome added without a case.
    throw new Error(`unhandled verification outcome: ${outcome as string}`);
  }

  private recoverOrGiveUp(): RecoveryDecision {
    this.recoveries++;
    if (this.recoveries > this.budget.maxRecoveries) return this.giveUp();
    // After exhausting retries specifically, prefer escalation over another blind recovery.
    return this.retries > this.budget.maxRetries ? 'escalate' : 'recover';
  }

  private giveUp(): RecoveryDecision {
    this.terminal = 'stop-failure';
    return 'stop-failure';
  }

  get done(): boolean { return this.terminal != null; }
  get succeeded(): boolean { return this.terminal === 'stop-success'; }
  get counters(): { retries: number; recoveries: number; noProgress: number } {
    return { retries: this.retries, recoveries: this.recoveries, noProgress: this.noProgress };
  }

  reset(): void {
    this.retries = 0; this.recoveries = 0; this.noProgress = 0; this.terminal = null; this.log.length = 0;
  }
}
