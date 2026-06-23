import { LlmAdapter } from '../core/llm.adapter';
import { extractJson } from '../core/llm.adapter';
import { Logger } from '../utils';

/**
 * Model-tier routing. Two slots are configured: the LITE model (fast, cheap — the default
 * responder) and the HEAVY coding model. Every turn is handled by LITE unless it's escalated.
 *
 * Hybrid strategy (chosen with the user):
 *  1. A cheap local heuristic short-circuits obvious chat/acks straight to LITE — no LLM round-trip.
 *  2. For anything else, the LITE model itself decides whether to escalate, and if so produces a
 *     one-line task brief. On escalation the HEAVY model receives the user's ORIGINAL prompt with
 *     that brief prepended as context — we never rewrite the user's words (that loses intent).
 */
export type Tier = 'lite' | 'heavy';

export interface RouteDecision {
  tier: Tier;
  /** One-line framing for the heavy model; only set when escalating. */
  brief?: string;
  /** How the decision was reached — for logging / the footer tooltip. */
  via: 'heuristic' | 'classifier' | 'pinned' | 'fallback';
}

// Obvious conversational turns that never need the heavy model. Anchored to the whole (short)
// message so "ok" matches but "ok now refactor the parser" does not.
const CHATTY = /^(hi|hey+|hello|yo|sup|howdy|thanks|thank you|thx|ty|ok|okay|k|cool|nice|great|awesome|got it|gotcha|sure|yep|yeah|yes|no|nope|hmm|lol|wow|same|right)[!.…\s]*$/i;

/**
 * Local, LLM-free pre-filter. Returns a definite tier for obvious cases, or null to mean
 * "not obvious — ask the classifier".
 */
export function heuristicTier(prompt: string): Tier | null {
  const p = prompt.trim();
  if (!p) return 'lite';
  // Short greetings / acknowledgements / filler → lite, no model call.
  if (p.length <= 40 && CHATTY.test(p)) return 'lite';
  return null;
}

const CLASSIFIER_SYSTEM = `You are a fast routing classifier for a coding agent that has two models:
- LITE: quick chat, greetings, simple factual questions, a single small file read or one-line edit, status checks.
- HEAVY: multi-step coding, debugging, refactors, writing or changing real code, architecture, anything needing deep reasoning or several tool calls.
Decide which model should handle the user's message. Prefer LITE unless the task clearly needs HEAVY.
If HEAVY, write a single-sentence task brief that frames what the heavy model must accomplish (do NOT rewrite or expand the user's request — just frame it).
Reply with ONLY a JSON object, no prose: {"tier":"lite"} or {"tier":"heavy","brief":"..."}.`;

/**
 * Decide the tier for a turn. `pinned` (manual override) wins outright. Otherwise the heuristic
 * runs first, then the lite model classifies. Any failure falls back to LITE — the default
 * responder — so routing can never block a turn.
 */
// The classifier is a pre-flight call that runs BEFORE the user sees anything, so it must never be
// the thing that hangs a turn. If the lite model cold-starts, we'd rather just answer with lite than
// make the user wait for the router. Cap it tightly and fall back to lite on timeout.
const CLASSIFIER_TIMEOUT_MS = 6000;

export async function decideTier(llm: LlmAdapter, prompt: string, pinned?: Tier | null): Promise<RouteDecision> {
  if (pinned) return { tier: pinned, via: 'pinned' };

  const h = heuristicTier(prompt);
  if (h) return { tier: h, via: 'heuristic' };

  try {
    const raw = await Promise.race([
      llm.chatCompletion([{ role: 'user', content: prompt }], CLASSIFIER_SYSTEM, { lite: true }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('classifier timeout')), CLASSIFIER_TIMEOUT_MS)),
    ]);
    const parsed = JSON.parse(extractJson(raw) || '{}');
    if (parsed?.tier === 'heavy') {
      const brief = typeof parsed.brief === 'string' && parsed.brief.trim() ? parsed.brief.trim() : undefined;
      return { tier: 'heavy', brief, via: 'classifier' };
    }
    return { tier: 'lite', via: 'classifier' };
  } catch (e: any) {
    Logger.warn(`[ModelRouter] classifier failed (${e?.message}); defaulting to lite.`);
    return { tier: 'lite', via: 'fallback' };
  }
}

/** Prepend the brief as context for the heavy model without altering the user's own words. */
export function applyBrief(prompt: string, brief?: string): string {
  if (!brief) return prompt;
  return `[Routing brief: ${brief}]\n\n${prompt}`;
}
