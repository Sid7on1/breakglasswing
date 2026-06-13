/**
 * ResponseSanitizer — enforces the assistant OUTPUT CONTRACT on raw model text.
 *
 * Some models (notably reasoning models such as minimax) leak their tool-decision
 * deliberation into the visible `content` channel instead of the dedicated
 * `reasoning_content` channel — e.g. "No function call is needed for this
 * response." or "I will now call BashTool.". That text is meta-commentary about
 * tool use, not an answer, and must never reach the user.
 *
 * The cause lives in the model's weights and cannot be fixed from here, so this is
 * a deliberate, single-purpose safety layer sitting *behind* the system prompt
 * (the primary defense). Two properties keep it from being a blunt instrument:
 *
 *   1. It is conservative — only whole lines that are PURELY such filler are
 *      removed, never partial sentences, so a genuine answer survives verbatim.
 *   2. It reports `wasPureFiller` — when a turn collapses to nothing once cleaned,
 *      the agent loop can regenerate that malformed turn instead of silently
 *      showing the user an empty reply. Detection here, correction in the loop.
 */

/** Result of sanitizing one assistant turn. */
export interface SanitizedResponse {
  /** The cleaned, user-safe text (filler removed, blank runs collapsed). */
  text: string;
  /**
   * True when the raw input was non-empty but contained ONLY tool-meta filler,
   * i.e. the turn collapsed to empty after sanitization. Signals the agent loop
   * that the model produced no usable answer and the turn should be regenerated.
   */
  wasPureFiller: boolean;
}

/**
 * Whole-line patterns for leaked tool-meta commentary. Each is anchored to a full
 * line (`^...$` with the multiline flag) and requires an explicit mention of a
 * tool/function call, so ordinary prose that merely talks about functions is left
 * intact. Leading list/quote markers (`-`, `*`, `>`) and indentation are tolerated.
 */
const FILLER_PATTERNS: readonly RegExp[] = [
  // "No function/tool call is needed | required | necessary for this response."
  /^[ \t>*\-]*no (?:function|tool)[ -]?call[s]?(?: (?:is|are|will be|would be|was|were))? (?:needed|required|necessary)\b[^\n]*$/gim,
  // "I will now call | use | invoke | run the X tool/function."
  /^[ \t>*\-]*(?:i(?:'ll| will| am going to)|let me|i'm going to) (?:now )?(?:call|use|invoke|run)\b[^\n]*\b(?:tool|function)[s]?\b[^\n]*$/gim,
  // "There is no need to call a tool", "I don't need to use any tools here."
  /^[ \t>*\-]*(?:there(?:'s| is) no need to|i (?:do not|don't) need to) (?:call|use|invoke|run)\b[^\n]*\b(?:tool|function)[s]?\b[^\n]*$/gim,
];

export class ResponseSanitizer {
  /** Clean one assistant turn and report whether it was nothing but filler. */
  sanitize(raw: string): SanitizedResponse {
    const text = this.stripFiller(raw);
    const wasPureFiller = raw.trim().length > 0 && text.length === 0;
    return { text, wasPureFiller };
  }

  /**
   * Remove whole-line tool-meta filler and collapse the blank runs it leaves
   * behind. Pure text transform — safe to call on any assistant content.
   */
  stripFiller(raw: string): string {
    let out = raw;
    for (const pattern of FILLER_PATTERNS) out = out.replace(pattern, '');
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }
}

/** Shared instance — the sanitizer is stateless, so one is enough. */
export const responseSanitizer = new ResponseSanitizer();
