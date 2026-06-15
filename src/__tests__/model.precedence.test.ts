import { LlmAdapter } from '../core/llm.adapter';

// Regression: /model appeared to do nothing because a key's baked-in provider-default model
// shadowed the user's choice. applyConfig({model}) must record an explicit override (userModel)
// that pickModel prefers. We can't call the private pickModel directly, so assert the field wiring.
describe('LlmAdapter — explicit model override (the /model fix)', () => {
  it('applyConfig({model}) sets userModel so the choice wins over the key default', () => {
    const a = new LlmAdapter({} as any);
    a.applyConfig({ model: 'zai/glm-5.1' });
    expect(a.userModel).toBe('zai/glm-5.1');
    expect(a.defaultModel).toBe('zai/glm-5.1');
  });

  it('liteModel is tracked separately from the coding model', () => {
    const a = new LlmAdapter({} as any);
    a.applyConfig({ model: 'minimaxai/minimax-m3', liteModel: 'meta/llama-3.1-70b-instruct' });
    expect(a.userModel).toBe('minimaxai/minimax-m3');
    expect(a.liteModel).toBe('meta/llama-3.1-70b-instruct');
  });
});
