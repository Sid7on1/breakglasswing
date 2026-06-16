/**
 * Model capability layer.
 *
 * BiMax is model-agnostic: one OpenAI-compatible seam (`LlmAdapter`) drives NVIDIA, OpenAI,
 * Anthropic, OpenRouter, DeepSeek, Google and local endpoints. A handful of powerful features
 * only exist on *some* models — prompt caching (Anthropic), structured/JSON-schema outputs
 * (OpenAI, Gemini), reliable parallel tool calls, native reasoning channels, vision input.
 *
 * Rather than assume one provider and bolt the rest on, BiMax declares each power as a
 * **capability flag** and resolves the flags for the *currently selected* model. Callers then
 * light up a native fast-path when the capability is present and fall back to a universal path
 * (which BiMax already ships for most of these) when it is not. The golden rule:
 *
 *   The conservative FLOOR (everything off) must reproduce today's behavior byte-for-byte.
 *   A capability only ever *adds* an optimization; it never removes a fallback.
 *
 * Resolution is a curated table, not runtime probing: probing costs a request and is flaky,
 * whereas a table keyed by well-known model-id substrings is deterministic and free. The long
 * tail (a proxy that secretly supports caching, a self-hosted vision model) is covered by an
 * explicit override (`BGW_CAP_*` env or config), so nothing is permanently locked off.
 */

export interface ModelCapabilities {
  /** Anthropic ephemeral prompt caching (`cache_control`). Big cost/latency win on long, stable prefixes. */
  promptCaching: boolean;
  /** Model emits a structured reasoning channel; we don't need to scrape `<think>` text out of content. */
  nativeThinking: boolean;
  /** Tool arguments stream as partial-JSON deltas (can render live) vs arriving in one blob at block end. */
  partialJsonTools: boolean;
  /** Model reliably emits more than one tool call per turn (some backends, e.g. NVIDIA NIM, reject it). */
  parallelToolCalls: boolean;
  /** JSON-schema-constrained output (`response_format`/`json_schema`); removes the parse-from-prose risk. */
  structuredOutputs: boolean;
  /** Accepts a `reasoning_effort` knob (thinking models); sending it to a model that lacks it can 400. */
  reasoningEffortKnob: boolean;
  /** Image input. */
  visionInput: boolean;
  /** Approximate context window in tokens — compaction thresholds scale to this. */
  contextWindow: number;
}

/**
 * The conservative floor: assume nothing. This is exactly BiMax's behavior before the
 * capability layer existed, so any model not in the table (or any endpoint we can't identify)
 * keeps working precisely as it did — only with the universal fallbacks engaged.
 */
export const FLOOR: ModelCapabilities = {
  promptCaching: false,
  nativeThinking: false,
  partialJsonTools: false,
  parallelToolCalls: false,
  structuredOutputs: false,
  reasoningEffortKnob: false,
  visionInput: false,
  contextWindow: 32_000,
};

/** A capability family — a set of overrides applied on top of FLOOR when a model matches. */
interface CapabilityRule {
  /** Lower-cased substrings; the rule fires when ANY is found in the model id. */
  match: string[];
  caps: Partial<ModelCapabilities>;
}

/**
 * Curated rules, evaluated top-to-bottom; the FIRST match wins (so put specific families before
 * broad ones). Keyed off model-id substrings because that is what every provider actually puts in
 * the `model` field, regardless of which base URL routes it (direct, OpenRouter, Bedrock proxy…).
 */
