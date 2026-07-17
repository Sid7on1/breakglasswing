// Curated model catalog for the /model picker. IDs follow the NVIDIA NIM `publisher/model` convention
// (the default provider). If your provider names a model differently, use the "Custom model id…" entry.
// `tier` groups them for the picker: 'coding' = strong agentic/coding models, 'lite' = fast/cheap ones.

import { capabilitiesFor } from '../core/capabilities';

export interface ModelEntry {
  label: string;
  value: string;
  desc: string;
  tier: 'coding' | 'vision' | 'lite' | 'other';
}

// The original coding/lite NIM ids below were VERIFIED to respond to "hi" on NVIDIA NIM
// (2026-06-15 probe). Vision ids were confirmed against NVIDIA's live catalog on 2026-07-17 and
// are still filtered through the provider's `/models` response before the live picker shows them.
// Three catalogued NIM models did NOT respond within ~3 min even after a warm-up (deepseek-v4-pro 1.6T,
// deepseek-v4-flash 284B, google/gemma-4-31b — likely free-tier capacity / cold-start); add them
// via the Custom entry if NIM has them warm. The "other" tier needs that provider's own API key.
export const MODEL_CATALOG: ModelEntry[] = [
  // — Strong coding / agentic (verified) —
  { label: 'MiniMax M3', value: 'minimaxai/minimax-m3', desc: 'Agentic coding · 1M ctx', tier: 'coding' },
  { label: 'GLM 5.1', value: 'z-ai/glm-5.1', desc: 'Flagship coding + reasoning', tier: 'coding' },
  { label: 'Mistral Medium 3.5', value: 'mistralai/mistral-medium-3.5-128b', desc: 'Strong all-round · slow start', tier: 'coding' },
  { label: 'MiniMax M2.7', value: 'minimaxai/minimax-m2.7', desc: '230B reasoning · slow start', tier: 'coding' },

  // — Vision / GUI agents on NVIDIA NIM —
  { label: 'Nemotron 3 Nano Omni', value: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', desc: 'Best for GUI agents · 256K ctx', tier: 'vision' },
  { label: 'Llama 3.2 90B Vision', value: 'meta/llama-3.2-90b-vision-instruct', desc: 'Reads screens accurately · ~30s/shot', tier: 'vision' },
  { label: 'Llama 3.2 11B Vision', value: 'meta/llama-3.2-11b-vision-instruct', desc: 'Fastest (~5s/shot) · rough reads', tier: 'vision' },
  { label: 'Ministral 3 14B Vision', value: 'mistralai/ministral-14b-instruct-2512', desc: 'Tool calls · often COLD on NIM (minutes)', tier: 'vision' },
  { label: 'Nemotron Nano 12B VL', value: 'nvidia/nemotron-nano-12b-v2-vl', desc: 'Image/video Q&A', tier: 'vision' },

  // — Fast / lite (good as the LITE model: summaries, self-critic) —
  { label: 'Step 3.7 Flash', value: 'stepfun-ai/step-3.7-flash', desc: 'The default · fast reasoning', tier: 'lite' },
  { label: 'Llama 3.1 70B', value: 'meta/llama-3.1-70b-instruct', desc: 'No reasoning = lowest latency', tier: 'lite' },
  { label: 'Sarvam M', value: 'sarvamai/sarvam-m', desc: 'Multilingual · coding + math', tier: 'lite' },

  // — Other providers (need their own API key; not probed) —
  { label: 'GPT-4o (OpenAI)', value: 'gpt-4o', desc: 'Needs OPENAI_API_KEY', tier: 'other' },
  { label: 'Claude 3.5 Sonnet (Anthropic)', value: 'claude-3-5-sonnet-20241022', desc: 'Needs ANTHROPIC_API_KEY', tier: 'other' },
  { label: 'Gemini 2.0 Flash (Google)', value: 'gemini-2.0-flash', desc: 'Needs a Google key', tier: 'other' },
];

/**
 * Default model for each slot. CODING is the reasoning model (step-3.7-flash — the valid NIM id;
 * the old step-3.5-flash 400s as "not a valid model ID"). LITE is deliberately a PLAIN,
 * non-reasoning model: NIM's step-3.7 reasons on EVERY call and ignores every server-side off
 * switch (enable_thinking/thinking:false and reasoning_effort probed live 2026-07-17 — all
 * ignored), so with a reasoner in the lite slot even "hi" burned 20-30s of hidden chain-of-thought.
 * The north-star rule is "fastest safe path": small/conversational/aux calls run on a model that
 * simply doesn't think.
 */
export const DEFAULT_CODING_MODEL = 'stepfun-ai/step-3.7-flash';
export const DEFAULT_LITE_MODEL = 'meta/llama-3.1-70b-instruct';

/**
 * True when `id` is a reasoning/thinking model (native channel, inline <think>, or opener-less
 * CoT). Used to keep such models OUT of the lite slot: quick replies and aux calls must never
 * sit behind a hidden reasoning phase there is no API switch to turn off.
 */
export function isReasoningModel(id: string): boolean {
  const caps = capabilitiesFor(null, id);
  return !!(caps.nativeThinking || caps.inlineReasoning || caps.openerlessReasoning);
}

const TIER_LABEL: Record<ModelEntry['tier'], string> = {
  coding: 'Coding', vision: 'Vision', lite: 'Fast', other: 'Other (own key)',
};

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
