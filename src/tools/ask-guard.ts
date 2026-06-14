/**
 * Detects a degenerate / gratuitous AskUserTool call before it pauses the session.
 *
 * Weaker models (notably the default NVIDIA llama-70b) reach for AskUserTool as a conversational
 * reflex — they fire it for greetings ("hi"), identity questions ("who are you?"), or routine
 * confirmations, instead of just answering in text. Observed failures:
 *   - question="I", no valid options  → renders as a useless `Ask(I)` prompt, then the model
 *     answers anyway after the user is forced to click through.
 *   - a single trivial option (e.g. ["Continue"]) → not a real either/or decision at all.
 * The system prompt already forbids this, but the model ignores it, so we enforce it in code.
 *
 * A genuine "decision the user must make" inherently has a clear question AND at least two
 * distinct, real options. When either is missing the call is degenerate: we refuse it and steer
 * the model to answer the user directly instead of blocking on a pointless prompt.
 *
 * The rule is deliberately conservative so it never blocks a real clarifying question: it only
 * fires when the question is empty/garbage, or there are fewer than two distinct options.
 *
 * @returns a human-readable reason string when the Ask is degenerate, or `null` when it's valid.
 */
export function detectDegenerateAsk(question: unknown, options: unknown): string | null {
  // (a) A real decision needs at least two distinct, non-empty choices. A missing options array,
  // or one with fewer than two real options, means the model isn't actually offering a choice.
  const distinct = Array.isArray(options)
    ? Array.from(
        new Set(
          options
            .map(o => (typeof o === 'string' ? o.trim() : String(o ?? '').trim()))
            .filter(o => o.length > 0)
            .map(o => o.toLowerCase()),
        ),
      )
    : [];
  if (distinct.length < 2) {
    return `a real user decision needs at least 2 distinct options, but this call provided ${distinct.length}`;
  }

  // (b) A garbage/empty question (e.g. "I", "", "?") is never a real prompt — the model is using
  // AskUserTool as a conversational placeholder.
  const q = typeof question === 'string' ? question.trim() : '';
  if (q.length < 3 || !/[a-z]/i.test(q)) {
    return `the question text is empty or not a real question ("${q}")`;
  }

  return null;
}
