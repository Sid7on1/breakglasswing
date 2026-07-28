// Curated model catalog for the /model picker. IDs follow the NVIDIA NIM `publisher/model` convention
// (the default provider). If your provider names a model differently, use the "Custom model id…" entry.
// `tier` groups them for the picker: 'coding' = strong agentic/coding models, 'lite' = fast/cheap ones.

import { capabilitiesFor } from '../core/capabilities';

export interface ModelEntry {
  label: string;
  value: string;
  desc: string;
  tier: 'coding' | 'vision' | 'lite' | 'other';
  /**
   * Never pick this model AUTOMATICALLY (self-healing a stale pin). The user can still choose it
   * explicitly from the picker — this only bars the machine from choosing it on their behalf.
   * Set on every entry whose own description records a disqualifying behaviour: times out, needs a
   * long cold start, or cannot call tools. Auto-selecting one of those trades a visibly broken
   * model for an invisibly hanging one, which is a worse failure because it looks like a freeze.
   */
  avoidAutoSelect?: boolean;
}

// Every recommended NIM id below was probed LIVE on 2026-07-19 ("hi" + a tool call + a vision
// call): qwen3.5 397b/122b answered fast with working tools AND working vision and no hidden
// reasoning phase; gpt-oss-120b answered in ~2s (native reasoning channel, honors
// reasoning_effort); mistral-small-4 answered in ~1s with tools + vision. Models that did NOT
// respond for a free NIM account that day: kimi-k2.6 / gemma-3 (404 — not enabled for the
// account), llama-3.3-70b / llama-4-maverick (90s+ cold, timed out), nemotron-nano-3-30b (404).
// The picker still filters through the provider's live `/models` response. The "other" tier
// needs that provider's own API key.
export const MODEL_CATALOG: ModelEntry[] = [
  // — Work: does the real coding/agentic work AND drives computer use — (tier 'coding' internal key)
  { label: 'Mistral Small 4', value: 'mistralai/mistral-small-4-119b-2603', desc: 'The default — fast, sees screens, calls tools reliably', tier: 'coding' },
  // Probed 2026-07-27 on NIM: called the tool correctly with well-formed arguments, 641ms warm.
  // Cold starts are punishing (one 108s run failed with a provider EngineCore error), which is
  // true of every NIM model on a free key — warm behaviour is what an agent loop actually feels.
  // Text-only, so screenshot turns still route to the vision slot.
  { label: 'Mistral Nemotron', value: 'mistralai/mistral-nemotron', desc: 'Mistral tuned by NVIDIA — 641ms warm, reliable tool calls; slow cold start', tier: 'coding' },
  // Served and correct, but 46-88s per call even warm — a minute per agent step. Opt-in only.
  { label: 'Mistral Medium 3.5', value: 'mistralai/mistral-medium-3.5-128b', desc: 'Calls tools correctly but 46-88s per call on NIM (2026-07-27) — too slow to drive a loop', tier: 'coding', avoidAutoSelect: true },
  { label: 'Qwen 3.5 397B', value: 'qwen/qwen3.5-397b-a17b', desc: 'Bigger reasoner — reliable tools but slow (15-37s/step)', tier: 'coding' },
  // avoidAutoSelect: probed 2026-07-27 on this NIM key — glm-5.2 is listed by /models but sent no
  // response headers for 180s. The other two carry documented cold-start stalls. All three remain
  // one click away in the picker; none may be chosen for the user by the healer.
  { label: 'GLM 5.2', value: 'z-ai/glm-5.2', desc: 'Coding + reasoning — UNAVAILABLE on some NIM keys (times out; probe before defaulting)', tier: 'coding', avoidAutoSelect: true },
  { label: 'DeepSeek V4 Pro', value: 'deepseek-ai/deepseek-v4-pro', desc: '1M context, terminal + coding — very slow NIM cold-start; opt in', tier: 'coding', avoidAutoSelect: true },
  { label: 'GPT-OSS 120B', value: 'openai/gpt-oss-120b', desc: 'Fast open reasoner — effort adjustable, no vision', tier: 'coding' },
  { label: 'MiniMax M3', value: 'minimaxai/minimax-m3', desc: 'Strong coder — slow to start', tier: 'coding', avoidAutoSelect: true },
  { label: 'Step 3.7 Flash', value: 'stepfun-ai/step-3.7-flash', desc: 'Multimodal reasoner — listed on NIM but timed out (180s, no headers) on 2026-07-27', tier: 'coding', avoidAutoSelect: true },

  // — Vision: sees screenshots and images. Probed 2026-07-19 on a real image; only VLMs that
  //   ANSWERED correctly are listed. The default work model already sees, so this slot is a
  //   fallback for when work is switched to a text-only model. —
  // Order is the auto-selection preference order, so the 2026-07-27 vision+tools probe leads:
  // each candidate was sent a real PNG plus a tool schema and had to BOTH read the image and call
  // the tool — which is exactly what one computer-use step is. Only nemotron and llama passed.
  { label: 'Nemotron Nano 12B VL', value: 'nvidia/nemotron-nano-12b-v2-vl', desc: 'Reads images AND calls tools, ~3.5s — verified on the vision+tools probe 2026-07-27', tier: 'vision' },
  { label: 'Mistral Small 4', value: 'mistralai/mistral-small-4-119b-2603', desc: 'Best pick — sees AND calls tools, ~0.7s', tier: 'vision' },
  // 400s on every tools+image request, which is every computer-use step. This is what kept computer
  // use dead: the slot was pinned here, so each screenshot turn failed before it began.
  { label: 'Step 3.7 Flash', value: 'stepfun-ai/step-3.7-flash', desc: '262K multimodal context — 400s on tools+image, and timed out (180s) on plain text (2026-07-27)', tier: 'vision', avoidAutoSelect: true },
  // Listed by /models yet every completion 404s — the exact trap `unservable` exists for. Kept in
  // the picker (other keys do serve it) but barred from automatic selection.
  { label: 'Kimi K2.6', value: 'moonshotai/kimi-k2.6', desc: 'Multimodal — listed on NIM but 404s on completion (2026-07-27)', tier: 'vision', avoidAutoSelect: true },
  // Cannot call tools, so an agent turn routed here stalls with no output — never auto-select it.
  { label: 'Llama 3.2 90B Vision', value: 'meta/llama-3.2-90b-vision-instruct', desc: 'Reads screens but CANNOT call tools — stalls agents', tier: 'vision', avoidAutoSelect: true },

  // — Quick: instant small replies (never a thinking model) — (tier 'lite' kept as the internal key)
  { label: 'Qwen 3.5 122B', value: 'qwen/qwen3.5-122b-a10b', desc: 'The default — sub-second plain answers', tier: 'lite' },
  { label: 'Step 3.7 Flash', value: 'stepfun-ai/step-3.7-flash', desc: 'Reasoning-heavy — timed out (180s, no headers) on 2026-07-27', tier: 'lite', avoidAutoSelect: true },
  { label: 'Mistral Small 4', value: 'mistralai/mistral-small-4-119b-2603', desc: 'Fast all-round alternative', tier: 'lite' },
  { label: 'Sarvam M', value: 'sarvamai/sarvam-m', desc: 'Multilingual alternative', tier: 'lite' },

  // — Other providers (need their own API key; not probed) —
  { label: 'GPT-4o (OpenAI)', value: 'gpt-4o', desc: 'Needs OPENAI_API_KEY', tier: 'other' },
  { label: 'Claude 3.5 Sonnet (Anthropic)', value: 'claude-3-5-sonnet-20241022', desc: 'Needs ANTHROPIC_API_KEY', tier: 'other' },
  { label: 'Gemini 2.0 Flash (Google)', value: 'gemini-2.0-flash', desc: 'Needs a Google key', tier: 'other' },
];

