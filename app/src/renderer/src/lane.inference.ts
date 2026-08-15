/**
 * Which lane is this request?
 *
 * `04_FRONTEND_PLAN.md`: "One composer across modes. The app infers the lane from the request and
 * shows a visible chip: `Code` or `Control Mac`. The user can correct it before execution."
 *
 * The inference is deliberately conservative and explainable:
 *
 *  - `Code` is the default. Getting this wrong costs nothing — a coding task that was really a Mac
 *    task simply asks for permissions when it needs them.
 *  - `Control Mac` is claimed only when the request names operating something outside the project.
 *    Getting THIS wrong costs the user a permission prompt they did not need, which is the exact
 *    friction `03_PRODUCT_EXAMPLES.md` cites Raycast for avoiding: "ask for Accessibility when a
 *    user starts a CU task, not when they only want to code."
 *
 * The chip always shows a `why`, so a wrong guess is visibly a guess and one click from corrected.
 */

export type TaskLane = 'code' | 'mac';

export interface LaneInference {
  lane: TaskLane;
  /** 'inferred' until the user overrides it, then 'chosen'. */
  source: 'inferred' | 'chosen';
  /** Plain-language reason, shown on the chip's tooltip. */
  why: string;
}

/** Verbs that only make sense against a running app's interface. */
const CONTROL_VERBS = /\b(click|double-click|tap|press|type into|drag|scroll|hover|select the|choose the|open the app|switch to|bring up|focus the|quit|close the window|take a screenshot|screenshot of)\b/i;

/** Named surfaces that are outside the project by definition. */
const MAC_SURFACES = /\b(system settings|system preferences|finder|calculator|messages|imessage|mail app|calendar app|notes app|safari|preview|activity monitor|menu ?bar|dock|desktop|notification centre|notification center|control cent(?:re|er))\b/i;

/** "in <App>" / "on my mac" style targeting of something that is not the repository. */
const OPERATE_TARGET = /\b(control (?:my|the) mac|on (?:my|the) (?:mac|screen|desktop)|in the (?:app|window)|another app|the app window)\b/i;

/** Coding vocabulary strong enough to keep an otherwise ambiguous request in the code lane. */
const CODE_SIGNALS = /\b(refactor|test|tests|typecheck|compile|build|lint|commit|branch|merge|diff|function|class|module|dependency|package\.json|import|export|bug|stack trace|api|endpoint|migration|schema|repo|repository|codebase)\b/i;

export function inferLane(request: string): LaneInference {
  const text = (request || '').trim();
  if (!text) return { lane: 'code', source: 'inferred', why: 'Bimax works on this project unless you ask it to operate an app.' };

  const surface = MAC_SURFACES.exec(text);
  const verb = CONTROL_VERBS.exec(text);
  const target = OPERATE_TARGET.exec(text);
  const code = CODE_SIGNALS.test(text);

  // A named Mac surface is the strongest signal, and it survives coding vocabulary: "take a
  // screenshot of System Settings and file a bug" really is a Mac task with a coding follow-up.
  if (surface) {
    return { lane: 'mac', source: 'inferred', why: `This mentions ${surface[0]}, which is an app on your Mac rather than this project.` };
  }
  // A control verb aimed at something outside the project. Coding vocabulary outweighs a bare verb,
  // because "click" appears constantly in front-end work that never leaves the editor.
  if ((verb || target) && !code) {
    return {
      lane: 'mac',
      source: 'inferred',
      why: `This asks Bimax to ${(verb?.[0] ?? target?.[0] ?? 'operate something').toLowerCase()}, which means operating an app on your Mac.`,
    };
  }
  return {
    lane: 'code',
    source: 'inferred',
    why: code
      ? 'This reads like work on the code in this project.'
      : 'Bimax works on this project unless you ask it to operate an app.',
  };
}

export const LANE_LABEL: Record<TaskLane, string> = {
  code: 'Code',
  mac: 'Control Mac',
};

/**
 * Does this submission need the contextual Trust Center first?
 *
 * Code tasks enter immediately — that is the rule the whole permission model rests on. A Control
 * Mac task is held only when Computer Use is actually blocked; a granted machine goes straight
 * through, because a permission sheet in front of a working capability is pure friction.
 */
export function needsTrustCenterBeforeRun(
  lane: TaskLane,
  computerUse: { available: boolean } | null,
): boolean {
  if (lane !== 'mac') return false;
  // An unread report is not a grant. Holding here is the fail-closed direction, and the sheet
  // itself explains what is unknown.
  return !computerUse || !computerUse.available;
}
