// Curated model catalog for the /model picker. IDs follow the NVIDIA NIM `publisher/model` convention
// (the default provider). If your provider names a model differently, use the "Custom model id…" entry.
// `tier` groups them for the picker: 'coding' = strong agentic/coding models, 'lite' = fast/cheap ones.

export interface ModelEntry {
  label: string;
  value: string;
  desc: string;
  tier: 'coding' | 'lite' | 'other';
}

export const MODEL_CATALOG: ModelEntry[] = [
  // — Strong coding / agentic —
  { label: 'MiniMax M3', value: 'minimaxai/minimax-m3', desc: 'Agentic coding, 1M ctx, native multimodal — the coding default', tier: 'coding' },
  { label: 'DeepSeek V4 Pro', value: 'deepseek-ai/deepseek-v4-pro', desc: 'Frontier reasoning/math, Codeforces 3206, 1M ctx', tier: 'coding' },
  { label: 'GLM 5.1', value: 'zai/glm-5.1', desc: '#1 SWE-Bench Pro 58.4%, 8-hr autonomous runs, 200K ctx', tier: 'coding' },
  { label: 'Mistral Medium 3.5', value: 'mistralai/mistral-medium-3.5-128b', desc: 'Unified instruct/reasoning/coding, SWE-bench 77.6%', tier: 'coding' },
  { label: 'Step 3.7 Flash', value: 'stepfun-ai/step-3.7-flash', desc: 'Multimodal agent audits, 400 tok/s, 3 reasoning levels', tier: 'coding' },

  // — Fast / lite (good as the LITE model: summaries, self-critic, classification) —
  { label: 'DeepSeek V4 Flash', value: 'deepseek-ai/deepseek-v4-flash', desc: 'Fast utility coding, SWE-bench 80.6%, ~$0.14/M', tier: 'lite' },
  { label: 'MiniMax M2.7', value: 'minimaxai/minimax-m2.7', desc: 'Office/enterprise text processing, 128K ctx', tier: 'lite' },
  { label: 'Step 3.5 Flash', value: 'stepfun-ai/step-3.5-flash', desc: 'Open reasoning, LiveCodeBench 86.4%, Apache 2.0', tier: 'lite' },
  { label: 'Gemma 4 31B', value: 'google/gemma-4-31b-it', desc: 'Frontier math (AIME 89.2%), edge-deployable, 256K ctx', tier: 'lite' },
  { label: 'Llama 3.1 70B', value: 'meta/llama-3.1-70b-instruct', desc: 'Fast, reliable tool calls — the lite default', tier: 'lite' },
  { label: 'Sarvam M', value: 'sarvamai/sarvam-m', desc: 'Indic multilingual (10+ Indian languages), 32K ctx', tier: 'lite' },

  // — Other providers (need their own API key) —
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
