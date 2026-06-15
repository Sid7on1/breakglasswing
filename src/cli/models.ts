// Curated model catalog for the /model picker. IDs follow the NVIDIA NIM `publisher/model` convention
// (the default provider). If your provider names a model differently, use the "Custom model id…" entry.
// `tier` groups them for the picker: 'coding' = strong agentic/coding models, 'lite' = fast/cheap ones.

export interface ModelEntry {
  label: string;
  value: string;
  desc: string;
  tier: 'coding' | 'lite' | 'other';
}

// NIM ids below are VERIFIED to respond to "hi" on NVIDIA NIM (2026-06-15 probe). Earlier
// best-guess ids (deepseek-v4-pro/flash, zai/glm-5.1, mistral-medium-3.5, minimax-m2.7,
// gemma-4-31b) 404'd or timed out, so they were removed — re-add via the Custom entry if you
// find their correct NIM id. The "other" tier needs that provider's own API key (untested here).
export const MODEL_CATALOG: ModelEntry[] = [
  // — Strong coding / agentic (verified) —
  { label: 'MiniMax M3', value: 'minimaxai/minimax-m3', desc: 'Agentic coding, 1M ctx, native multimodal — the coding default', tier: 'coding' },
  { label: 'Step 3.7 Flash', value: 'stepfun-ai/step-3.7-flash', desc: 'Multimodal agent audits, 400 tok/s, 3 reasoning levels', tier: 'coding' },

  // — Fast / lite (verified; good as the LITE model: summaries, self-critic) —
  { label: 'Llama 3.1 70B', value: 'meta/llama-3.1-70b-instruct', desc: 'Fast, reliable tool calls — the lite default', tier: 'lite' },
  { label: 'Step 3.5 Flash', value: 'stepfun-ai/step-3.5-flash', desc: 'Open reasoning, LiveCodeBench 86.4%, Apache 2.0', tier: 'lite' },
  { label: 'Sarvam M', value: 'sarvamai/sarvam-m', desc: 'Indic multilingual (10+ Indian languages), 32K ctx', tier: 'lite' },

  // — Other providers (need their own API key; not probed) —
  { label: 'GPT-4o (OpenAI)', value: 'gpt-4o', desc: 'Needs OPENAI_API_KEY', tier: 'other' },
  { label: 'Claude 3.5 Sonnet (Anthropic)', value: 'claude-3-5-sonnet-20241022', desc: 'Needs ANTHROPIC_API_KEY', tier: 'other' },
  { label: 'Gemini 2.0 Flash (Google)', value: 'gemini-2.0-flash', desc: 'Needs a Google key', tier: 'other' },
];

/** Default model for each slot. */
export const DEFAULT_CODING_MODEL = 'minimaxai/minimax-m3';
export const DEFAULT_LITE_MODEL = 'meta/llama-3.1-70b-instruct';

/** Menu options for a model picker, optionally annotated with which slot is current. */
export function modelMenuOptions(current?: string): { label: string; value: string; desc: string; category: string }[] {
  const cat: Record<ModelEntry['tier'], string> = { coding: 'Coding / agentic', lite: 'Fast / lite', other: 'Other providers (own key)' };
  return MODEL_CATALOG.map(m => ({
    label: m.value === current ? `● ${m.label}` : m.label,
    value: m.value,
    desc: m.desc,
    category: cat[m.tier],
  }));
}
