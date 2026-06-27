import { LlmAdapter } from '../core/llm.adapter';

// Regression for report bug J ("temp 0.7 → high run-to-run variability, dropped tool args").
// The fix is NOT lowering temperature — minimax is a tuned reasoning MoE whose model card
// specifies temperature 1.0 + top_p 0.95. The real lever against dropped args / fabricated
// paths is the top_p tail-clip. resolveSampling() must pin minimax to its regime and apply
// top_p everywhere, while still honouring an explicit per-call temperature override.
describe('LlmAdapter.resolveSampling — model-aware sampling', () => {
  it('pins minimax to its model-card regime (temp 1.0, top_p 0.95)', () => {
    const a = new LlmAdapter({} as any);
    const s = a.resolveSampling('minimaxai/minimax-m3');
    expect(s.temperature).toBe(1.0);
    expect(s.top_p).toBe(0.95);
  });

  it('uses the configured temperature for non-minimax models, still clipping top_p', () => {
    const a = new LlmAdapter({} as any);
    a.applyConfig({ temperature: 0.2, topP: 0.9 });
    const s = a.resolveSampling('meta/llama-3.1-70b-instruct');
    expect(s.temperature).toBe(0.2);
    expect(s.top_p).toBe(0.9);
  });

  it('an explicit per-call temperature override always wins (even on minimax)', () => {
    const a = new LlmAdapter({} as any);
    expect(a.resolveSampling('minimaxai/minimax-m3', 0).temperature).toBe(0);
  });

  it('first-chunk timeout is longer than the inter-chunk timeout (cold-start tolerance)', () => {
    const a = new LlmAdapter({} as any);
    expect(a.firstChunkTimeoutMs).toBeGreaterThan(a.streamReadTimeoutMs);
  });
});
