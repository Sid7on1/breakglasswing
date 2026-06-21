import { capabilitiesFor, capabilityGlyphs, FLOOR, isFirstPartyAnthropic, anthropicBetaHeaders } from '../core/capabilities';
import { markCacheBreakpoint } from '../core/llm.adapter';

// The capability layer is the spine of BiMax's "Claude-when-you-can, universal-always" design.
// Two invariants matter most: (1) unknown models resolve to the FLOOR so behavior is unchanged,
// and (2) the curated families resolve to the right powers. Plus the env override escape hatch.
describe('capabilitiesFor — model capability resolution', () => {
  const ENV = { ...process.env };
  afterEach(() => { process.env = { ...ENV }; });

  it('returns the conservative FLOOR for unknown / local models (byte-identical-to-today guarantee)', () => {
    const caps = capabilitiesFor('local', 'some-random-7b-instruct');
    expect(caps).toEqual(FLOOR);
    expect(caps.promptCaching).toBe(false);
    expect(caps.parallelToolCalls).toBe(false);
  });

  it('returns FLOOR for an empty/undefined model', () => {
    expect(capabilitiesFor(undefined, undefined)).toEqual(FLOOR);
  });

  it('Claude is the only family with prompt caching + native thinking', () => {
    const caps = capabilitiesFor('anthropic', 'claude-3-5-sonnet-20241022');
    expect(caps.promptCaching).toBe(true);
    expect(caps.nativeThinking).toBe(true);
    expect(caps.partialJsonTools).toBe(true);
    expect(caps.contextWindow).toBe(200_000);
    // Claude uses tools, not OpenAI response_format json_schema.
    expect(caps.structuredOutputs).toBe(false);
  });

  it('Claude routed via OpenRouter (openai-style id) still resolves as Claude', () => {
    expect(capabilitiesFor('openrouter', 'anthropic/claude-3.7-sonnet').promptCaching).toBe(true);
  });

  it('GPT-4o gets structured outputs + parallel tools but NOT prompt caching', () => {
    const caps = capabilitiesFor('openai', 'gpt-4o');
    expect(caps.structuredOutputs).toBe(true);
    expect(caps.parallelToolCalls).toBe(true);
    expect(caps.promptCaching).toBe(false);
  });

  it('o-series reasoning models get the reasoning_effort knob + native thinking', () => {
    const caps = capabilitiesFor('openai', 'o3-mini');
    expect(caps.reasoningEffortKnob).toBe(true);
    expect(caps.nativeThinking).toBe(true);
    expect(caps.structuredOutputs).toBe(true);
  });

  it('Gemini gets a 1M window + vision + structured outputs', () => {
    const caps = capabilitiesFor('google', 'gemini-2.0-flash');
    expect(caps.contextWindow).toBe(1_000_000);
    expect(caps.visionInput).toBe(true);
    expect(caps.structuredOutputs).toBe(true);
  });

  it('NVIDIA NIM Llama is pinned to single-tool-per-turn (parallelToolCalls=false)', () => {
    expect(capabilitiesFor('nvidia', 'meta/llama-3.1-70b-instruct').parallelToolCalls).toBe(false);
  });

  it('DeepSeek reasoner exposes a reasoning channel + effort knob, no structured outputs', () => {
    const caps = capabilitiesFor('deepseek', 'deepseek-reasoner');
    expect(caps.nativeThinking).toBe(true);
    expect(caps.reasoningEffortKnob).toBe(true);
    expect(caps.structuredOutputs).toBe(false);
  });

  // The A3 reasoning_effort send-gate keys off reasoningEffortKnob: only flagged models get the
  // field (others 400 on it). Lock both polarities so a table edit can't silently break the gate.
  it('reasoningEffortKnob: on for true reasoning models, off for the rest (incl. minimax)', () => {
    expect(capabilitiesFor('openai', 'o1-preview').reasoningEffortKnob).toBe(true);
    expect(capabilitiesFor('deepseek', 'deepseek-r1').reasoningEffortKnob).toBe(true);
    expect(capabilitiesFor('nvidia', 'minimax-m1').reasoningEffortKnob).toBe(false); // not a reasoning model
    expect(capabilitiesFor('openai', 'gpt-4o').reasoningEffortKnob).toBe(false);
    expect(capabilitiesFor('anthropic', 'claude-3-5-sonnet').reasoningEffortKnob).toBe(false);
    expect(capabilitiesFor('local', 'mystery-7b').reasoningEffortKnob).toBe(false);
  });

  // inlineReasoning drives the streaming think-filter's preamble-cap lift: the NIM reasoning models
  // that emit chain-of-thought inline (before a tool call) must be flagged, or their reasoning leaks
  // into the reply. Plain/structured-reasoning models stay false so the cap protects them.
  it('inlineReasoning: on for the inline-CoT reasoning models (stepfun), off for plain models (incl. minimax)', () => {
    // minimax is NOT a reasoning model — inlineReasoning false so its tokens stream instead of being
    // buffered until a `</think>` that never arrives. stepfun IS a reasoning model → true.
    expect(capabilitiesFor('nvidia', 'minimax-m3').inlineReasoning).toBe(false);
    expect(capabilitiesFor('nvidia', 'step-3.5-flash').inlineReasoning).toBe(true);
    expect(capabilitiesFor('nvidia', 'stepfun/step-3.7').inlineReasoning).toBe(true);
    expect(capabilitiesFor('anthropic', 'claude-3-5-sonnet').inlineReasoning).toBe(false);
    expect(capabilitiesFor('openai', 'gpt-4o').inlineReasoning).toBe(false);
    expect(capabilitiesFor('local', 'mystery-7b').inlineReasoning).toBe(false);
  });

  it('BGW_CAP_INLINE_REASONING can force the cap-lift for an unlisted inline-CoT model', () => {
    process.env.BGW_CAP_INLINE_REASONING = 'true';
    expect(capabilitiesFor('local', 'some-qwq-clone').inlineReasoning).toBe(true);
  });

  it('an env override can force-enable a capability the table withholds (proxy escape hatch)', () => {
    process.env.BGW_CAP_PROMPT_CACHING = 'true';
    expect(capabilitiesFor('local', 'mystery-model').promptCaching).toBe(true);
  });

  it('an env override can force-DISABLE a capability the table grants', () => {
    process.env.BGW_CAP_PARALLEL_TOOL_CALLS = 'false';
    expect(capabilitiesFor('openai', 'gpt-4o').parallelToolCalls).toBe(false);
  });

  it('BGW_CAP_CONTEXT_WINDOW overrides the resolved window', () => {
    process.env.BGW_CAP_CONTEXT_WINDOW = '500000';
    expect(capabilitiesFor('local', 'whatever').contextWindow).toBe(500_000);
  });
});