/**
 * Default model for each slot. CODING is mistral-small-4: the 2026-07-19 computer-use probe (4x
 * tool call + 2x real-image vision) had it call the tool 4/4 at 0.5-1s and read the image right
 * 2/2 at ~0.7s, with no hidden reasoning — fast enough for hours of stepping, reliable enough to
 * not stall, and vision-capable so screenshots stay on the working model. It beat every prior
 * default on THIS workload: step-3.7 overthinks; qwen-397b is reliable but 15-37s/step and its
 * vision times out; qwen-122b's vision returned empty every time. LITE stays a PLAIN non-reasoning
 * model on the "fastest safe path" rule: qwen3.5-122b answered warm text in under a second.
 */
export const DEFAULT_CODING_MODEL = 'mistralai/mistral-small-4-119b-2603';
// A PLAIN model, per this slot's rule above. This constant used to be stepfun-ai/step-3.7-flash,
// which contradicted both the rule and the comment beside it in config.ts, and which timed out
// (180s, no response headers) on the 2026-07-27 probe. Providers that don't serve this id get a
// working replacement from healModels() at startup.
export const DEFAULT_LITE_MODEL = 'qwen/qwen3.5-122b-a10b';
export const LEGACY_SAFE_LITE_MODEL = 'qwen/qwen3.5-122b-a10b';

