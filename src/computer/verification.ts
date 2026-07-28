/**
 * Action verification for computer use.
 *
 * The cardinal rule the spec demands: DO NOT continue merely because the input driver returned
 * success. A CGEvent posts fine and still lands on nothing; a click on a disabled control "succeeds"
 * and changes nothing. So every important action is judged not by the driver's return value but by
 * whether the SCREEN actually changed the way we expected — a fresh post-action frame compared to
 * the frame just before it, plus window identity and any semantic query the caller asked us to
 * confirm. This module is the pure classifier; the runtime feeds it the before/after facts.
 */

/** Value-safe app-name compare (local copy to avoid a cycle with desktop.runtime). */
function sameApp(a?: string, b?: string): boolean {
  if (!a || !b) return true; // unknown on either side → cannot prove a mismatch
  const clean = (s: string) => s.trim().toLowerCase().replace(/\.app$/, '');
  return clean(a) === clean(b);
}

export type VerificationOutcome =
  | 'confirmed'    // a specific expectation was proven (semantic query matched)
  | 'changed'      // the screen visibly changed (the action had an effect)
  | 'rejected'     // input landed, but the application visibly rejected the requested operation
  | 'no-change'    // the post-action frame is identical to the pre-action frame — no visible effect
  | 'expectation-missed' // pixels may have changed, but an explicit semantic postcondition did not
  | 'wrong-window' // the app/window in front is not the one we targeted (focus stolen / wrong target)
  | 'unverified'   // the action landed but there is no fresh screenshot to prove the outcome
  | 'failed';      // the driver itself reported failure

export interface VerificationResult {
  outcome: VerificationOutcome;
  frameChanged: boolean;
  windowStable: boolean;
  queryMatched?: boolean;
  note: string;
}

export interface VerificationInput {
  /** Did the driver report success? */
  ok: boolean;
  /** Pixel digest of the frame captured just BEFORE the action (undefined for the first frame). */
  prevFrameHash?: string;
  /** Pixel digest of the fresh frame captured AFTER the action. */
  nextFrameHash?: string;
  /** Whether a post-action screenshot was actually captured. */
  hadScreenshot: boolean;
  /** The app we intended to act on, and the app actually observed. */
  expectedApp?: string;
  actualApp?: string;
  /** The window we targeted, and the window actually observed. */
  targetWindowId?: number;
  actualWindowId?: number;
  /** Result of a semantic verification query, when the caller supplied one. */
  queryMatched?: boolean;
  /** True only when queryMatched is a required postcondition rather than an optional observation. */
  queryRequired?: boolean;
  /** Explicit failure text visible in the fresh application frame (normally a dialog/toast).
   * This is stronger than a pixel change: an app saying it could not send/save/open something is
   * proof the requested operation failed even though the click itself was delivered perfectly. */
  observedFailure?: string;
}

/**
 * Classify what actually happened. Ordering matters: a hard driver failure or a focus theft is
 * reported before any pixel reasoning, a proven semantic match is the strongest positive, and only
 * then do we fall back to frame diffing (identical frame ⇒ the action did nothing).
 */
