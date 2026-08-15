/**
 * Task-owned cursor, trajectory and replay policy.
 *
 * The authority and lifecycle rules that have to hold *before* any native product operation is
 * advertised (Phase 8 slice 6, `docs/BIMAX_CU_PORTING_LEDGER.md`). Three things live here and they
 * are all refusals rather than features:
 *
 *   1. **Nothing is offered that the service did not measure.** Capabilities arrive from the v1
 *      handshake, where an older service's silence decodes as unsupported and the current one
 *      explicitly reports `cursor: false`. A controller built on those capabilities refuses rather
 *      than degrades — an unadvertised overlay that quietly no-ops is indistinguishable, from the
 *      model's side, from one that worked.
 *   2. **State is isolated by task.** Cursor configuration and recordings belong to the task that
 *      created them; another task cannot read, move or replay them. This is the same containment
 *      the rest of the Mac capability holds, applied to the two pieces of state that outlive a
 *      single operation.
 *   3. **A recording is digests, never content.** Steps carry an operation name, an exact target
 *      and a receipt *digest* — not model text, not pixels, not field values. A trajectory is a
 *      proof that something happened, and a proof does not need to contain what was typed.
 *
 * ## Why replay validates immediately before each step
 *
 * A recording is a claim about a world that has since moved on: windows close, generations bump,
 * receipts stop matching. Validating the whole recording up front and then executing it would act
 * on a world that was true when the check ran, which is exactly the stale-frame class of bug this
 * capability has hit before. So `validate` runs immediately before the step it guards, and the
 * first refusal stops the replay with the index it stopped at — no partial best-effort.
 *
 * Live execution additionally requires *both* explicit approval and an injected executor. Neither
 * alone is enough: approval without an executor is a request nobody can perform, and an executor
 * without approval is this module deciding on the user's behalf that physical input is fine.
 *
 * Recovered 2026-08-16. The implementation was lost in the object-store corruption behind
 * `f7caa05`, which left its test and its ledger entry intact; this file is rebuilt from those two,
 * and `computer.native.product.features.test.ts` is the contract it has to satisfy.
 */

/** What the native service actually reported it can do. Absent means unsupported, never "maybe". */
export interface NativeProductCapabilities {
  cursorOverlay: boolean;
  trajectory: boolean;
  video: boolean;
  /** Which replay modes the service will honour. An empty list refuses every replay. */
  replayModes: readonly string[];
}

export type ReplayMode = 'dry_run' | 'validate' | 'live';

export interface CursorConfiguration {
  enabled: boolean;
  /** Presentation only. `ring` is the default because it never occludes what it points at. */
  style?: 'ring' | 'dot' | 'crosshair';
}

export interface CursorState {
  enabled: boolean;
  style: 'ring' | 'dot' | 'crosshair';
  updatedAt: number;
}

export interface CursorPosition {
  x: number;
  y: number;
  /** The process the overlay is tracking. Part of the state, so a stale PID cannot be reused. */
  targetPid: number;
}

export interface CursorPlacement extends CursorPosition {
  updatedAt: number;
}

/** An exact target, in the same terms the rest of the capability uses. */
export interface TrajectoryTarget {
  pid: number;
  windowId?: number;
  windowGeneration?: number;
}

export interface TrajectoryStepInput {
  operation: string;
  target: TrajectoryTarget;
  /** A digest of the action receipt — never the receipt, and never its contents. */
  receiptDigest: string;
}

export interface TrajectoryStep extends TrajectoryStepInput {
  index: number;
  at: number;
}

export interface TrajectoryRecording {
  recordingId: string;
  /** The task that owns this recording. Replay by anyone else is refused. */
  sessionId: string;
  steps: TrajectoryStep[];
  startedAt: number;
  stoppedAt: number;
  /** True when steps were dropped at the cap — a truncated recording may never be replayed. */
  truncated: boolean;
}

export interface ReplayHooks {
  /** Runs immediately before its own step. Returning false stops the replay at that index. */
  validate: (step: TrajectoryStep) => boolean | Promise<boolean>;
  /** Required for `live`, ignored otherwise. */
  execute?: (step: TrajectoryStep) => void | Promise<void>;
  /** Explicit approval for physical execution. */
  approvedLive?: boolean;
}

export interface ReplayReceipt {
  outcome: 'validated' | 'performed' | 'refused';
  mode: ReplayMode;
  recordingId: string;
  validatedSteps: number;
  executedSteps: number;
  /** Set when the replay stopped early; the index of the step that refused. */
  stoppedAtStep?: number;
  reason?: string;
}

/**
 * The recording cap.
 *
 * A bound rather than a policy question: an unbounded recording is an unbounded allocation driven
 * by however long a task runs, and a trajectory that needs more than a thousand steps is not
 * evidence anyone is going to read. Hitting it marks the recording `truncated`, and a truncated
 * recording is refused at replay rather than silently replayed short.
 */
export const MAX_TRAJECTORY_STEPS = 1000;

interface OpenRecording {
  recordingId: string;
  sessionId: string;
  steps: TrajectoryStep[];
  startedAt: number;
  truncated: boolean;
}

export class NativeProductFeatureController {
  private readonly capabilities: NativeProductCapabilities;
  private readonly now: () => number;
  /** Per task. Never a single current value — that is what makes cross-task leakage possible. */
  private readonly cursors = new Map<string, CursorState>();
  private readonly placements = new Map<string, CursorPlacement>();
  private readonly recordings = new Map<string, OpenRecording>();
  private sequence = 0;