/**
 * Ordered auto-selection candidates for one slot, restricted to what the provider actually serves.
 * This is the policy the self-healer uses when a configured model has gone stale (a provider
 * rotated its catalog, or the config was copied from a different provider).
 *
 * Ranking, best first:
 *   1. curated models for this slot, excluding `avoidAutoSelect`
 *      — for the QUICK slot, plain models rank above reasoning models: a hidden 20-30s thinking
 *        phase behind "hi" defeats the entire point of that slot
 *   2. curated models from any other slot (a working model in the wrong slot still answers)
 *   3. nothing — the caller must leave the pin alone and ask the user to run /model
 *
 * Deliberately never falls back to "whatever the provider listed first". `/models` membership does
 * not imply the model serves chat/completions: on NVIDIA, `01-ai/yi-large` is listed and 404s, and
 * being alphabetically first is what made it the old healer's pick.
 */
/** True when the catalog bars this id from being chosen automatically on the user's behalf. */
export function isAvoidAutoSelect(id: string): boolean {
  return MODEL_CATALOG.some(m => m.value === id && m.avoidAutoSelect);
}

export function autoSelectCandidates(
  slot: 'coding' | 'lite' | 'vision',
  servedIds: Iterable<string>,
): string[] {
  const served = new Set(servedIds);
  const eligible = MODEL_CATALOG.filter(m => m.tier !== 'other' && !m.avoidAutoSelect && served.has(m.value));
  const inSlot = eligible.filter(m => m.tier === slot).map(m => m.value);
  const ranked = slot === 'lite'
    ? [...inSlot.filter(id => !isReasoningModel(id)), ...inSlot.filter(id => isReasoningModel(id))]
    : inSlot;
  const others = eligible.filter(m => m.tier !== slot).map(m => m.value);
  return [...new Set([...ranked, ...others])];
}

/**
 * True when `id` is a reasoning/thinking model (native channel, inline <think>, or opener-less
 * CoT). Used to keep such models OUT of the lite slot: quick replies and aux calls must never
 * sit behind a hidden reasoning phase there is no API switch to turn off.
 */
export function isReasoningModel(id: string): boolean {
  const caps = capabilitiesFor(null, id);
  return !!(caps.nativeThinking || caps.inlineReasoning || caps.openerlessReasoning);
}

