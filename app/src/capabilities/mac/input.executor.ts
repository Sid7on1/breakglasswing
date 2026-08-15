/**
 * The single serialized native-input executor.
 *
 * There is exactly ONE physical mouse and ONE keyboard on a Mac. Two overlapping actions do not run
 * "in parallel" — they interleave into a sequence nobody designed: a mouse-up from action A lands in
 * the middle of action B's drag, and the resulting state is a held button with no owner. So every
 * native input goes through {@link InputExecutor.run}, which is a strict FIFO. Capture, PiP and
 * observation stay concurrent; only input is ordered.
 *
 * The second job is harder and more important: knowing what is currently HELD. A staged selection
 * (`mouse_down` … `mouse_up`) and a drag both leave the physical button down between calls. If the
 * turn is aborted, the app throws, or the user takes over in that gap, the button stays down and
 * every subsequent action on the machine is broken in a way that outlives the process. This class
 * tracks held buttons so a cancel, an error, or a takeover can compute the exact compensating
 * mouse-ups needed to return the desktop to neutral — and it does so as data the caller posts,
 * rather than performing IO itself, so the recovery is testable.
 */

export type HeldButton = 'left' | 'right' | 'middle';

/** A compensating release the caller owes the desktop: post a mouse-up for this button here. */
export interface PendingRelease {
  button: HeldButton;
  /** Where the button went down, which is where the release should be posted from. */
  x: number;
  y: number;
  /** When it went down — a long-held button is the signature of an abandoned gesture. */
  since: number;
}

export class InputExecutor {
  /** Tail of the serialization chain. Always a settled-or-pending promise, never rejected. */
  private tail: Promise<unknown> = Promise.resolve();
  private held = new Map<HeldButton, PendingRelease>();
  private pausedReason: string | null = null;
  private depth = 0;
  private maxDepth = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Run one native input action, strictly after every action queued before it.
   *
   * The chain is advanced with a swallowed rejection so ONE failing action cannot poison the queue —
   * a thrown error must reach its own caller and nobody else's. The caller still sees the real
   * rejection, because that is a different promise from the one the chain waits on.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.depth++;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
    const result = this.tail.then(() => fn());
    this.tail = result.then(
      () => undefined,
      () => undefined,
    ).then(() => { this.depth--; });
    return result;
  }

  /** How many actions are queued or running right now (0 when idle). */
  get queued(): number { return this.depth; }
  /** Deepest the queue has ever been — evidence that serialization was actually exercised. */
  get peakQueued(): number { return this.maxDepth; }

  // ---- held-button bookkeeping ------------------------------------------------------------------

  /** Record that a physical button is now down and will stay down across calls. */
  noteButtonDown(button: HeldButton, x: number, y: number): void {
    this.held.set(button, { button, x, y, since: this.now() });
  }

  /** Record that a button was released normally. */
  noteButtonUp(button: HeldButton): void { this.held.delete(button); }

  /** Buttons currently held, oldest first. Empty when the desktop is in a neutral state. */
  heldButtons(): PendingRelease[] {
    return [...this.held.values()].sort((a, b) => a.since - b.since);
  }

  get hasHeldInput(): boolean { return this.held.size > 0; }

  /**
   * What must be posted to return the desktop to neutral, and clear the record.
   *
   * Clearing is deliberate: this is called on the recovery path, and a release that is computed but
   * never posted must not be re-computed forever. The caller posts these and, if a post fails, the
   * failure is reported — a silent retry loop over a stuck button is worse than saying it is stuck.
   */
  takeReleasePlan(): PendingRelease[] {
    const plan = this.heldButtons();
    this.held.clear();
    return plan;
  }

  // ---- user takeover ----------------------------------------------------------------------------

  /**
   * Pause agent input because the human took control. Returns the releases owed — a takeover in the
   * middle of a drag must not leave the user's own mouse fighting a held button.
   */
  pause(reason: string): PendingRelease[] {
    this.pausedReason = reason;
    return this.takeReleasePlan();
  }

  resume(): void { this.pausedReason = null; }
  get paused(): boolean { return this.pausedReason != null; }
  get pauseReason(): string | null { return this.pausedReason; }

  /** Full reset — session dispose. Returns anything still owed so dispose can settle it. */
  reset(): PendingRelease[] {
    this.pausedReason = null;
    this.depth = 0;
    this.maxDepth = 0;
    this.tail = Promise.resolve();
    return this.takeReleasePlan();
  }
}

/** Buttons whose down/up the executor tracks, keyed by the verb that produces them. */
export function heldButtonFor(button?: string): HeldButton {
  return button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
}
