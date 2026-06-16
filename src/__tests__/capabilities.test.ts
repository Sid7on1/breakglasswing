import { capabilitiesFor, capabilityGlyphs, FLOOR } from '../core/capabilities';
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