const RULES: CapabilityRule[] = [
  // --- Anthropic Claude (3.x + 4.x): the only family with prompt caching + native thinking. ---
  {
    match: ['claude', 'anthropic'],
    caps: {
      promptCaching: true,
      nativeThinking: true,
      partialJsonTools: true,
      parallelToolCalls: true,
      structuredOutputs: false, // Claude does tools, not OpenAI-style response_format json_schema
      reasoningEffortKnob: false,
      visionInput: true,
      contextWindow: 200_000,
    },
  },
  // --- OpenAI o-series reasoning models: structured outputs + reasoning_effort, no temp control. ---
  {
    match: ['o1', 'o3', 'o4-', 'gpt-5'],
    caps: {
      structuredOutputs: true,
      reasoningEffortKnob: true,
      parallelToolCalls: true,
      partialJsonTools: true,
      nativeThinking: true,
      visionInput: true,
      contextWindow: 200_000,
    },
  },
  // --- OpenAI GPT-4o / 4.1 family. ---
  {
    match: ['gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'chatgpt-4o'],
    caps: {
      structuredOutputs: true,
      parallelToolCalls: true,
      partialJsonTools: true,
      visionInput: true,
      contextWindow: 128_000,
    },
  },
  // --- Google Gemini 1.5 / 2.x. ---
  {
    match: ['gemini-2', 'gemini-1.5', 'gemini-exp'],
    caps: {
      structuredOutputs: true,
      parallelToolCalls: true,
      partialJsonTools: true,
      visionInput: true,
      contextWindow: 1_000_000,
    },
  },
  // --- DeepSeek reasoner (R1-style): native reasoning channel, effort knob; no structured outputs. ---
  {
    match: ['deepseek-reasoner', 'deepseek-r1', 'r1'],
    caps: {
      nativeThinking: true,
      reasoningEffortKnob: true,
      contextWindow: 64_000,
    },
  },
  // --- MiniMax (BiMax's default reasoning MoE): reasoning channel + effort, single-tool-safe. ---
  {
    match: ['minimax'],
    caps: {
      nativeThinking: true,
      reasoningEffortKnob: true,
      parallelToolCalls: true,
      contextWindow: 1_000_000,
    },
  },
  // --- Llama 3.x (NVIDIA NIM and others): large-ish window, but NIM rejects multi-tool turns. ---
  {
    match: ['llama-3', 'llama3'],
    caps: {
      parallelToolCalls: false,
      contextWindow: 128_000,
    },
  },
];

/** A single env override, e.g. BGW_CAP_PROMPT_CACHING=true. Returns undefined when unset. */
function envFlag(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  return v === 'true' || v === '1';
}

/**
 * Apply user overrides from the environment on top of a resolved descriptor. This is the escape
 * hatch for endpoints the table can't know about (a proxy that does support caching, a local
 * vision model, a backend that genuinely allows parallel tools). Each flag is independent.
 */
function applyOverrides(caps: ModelCapabilities): ModelCapabilities {
  const out = { ...caps };
  const pc = envFlag('BGW_CAP_PROMPT_CACHING');         if (pc !== undefined) out.promptCaching = pc;
  const nt = envFlag('BGW_CAP_NATIVE_THINKING');        if (nt !== undefined) out.nativeThinking = nt;
  const pj = envFlag('BGW_CAP_PARTIAL_JSON_TOOLS');     if (pj !== undefined) out.partialJsonTools = pj;
  const pt = envFlag('BGW_CAP_PARALLEL_TOOL_CALLS');    if (pt !== undefined) out.parallelToolCalls = pt;
  const so = envFlag('BGW_CAP_STRUCTURED_OUTPUTS');     if (so !== undefined) out.structuredOutputs = so;
  const re = envFlag('BGW_CAP_REASONING_EFFORT');       if (re !== undefined) out.reasoningEffortKnob = re;
  const vi = envFlag('BGW_CAP_VISION');                 if (vi !== undefined) out.visionInput = vi;
  const cw = process.env.BGW_CAP_CONTEXT_WINDOW;        if (cw && !Number.isNaN(parseInt(cw, 10))) out.contextWindow = parseInt(cw, 10);
  return out;
}

/**
 * Resolve capabilities for a specific (provider, model). `provider` is accepted for future
 * provider-scoped rules but resolution is currently driven by the model id, which is the field
 * every backend populates regardless of routing. Always returns a complete descriptor (FLOOR for
 * unknowns) so callers never deal with undefined.
 */
export function capabilitiesFor(provider: string | null | undefined, model: string | null | undefined): ModelCapabilities {
  const id = (model || '').toLowerCase();
  let resolved: ModelCapabilities = { ...FLOOR };
  for (const rule of RULES) {
    if (rule.match.some(m => id.includes(m))) {
      resolved = { ...FLOOR, ...rule.caps };
      break;
    }
  }
  return applyOverrides(resolved);
}

/**
 * A compact glyph cluster for the footer/status line, showing what the active model unlocks.
 * Empty string when nothing notable is on (a floor model), so the footer stays quiet.
 */
export function capabilityGlyphs(caps: ModelCapabilities): string {
  const parts: string[] = [];
  if (caps.promptCaching) parts.push('⚡cache');
  if (caps.nativeThinking) parts.push('⊹think');
  if (caps.structuredOutputs) parts.push('{}json');
  if (caps.visionInput) parts.push('◉vision');
  return parts.join(' ');
}