// ONE vocabulary everywhere: Work · Quick · Vision. The banner, the /model hub, the pickers, and
// every confirmation use exactly these three words — "coding/lite/fast" survive only as internal
// keys and accepted command aliases, never as UI text. (This naming drift was the #1 recurring
// clutter complaint.)
const TIER_LABEL: Record<ModelEntry['tier'], string> = {
  coding: 'Work', vision: 'Vision', lite: 'Quick', other: 'Other (own key)',
};

/**
 * Slot-scoped picker rows: each slot's picker shows ONLY models that belong in that slot, as one
 * flat "Recommended" list (no tab groups to arrow through). Work → work-tier models; Quick →
 * plain non-thinking models only (a reasoner in the quick slot hides 20-30s of thought behind
 * "hi"); Vision → vision models. Everything else stays one hop away behind "Browse all…".
 */
export function slotModelMenuOptions(
  slot: 'work' | 'quick' | 'vision',
  liveIds: string[] | null,
  current?: string,
): { label: string; value: string; desc: string; category: string }[] {
  const served = liveIds && liveIds.length ? new Set(liveIds) : null;
  const tier: ModelEntry['tier'] = slot === 'work' ? 'coding' : slot === 'quick' ? 'lite' : 'vision';
  const rows = MODEL_CATALOG
    .filter(m => m.tier === tier && (!served || served.has(m.value)))
    .map(m => ({
      label: m.value === current ? `● ${m.label}` : m.label,
      value: m.value,
      desc: m.desc,
      category: 'Recommended',
    }));
  if (current && !rows.some(r => r.value === current)) {
    rows.unshift({ label: `● ${current}`, value: current, desc: 'Your current pick', category: 'Recommended' });
  }
  return rows;
}

/** Menu options for a model picker, optionally annotated with which slot is current. */
export function modelMenuOptions(current?: string): { label: string; value: string; desc: string; category: string }[] {
  return MODEL_CATALOG.map(m => ({
    label: m.value === current ? `● ${m.label}` : m.label,
    value: m.value,
    desc: m.desc,
    category: TIER_LABEL[m.tier],
  }));
}

// Build the picker from the IDs the provider ACTUALLY serves (LlmAdapter.listProviderModels()).
// A live ID that matches the curated catalog inherits its nice label/description/tier; anything
// else shows as its raw id under "Available on your provider". This is the fix for the 400s —
// you can only pick a model the provider confirms it has. Empty list → caller uses the static
// catalog instead (offline / no /models endpoint).
export function liveModelMenuOptions(liveIds: string[], current?: string): { label: string; value: string; desc: string; category: string }[] {
  const byId = new Map(MODEL_CATALOG.map(m => [m.value, m]));
  return liveIds.map(id => {
    const known = byId.get(id);
    return {
      label: id === current ? `● ${known?.label || id}` : (known?.label || id),
      value: id,
      desc: known?.desc || id,
      category: known ? TIER_LABEL[known.tier] : 'Available on your provider',
    };
  });
}

/**
 * Clutter-free picker: ONLY the curated recommendations (filtered to what the provider actually
 * serves when we have its live list), never the raw multi-hundred-row catalog. The full list
 * stays one hop away behind a "Browse all…" row the caller wires to `__browse__`.
 */
export function curatedModelMenuOptions(
  liveIds: string[] | null,
  current?: string,
): { label: string; value: string; desc: string; category: string }[] {
  const served = liveIds && liveIds.length ? new Set(liveIds) : null;
  const mark = (v: string, label: string) => (v === current ? `● ${label}` : label);
  const rows = MODEL_CATALOG
    .filter(m => m.tier !== 'other' && (!served || served.has(m.value)))
    .map(m => ({
      label: mark(m.value, m.label),
      value: m.value,
      desc: m.desc,
      category: TIER_LABEL[m.tier],
    }));
  // If the current model isn't in the curated set, surface it so "what am I on?" is always visible.
  if (current && !rows.some(r => r.value === current)) {
    rows.unshift({ label: `● ${current}`, value: current, desc: 'Your current model', category: TIER_LABEL.coding });
  }
  return rows;
}