describe('markCacheBreakpoint — Anthropic cache_control', () => {
  it('converts a string system message into a single cache-marked text part', () => {
    const out = markCacheBreakpoint({ role: 'system', content: 'big stable prompt' });
    expect(out.content).toEqual([
      { type: 'text', text: 'big stable prompt', cache_control: { type: 'ephemeral' } },
    ]);
    expect(out.role).toBe('system');
  });

  it('does not mutate the input message', () => {
    const input = { role: 'system', content: 'x' };
    markCacheBreakpoint(input);
    expect(input.content).toBe('x');
  });

  it('leaves messages with non-string / empty content untouched (nothing to cache)', () => {
    const already = { role: 'system', content: [{ type: 'text', text: 'a' }] };
    expect(markCacheBreakpoint(already)).toBe(already);
    expect(markCacheBreakpoint({ role: 'system', content: '' }).content).toBe('');
  });
});

describe('capabilityGlyphs — footer surfacing', () => {
  it('is empty for a floor model (footer stays quiet)', () => {
    expect(capabilityGlyphs(FLOOR)).toBe('');
  });

  it('shows the powers a Claude model unlocks', () => {
    const g = capabilityGlyphs(capabilitiesFor('anthropic', 'claude-3-5-sonnet'));
    expect(g).toContain('cache');
    expect(g).toContain('think');
    expect(g).toContain('vision');
  });
});

describe('isFirstPartyAnthropic — C6 host gate', () => {
  it('is true only for the genuine Anthropic host', () => {
    expect(isFirstPartyAnthropic('https://api.anthropic.com/v1')).toBe(true);
    expect(isFirstPartyAnthropic('https://api.anthropic.com')).toBe(true);
  });
  it('is false for proxies, OpenRouter, NIM, and junk', () => {
    expect(isFirstPartyAnthropic('https://openrouter.ai/api/v1')).toBe(false);
    expect(isFirstPartyAnthropic('https://integrate.api.nvidia.com/v1')).toBe(false);
    expect(isFirstPartyAnthropic('https://evil.com/api.anthropic.com')).toBe(false);
    expect(isFirstPartyAnthropic('')).toBe(false);
    expect(isFirstPartyAnthropic(undefined)).toBe(false);
    expect(isFirstPartyAnthropic('not a url')).toBe(false);
  });
});

describe('anthropicBetaHeaders — C6 opt-in beta emission', () => {
  const ENV = { ...process.env };
  afterEach(() => { process.env = { ...ENV }; });

  it('emits nothing on a non-Anthropic host even when the env is set', () => {
    process.env.BGW_ANTHROPIC_BETA = 'context-1m-2025-08-07';
    expect(anthropicBetaHeaders('https://openrouter.ai/api/v1')).toBeUndefined();
  });
  it('emits nothing on Anthropic when the env is unset', () => {
    delete process.env.BGW_ANTHROPIC_BETA;
    expect(anthropicBetaHeaders('https://api.anthropic.com/v1')).toBeUndefined();
  });
  it('emits the joined, trimmed beta list on Anthropic when opted in', () => {
    process.env.BGW_ANTHROPIC_BETA = ' context-1m-2025-08-07 , token-efficient-tools , ';
    expect(anthropicBetaHeaders('https://api.anthropic.com/v1')).toEqual({
      'anthropic-beta': 'context-1m-2025-08-07,token-efficient-tools',
    });
  });
});