  constructor(capabilities: NativeProductCapabilities, now: () => number = Date.now) {
    this.capabilities = capabilities;
    this.now = now;
  }

  /* ---------------------------------------------------------------- cursor */

  configureCursor(sessionId: string, configuration: CursorConfiguration): CursorState {
    if (!this.capabilities.cursorOverlay) throw new Error('cursor_overlay_unavailable');
    const state: CursorState = {
      enabled: configuration.enabled,
      style: configuration.style ?? 'ring',
      updatedAt: this.now(),
    };
    this.cursors.set(sessionId, state);
    // Disabling drops the position too. Keeping it would let a re-enable resume at a point the
    // user never saw it reach, which is a small lie about where the overlay has been.
    if (!configuration.enabled) this.placements.delete(sessionId);
    return state;
  }

  /** The cursor state for this task, or null. Null for a task that never configured one. */
  cursorStatus(sessionId: string): CursorState | null {
    return this.cursors.get(sessionId) ?? null;
  }

  moveCursorOverlay(sessionId: string, position: CursorPosition): CursorPlacement {
    if (!this.capabilities.cursorOverlay) throw new Error('cursor_overlay_unavailable');
    const state = this.cursors.get(sessionId);
    // Not configured and configured-off are the same refusal on purpose: both mean this task has
    // no overlay, and distinguishing them would tell a caller about state it does not own.
    if (!state?.enabled) throw new Error('cursor_overlay_disabled');
    const placement: CursorPlacement = { ...position, updatedAt: this.now() };
    this.placements.set(sessionId, placement);
    return placement;
  }

  cursorPlacement(sessionId: string): CursorPlacement | null {
    return this.placements.get(sessionId) ?? null;
  }

  /* ------------------------------------------------------------ trajectory */

  startTrajectory(sessionId: string): string {
    if (!this.capabilities.trajectory) throw new Error('trajectory_recording_unavailable');
    // Restarting replaces whatever was open. The alternative — refusing — strands a task that
    // crashed mid-recording with no way to record again.
    const recordingId = `trajectory-${sessionId}-${(this.sequence += 1)}`;
    this.recordings.set(sessionId, {
      recordingId,
      sessionId,
      steps: [],
      startedAt: this.now(),
      truncated: false,
    });
    return recordingId;
  }

  appendTrajectoryStep(sessionId: string, step: TrajectoryStepInput): TrajectoryStep | null {
    if (!this.capabilities.trajectory) throw new Error('trajectory_recording_unavailable');
    const open = this.recordings.get(sessionId);
    if (!open) throw new Error('trajectory_not_recording');
    if (open.steps.length >= MAX_TRAJECTORY_STEPS) {
      // Marked, not thrown: the operation itself succeeded and refusing it here would make
      // recording able to fail an action. The recording is what becomes unusable.
      open.truncated = true;
      return null;
    }
    const recorded: TrajectoryStep = {
      operation: step.operation,
      target: { ...step.target },
      receiptDigest: step.receiptDigest,
      index: open.steps.length,
      at: this.now(),
    };
    open.steps.push(recorded);
    return recorded;
  }

  stopTrajectory(sessionId: string): TrajectoryRecording {
    const open = this.recordings.get(sessionId);
    if (!open) throw new Error('trajectory_not_recording');
    this.recordings.delete(sessionId);
    return {
      recordingId: open.recordingId,
      sessionId: open.sessionId,
      steps: open.steps,
      startedAt: open.startedAt,
      stoppedAt: this.now(),
      truncated: open.truncated,
    };
  }

  /* ---------------------------------------------------------------- replay */

  async replay(
    sessionId: string,
    recording: TrajectoryRecording,
    mode: ReplayMode,
    hooks: ReplayHooks,
  ): Promise<ReplayReceipt> {
    // Ownership first, and as a *throw* rather than a refusal receipt: a task asking to replay
    // another task's recording is not a policy outcome to be reported, it is a containment error.
    if (recording.sessionId !== sessionId) throw new Error('trajectory_session_mismatch');
    if (!this.capabilities.replayModes.includes(mode)) throw new Error('replay_mode_unavailable');
    if (recording.truncated) throw new Error('trajectory_recording_truncated');

    const base = { mode, recordingId: recording.recordingId, validatedSteps: 0, executedSteps: 0 };
    const live = mode === 'live';
    if (live && !(hooks.approvedLive && hooks.execute)) {
      return { ...base, outcome: 'refused', reason: 'live_replay_requires_approval_and_executor' };
    }

    let validated = 0;
    let executed = 0;
    for (const step of recording.steps) {
      // Immediately before its own step — see the header. A single up-front pass would authorise
      // this step against a world that was true several operations ago.
      const ok = await hooks.validate(step);
      if (!ok) {
        return {
          ...base,
          outcome: 'refused',
          validatedSteps: validated,
          executedSteps: executed,
          stoppedAtStep: step.index,
          reason: 'step_validation_failed',
        };
      }
      validated += 1;
      if (live && hooks.execute) {
        await hooks.execute(step);
        executed += 1;
      }
    }

    return {
      ...base,
      outcome: live ? 'performed' : 'validated',
      validatedSteps: validated,
      executedSteps: executed,
    };
  }

  /** Drop everything this task owns. Called at task teardown, like every other per-task store. */
  releaseSession(sessionId: string): void {
    this.cursors.delete(sessionId);
    this.placements.delete(sessionId);
    this.recordings.delete(sessionId);
  }
}
