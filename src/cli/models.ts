// Curated model catalog for the /model picker. IDs follow the NVIDIA NIM `publisher/model` convention
// (the default provider). If your provider names a model differently, use the "Custom model id…" entry.
// `tier` groups them for the picker: 'coding' = strong agentic/coding models, 'lite' = fast/cheap ones.

export interface ModelEntry {
  label: string;
  value: string;
  desc: string;
  tier: 'coding' | 'lite' | 'other';
}

// NIM ids below were each VERIFIED to respond to "hi" on NVIDIA NIM (2026-06-15 probe). Three
// catalogued NIM models did NOT respond within ~3 min even after a warm-up (deepseek-v4-pro 1.6T,
// deepseek-v4-flash 284B, google/gemma-4-31b — likely free-tier capacity / cold-start); add them
// via the Custom entry if NIM has them warm. The "other" tier needs that provider's own API key.
export const MODEL_CATALOG: ModelEntry[] = [
  // — Strong coding / agentic (verified) —
  { label: 'MiniMax M3', value: 'minimaxai/minimax-m3', desc: 'Agentic coding, 1M ctx, native multimodal', tier: 'coding' },
  { label: 'GLM 5.1', value: 'z-ai/glm-5.1', desc: 'Flagship agentic + coding + long-horizon reasoning', tier: 'coding' },
  { label: 'Mistral Medium 3.5', value: 'mistralai/mistral-medium-3.5-128b', desc: 'Strong text/coding/agentic (slow cold-start)', tier: 'coding' },
  { label: 'MiniMax M2.7', value: 'minimaxai/minimax-m2.7', desc: '230B coding/reasoning/office (slow cold-start)', tier: 'coding' },

  // — Fast / lite (good as the LITE model: summaries, self-critic) —
  { label: 'Step 3.7 Flash', value: 'stepfun-ai/step-3.7-flash', desc: 'Sparse-MoE multimodal reasoning, agentic + coding — THE DEFAULT (both slots)', tier: 'lite' },
  { label: 'Llama 3.1 70B', value: 'meta/llama-3.1-70b-instruct', desc: 'Fast, reliable tool calls (plain, no reasoning) — pick this if you want lower latency', tier: 'lite' },
  { label: 'Sarvam M', value: 'sarvamai/sarvam-m', desc: 'Multilingual (Indian languages), coding + math', tier: 'lite' },

  // — Other providers (need their own API key; not probed) —
  { label: 'GPT-4o (OpenAI)', value: 'gpt-4o', desc: 'Needs OPENAI_API_KEY', tier: 'other' },
  { label: 'Claude 3.5 Sonnet (Anthropic)', value: 'claude-3-5-sonnet-20241022', desc: 'Needs ANTHROPIC_API_KEY', tier: 'other' },
  { label: 'Gemini 2.0 Flash (Google)', value: 'gemini-2.0-flash', desc: 'Needs a Google key', tier: 'other' },
];

/**
 * Default model for each slot. Both slots default to Step 3.7 Flash — the coding/lite split is
 * retired as a default (one great fast model everywhere; the router short-circuits when the two
 * slots match, skipping the pre-flight classifier LLM call entirely). Pin a different coding model
 * with /model if you want the split back.
 * step-3.7-flash is the valid NIM id for the Step "flash" model (the old step-3.5-flash 400s as
 * "not a valid model ID").
 */
export const DEFAULT_CODING_MODEL = 'stepfun-ai/step-3.7-flash';
export const DEFAULT_LITE_MODEL = 'stepfun-ai/step-3.7-flash';

const TIER_LABEL: Record<ModelEntry['tier'], string> = { coding: 'Coding / agentic', lite: 'Fast / lite', other: 'Other providers (own key)' };

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
