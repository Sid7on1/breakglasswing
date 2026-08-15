import type { ReviewSnapshot } from './protocol';

/**
 * The one task state the user sees.
 *
 * `04_FRONTEND_PLAN.md` asks the task strip for "plan progress, elapsed time, and one clear state
 * (`working`, `needs you`, `verified`)". `examples/CURRENT_BIMAX_UI.md` records the defect this
 * replaces: model, autonomy, mode, token/context, graph, subagent and verification states all
 * competed near the composer, and a failed verification badge sat far from its evidence.
 *
 * Pure and total: every input combination maps to exactly one state, so the header cannot end up
 * with two truths at once.
 */

export type TaskStateName = 'idle' | 'working' | 'needs-you' | 'failed' | 'verified';

export interface TaskProgress {
  done: number;
  total: number;
}

export interface TaskStateView {
  state: TaskStateName;
  /** Short label for the header pill. */
  label: string;
  /** One sentence of plain language. Never internal vocabulary. */
  detail: string;
  progress: TaskProgress | null;
  /** True when the primary control should offer to stop the run. */
  interruptible: boolean;
}

export interface TaskStateInput {
  /** An approval/question modal is open — the run cannot advance without the user. */
  awaitingReply: boolean;
  /** The engine's spinner is in a non-idle state. */
  busy: boolean;
  streaming: boolean;
  review: ReviewSnapshot | null;
  todos: { content?: string; status?: string }[];
  /** True while the user holds the Mac; the agent is deliberately not acting. */
  macPaused: boolean;
  /** Any conversation content exists in this thread. */
  hasContent: boolean;
}

function progressOf(input: TaskStateInput): TaskProgress | null {
  const todos = input.review?.todos?.length ? input.review.todos : input.todos;
  if (!todos || todos.length === 0) return null;
  const done = todos.filter(todo => todo.status === 'completed').length;
  return { done, total: todos.length };
}

/**
 * Order matters and encodes the product's honesty rules:
 *
 *  - anything waiting on the human outranks "working", because a run that looks busy while it is
 *    actually blocked is the state users misread as progress;
 *  - a failed verification outranks a finished turn — the earlier UI showed "idle" beside a red
 *    badge in a different corner;
 *  - `verified` is claimed only when the engine's own review state says so, never because a turn
 *    ended without an error.
 */
export function deriveTaskState(input: TaskStateInput): TaskStateView {
  const progress = progressOf(input);
  const reviewState = input.review?.state;

  if (input.macPaused) {
    return {
      state: 'needs-you',
      label: 'You have control',
      detail: 'Bimax has stopped acting on your Mac. Resume when you are ready.',
      progress,
      interruptible: false,
    };
  }
  if (input.awaitingReply || reviewState === 'awaiting_approval') {
    return {
      state: 'needs-you',
      label: 'Needs you',
      detail: input.review?.nextAction || 'Bimax is waiting for your decision.',
      progress,
      interruptible: false,
    };
  }
  if (input.busy || input.streaming) {
    return {
      state: 'working',
      label: 'Working',
      detail: progress
        ? `Step ${Math.min(progress.done + 1, progress.total)} of ${progress.total}.`
        : 'Bimax is working on this task.',
      progress,
      interruptible: true,
    };
  }
  if (reviewState === 'verification_failed') {
    return {
      state: 'failed',
      label: 'Check failed',
      detail: input.review?.nextAction || 'A verification command failed. The evidence is in Changes.',
      progress,
      interruptible: false,
    };
  }
  if (reviewState === 'verified' || reviewState === 'checkpointed') {
    return {
      state: 'verified',
      label: 'Verified',
      detail: input.review?.nextAction || 'Changes were applied and the checks passed.',
      progress,
      interruptible: false,
    };
  }
  if (reviewState === 'unverified' || reviewState === 'applying' || reviewState === 'planning') {
    return {
      state: 'working',
      label: 'In progress',
      detail: input.review?.nextAction || 'Changes are being prepared.',
      progress,
      interruptible: false,
    };
  }
  return {
    state: 'idle',
    label: input.hasContent ? 'Ready' : 'New task',
    detail: input.hasContent ? 'Waiting for your next instruction.' : 'Describe what you want Bimax to do.',
    progress,
    interruptible: false,
  };
}
