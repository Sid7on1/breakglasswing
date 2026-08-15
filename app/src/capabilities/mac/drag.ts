/**
 * Drag-and-drop as an EXPLICIT state machine.
 *
 * A drag is the most failure-prone compound gesture: the button can go down on the wrong element,
 * the destination can scroll away mid-drag, and — worst of all — an aborted drag can leave the
 * desktop with a physically-held mouse button, wedging every subsequent action. Reducing it to one
 * opaque helper call hides all of that. This machine makes each phase a named, ordered state with
 * verification hooks and, critically, tracks whether the physical button is currently down so a
 * cancel can be told to RELEASE it rather than leaving the pointer stuck.
 *
 * It performs no IO — the runtime drives it, calling a phase method for each real driver step and
 * feeding back the verification result. Illegal transitions throw, so a mis-sequenced drag is a
 * programming error caught in tests, not a stuck button on the user's screen.
 */

import { Point } from './coordinates';

export type DragPhase =
  | 'idle'
  | 'source-located'
  | 'source-verified'
  | 'mouse-down'
  | 'dragging'
  | 'destination-located'
  | 'destination-verified'
  | 'mouse-up'
  | 'verified'
  | 'cancelled'
  | 'failed';

export interface DragTraceEntry { phase: DragPhase; at: number; note?: string }

/** Legal successors for each phase. Empty = terminal. */
const NEXT: Record<DragPhase, DragPhase[]> = {
  idle: ['source-located', 'cancelled'],
  'source-located': ['source-verified', 'failed', 'cancelled'],
  'source-verified': ['mouse-down', 'cancelled'],
  'mouse-down': ['dragging', 'cancelled'],
  dragging: ['dragging', 'destination-located', 'cancelled'],
  'destination-located': ['destination-verified', 'failed', 'cancelled'],
  'destination-verified': ['mouse-up', 'cancelled'],
  'mouse-up': ['verified', 'failed'],
  verified: [],
  cancelled: [],
  failed: [],
};

/** Phases in which a physical mouse button is being held and MUST be released on cancel. */
const BUTTON_HELD: ReadonlySet<DragPhase> = new Set<DragPhase>(['mouse-down', 'dragging', 'destination-located', 'destination-verified']);

export class DragMachine {
  phase: DragPhase = 'idle';
  readonly trace: DragTraceEntry[] = [];
  /** Set on cancel: true when the pointer button was still down and the caller owes a mouse-up. */
  releaseOwed = false;

  constructor(readonly from: Point, readonly to: Point, private readonly now: () => number = Date.now) {
    this.trace.push({ phase: 'idle', at: this.now() });
  }

  private go(next: DragPhase, note?: string): this {
    if (!NEXT[this.phase].includes(next)) {
      throw new Error(`illegal drag transition ${this.phase} → ${next}`);
    }
    this.phase = next;
    this.trace.push({ phase: next, at: this.now(), note });
    return this;
  }

  /** True while a physical button is down (so a cancel knows it must post a mouse-up). */
  get pointerDown(): boolean { return BUTTON_HELD.has(this.phase); }
  get done(): boolean { return this.phase === 'verified' || this.phase === 'cancelled' || this.phase === 'failed'; }
  get ok(): boolean { return this.phase === 'verified'; }

  locateSource(note?: string): this { return this.go('source-located', note); }
  verifySource(ok: boolean, note?: string): this { return ok ? this.go('source-verified', note) : this.go('failed', note ?? 'source not where expected'); }
  mouseDown(note?: string): this { return this.go('mouse-down', note); }
  startDrag(note?: string): this { return this.go('dragging', note); }
  /** Record passing through intermediate points (stays in `dragging`). */
  moveThrough(points: Point[], note?: string): this { return this.go('dragging', note ?? `moved through ${points.length} intermediate point(s)`); }
  locateDestination(note?: string): this { return this.go('destination-located', note); }
  verifyDestination(ok: boolean, note?: string): this { return ok ? this.go('destination-verified', note) : this.go('failed', note ?? 'destination not where expected'); }
  mouseUp(note?: string): this { return this.go('mouse-up', note); }
  verifyResult(ok: boolean, note?: string): this { return ok ? this.go('verified', note) : this.go('failed', note ?? 'drop did not produce the expected result'); }

  /**
   * Abort the drag. Records whether the physical button was still down (`releaseOwed`) so the caller
   * can post the compensating mouse-up — the single most important safety property here.
   */
  cancel(note?: string): this {
    this.releaseOwed = this.pointerDown;
    return this.go('cancelled', note ?? 'drag cancelled');
  }
}
