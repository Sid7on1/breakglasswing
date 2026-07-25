/**
 * Target-switch transaction for computer use.
 *
 * Switching which app the agent drives is not one call — it is a sequence with a dangerous middle.
 * Between "we decided to drive Finder" and "Finder is frontmost, its window is confirmed, and we
 * hold a frame of it", there is a window of time in which the OLD app's coordinates are still the
 * newest thing the runtime knows. An action delivered in that gap lands on the previous app while
 * every log line says the switch succeeded.
 *
 * So the switch is modelled as an explicit transaction with ordered phases and a hard rule: input
 * is frozen at the very first phase and only released once a frame carrying the NEW target's
 * identity has been acquired. Illegal orderings throw, which makes a mis-sequenced switch a test
 * failure rather than a click in the wrong app.
 *
 * The machine performs no IO. The runtime drives it, calling one method per real step, so the
 * ordering guarantee is testable without a Mac attached.
 */

/** Stable identity of a switch target. Deliberately more than a name — titles change under you. */
export interface TargetIdentity {
  app: string;
  pid: number;
  bundleId?: string;
  windowId?: number;
  windowRole?: string;
  windowSubrole?: string;
  windowTitle?: string;
  windowBounds?: { x: number; y: number; w: number; h: number };
  displayId?: number;
}

export type SwitchPhase =
  | 'idle'
  | 'resolved'             // we know which app/window we intend to drive
  | 'input-frozen'         // no further input may be delivered to the OLD target
  | 'activating'           // activation requested
  | 'frontmost-confirmed'  // the OS agrees the intended app is frontmost
  | 'window-confirmed'     // the intended WINDOW (not just the app) is identified
  | 'capture-switched'     // PiP/capture now points at the new target
  | 'frame-acquired'       // a frame carrying the new identity exists
  | 'committed'            // input may resume, against the new target
  | 'aborted';

const NEXT: Record<SwitchPhase, SwitchPhase[]> = {
  idle: ['resolved', 'aborted'],
  resolved: ['input-frozen', 'aborted'],
  'input-frozen': ['activating', 'aborted'],
  activating: ['frontmost-confirmed', 'aborted'],
  // Activation can be reported as succeeded while another app remains genuinely in front. That is a
  // warning, not a lie we paper over — the transaction still proceeds so the caller can capture and
  // report it, but the phase is recorded so a later failure is attributable.
  'frontmost-confirmed': ['window-confirmed', 'aborted'],
  'window-confirmed': ['capture-switched', 'frame-acquired', 'aborted'],
  'capture-switched': ['frame-acquired', 'aborted'],
  'frame-acquired': ['committed', 'aborted'],
  committed: [],
  aborted: [],
};

export interface SwitchTraceEntry { phase: SwitchPhase; at: number; note?: string }

export class TargetSwitch {
  phase: SwitchPhase = 'idle';
  readonly trace: SwitchTraceEntry[] = [];
  /** Set when activation was requested but another app was still positively in front. */
  frontmostWarning?: string;
  /** True while the transaction owns input — the runtime must deliver nothing during this span. */
  private frozen = false;
  private readonly startedAt: number;

  constructor(
    readonly from: TargetIdentity | null,
    readonly to: TargetIdentity,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = this.now();
    this.trace.push({ phase: 'idle', at: this.startedAt });
  }

  private go(next: SwitchPhase, note?: string): this {
    if (!NEXT[this.phase].includes(next)) {
      throw new Error(`illegal target-switch transition ${this.phase} → ${next}`);
    }
    this.phase = next;
    this.trace.push({ phase: next, at: this.now(), note });
    return this;
  }

  resolve(note?: string): this { return this.go('resolved', note); }

  /**
   * Freeze input. Everything after this point until {@link commit} must deliver nothing — this is
   * the guarantee that no click reaches the previous app once the switch has begun.
   */
  freezeInput(note?: string): this { this.frozen = true; return this.go('input-frozen', note); }

  activate(note?: string): this { return this.go('activating', note); }

  /** `warning` is set when another app is positively still frontmost — recorded, never hidden. */
  confirmFrontmost(warning?: string): this {
    this.frontmostWarning = warning;
    return this.go('frontmost-confirmed', warning ?? 'target app is frontmost');
  }

  confirmWindow(windowId?: number): this {
    return this.go('window-confirmed', windowId ? `window ${windowId}` : 'no window id available');
  }

  switchCapture(note?: string): this { return this.go('capture-switched', note); }
  acquireFrame(frameId?: string): this { return this.go('frame-acquired', frameId ? `frame ${frameId}` : 'frame acquired'); }

  /**
   * Release input against the NEW target. Only legal once a frame of it exists.
   *
   * The unfreeze happens AFTER the transition is validated, never before: an illegal commit must
   * leave input frozen. Doing it the other way round meant a rejected commit still released the
   * lock, which is precisely the state this class exists to make unreachable.
   */
  commit(note?: string): this { this.go('committed', note); this.frozen = false; return this; }

  abort(reason: string): this { this.go('aborted', reason); this.frozen = false; return this; }

  /** May input be delivered right now? False for the whole dangerous middle of the transaction. */
  get inputAllowed(): boolean { return !this.frozen; }
  get done(): boolean { return this.phase === 'committed' || this.phase === 'aborted'; }
  get ok(): boolean { return this.phase === 'committed'; }

  /** Wall-clock duration so far — what the p95 switch-latency target is measured against. */
  get elapsedMs(): number { return this.now() - this.startedAt; }

  /** Per-phase durations, for attributing a slow switch to the step that actually cost the time. */
  phaseDurations(): Array<{ phase: SwitchPhase; ms: number }> {
    const out: Array<{ phase: SwitchPhase; ms: number }> = [];
    for (let i = 1; i < this.trace.length; i++) {
      out.push({ phase: this.trace[i].phase, ms: this.trace[i].at - this.trace[i - 1].at });
    }
    return out;
  }

  /** Did the target actually change, or is this a re-focus of the app already being driven? */
  get isRealSwitch(): boolean {
    return !this.from || this.from.pid !== this.to.pid || this.from.windowId !== this.to.windowId;
  }
}

/**
 * Rolling record of switch latencies, so "PiP switches within 250 ms at p95" is a measured claim
 * rather than an assertion. Bounded so a long session cannot grow it without limit.
 */
export class SwitchLatencyLog {
  private samples: number[] = [];
  constructor(private readonly capacity = 200) {}

  record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get count(): number { return this.samples.length; }

  /** Nearest-rank percentile (p in 0..1). Returns null with no samples — never a fabricated 0. */
  percentile(p: number): number | null {
    if (!this.samples.length) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[rank];
  }

  summary(): { count: number; p50: number | null; p95: number | null; worst: number | null } {
    return {
      count: this.samples.length,
      p50: this.percentile(0.5),
      p95: this.percentile(0.95),
      worst: this.samples.length ? Math.max(...this.samples) : null,
    };
  }

  reset(): void { this.samples = []; }
}