export function classifyVerification(i: VerificationInput): VerificationResult {
  const windowStable = (i.targetWindowId == null || i.actualWindowId == null || i.targetWindowId === i.actualWindowId)
    && sameApp(i.expectedApp, i.actualApp);

  if (!i.ok) {
    return { outcome: 'failed', frameChanged: false, windowStable, note: 'driver reported the action failed' };
  }
  if (i.expectedApp && i.actualApp && !sameApp(i.expectedApp, i.actualApp)) {
    return { outcome: 'wrong-window', frameChanged: false, windowStable: false, note: `expected ${i.expectedApp} in front but observed ${i.actualApp}` };
  }
  if (i.targetWindowId != null && i.actualWindowId != null && i.targetWindowId !== i.actualWindowId) {
    return { outcome: 'wrong-window', frameChanged: false, windowStable: false, note: `expected window ${i.targetWindowId} but observed ${i.actualWindowId}` };
  }
  if (i.observedFailure) {
    return {
      outcome: 'rejected',
      frameChanged: i.prevFrameHash != null && i.nextFrameHash != null && i.nextFrameHash !== i.prevFrameHash,
      windowStable,
      note: `application visibly rejected the operation: ${i.observedFailure}`,
    };
  }
  if (!i.hadScreenshot || i.nextFrameHash == null) {
    return { outcome: 'unverified', frameChanged: false, windowStable, note: 'action landed but no fresh screenshot was captured to prove the outcome' };
  }
  if (i.queryMatched === true) {
    return { outcome: 'confirmed', frameChanged: i.prevFrameHash != null && i.nextFrameHash !== i.prevFrameHash, windowStable, queryMatched: true, note: 'verification query matched concrete on-screen text' };
  }
  if (i.queryRequired && i.queryMatched === false) {
    return {
      outcome: 'expectation-missed',
      frameChanged: i.prevFrameHash != null && i.nextFrameHash !== i.prevFrameHash,
      windowStable,
      queryMatched: false,
      note: 'the screen was captured, but the required semantic postcondition was not satisfied',
    };
  }
  if (i.prevFrameHash != null && i.nextFrameHash === i.prevFrameHash) {
    return { outcome: 'no-change', frameChanged: false, windowStable, queryMatched: i.queryMatched, note: 'the screen is pixel-identical to before the action — it had no visible effect' };
  }
  if (i.prevFrameHash != null) {
    return { outcome: 'changed', frameChanged: true, windowStable, queryMatched: i.queryMatched, note: 'the screen changed after the action' };
  }
  // No baseline frame to diff against (first capture): a fresh screen exists but we can't call it a
  // change or a no-op.
  return { outcome: 'changed', frameChanged: false, windowStable, note: 'fresh screen captured (no prior frame to diff against)' };
}

/**
 * ActionResult — the honest per-action outcome contract.
 *
 * Pixel difference is SUPPORTING evidence, never proof of task success. This shape separates the
 * facts so callers (and the model) cannot conflate them:
 *   - delivered:      the driver accepted and delivered the input (says nothing about effect)
 *   - observed:       what the fresh post-action evidence showed (pixel/window level)
 *   - postcondition:  the semantic check result, when the caller supplied one (the only path to
 *                     `confidence: 'proven'`)
 *   - confidence:     'proven' (semantic postcondition matched) | 'likely' (screen visibly changed
 *                     in the expected window) | 'unknown' (delivered, but nothing proves an effect —
 *                     including a pixel-identical screen, which is NOT a failure: many successful
 *                     actions are visually static)
 *   - failureReason:  set only for genuine failures (driver error, wrong window)
 */
export interface ActionResult {
  delivered: boolean;
  observed: VerificationOutcome;
  postcondition?: { query: string; matched: boolean };
  confidence: 'proven' | 'likely' | 'unknown';
  failureReason?: string;
}

/** Derive the ActionResult contract from a verification classification. */
export function toActionResult(
  v: VerificationResult,
  postcondition?: { query: string; matched: boolean },
): ActionResult {
  const delivered = v.outcome !== 'failed';
  const confidence: ActionResult['confidence'] =
    (postcondition?.matched || v.outcome === 'confirmed') ? 'proven'
      : (v.outcome === 'changed' && v.windowStable && v.frameChanged) ? 'likely'
        : 'unknown';
  const failureReason = v.outcome === 'failed' || v.outcome === 'rejected' || v.outcome === 'wrong-window' ? v.note : undefined;
  return { delivered, observed: v.outcome, ...(postcondition ? { postcondition } : {}), confidence, ...(failureReason ? { failureReason } : {}) };
}

/** Normalize text for a clipboard/copy comparison — trims and collapses whitespace, ignores case. */
function normalizeClip(s: string): string { return s.replace(/\s+/g, ' ').trim().toLowerCase(); }

/**
 * Clipboard/copy verification: did a copy actually place the expected text on the clipboard? Exact
 * (normalized) match or a containment match both count, so "copy this sentence" verifies even when
 * the selection grabbed trailing whitespace or a surrounding node.
 */
export function verifyClipboard(expected: string, actual: string): { ok: boolean; note: string } {
  const e = normalizeClip(expected), a = normalizeClip(actual);
  if (!e) return { ok: false, note: 'nothing expected to verify' };
  if (a === e) return { ok: true, note: 'clipboard exactly matches the expected text' };
  if (a.includes(e) || e.includes(a)) return { ok: true, note: 'clipboard contains the expected text' };
  return { ok: false, note: `clipboard does not contain the expected text (got ${actual.length} chars)` };
}
