import { MODEL_CATALOG, modelMenuOptions, DEFAULT_CODING_MODEL, DEFAULT_LITE_MODEL } from '../cli/models';

describe('model catalog', () => {
  it('includes the verified working models across tiers', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    // Only NIM-verified ids remain (see the 2026-06-15 probe).
    expect(ids).toEqual(expect.arrayContaining([
      'minimaxai/minimax-m3', 'stepfun-ai/step-3.7-flash',
      'meta/llama-3.1-70b-instruct', 'stepfun-ai/step-3.5-flash', 'sarvamai/sarvam-m',
    ]));
    expect(MODEL_CATALOG.some(m => m.tier === 'coding')).toBe(true);
    expect(MODEL_CATALOG.some(m => m.tier === 'lite')).toBe(true);
  });

  it('does not include the unverified ids that 404/timeout on NIM', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    for (const bad of ['zai/glm-5.1', 'deepseek-ai/deepseek-v4-pro', 'deepseek-ai/deepseek-v4-flash', 'minimaxai/minimax-m2.7', 'google/gemma-4-31b-it']) {
      expect(ids).not.toContain(bad);
    }
  });

  it('defaults are valid catalog entries', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    expect(ids).toContain(DEFAULT_CODING_MODEL);
    expect(ids).toContain(DEFAULT_LITE_MODEL);
  });

  it('modelMenuOptions marks the current model and carries category labels', () => {
    const opts = modelMenuOptions('minimaxai/minimax-m3');
    const cur = opts.find(o => o.value === 'minimaxai/minimax-m3');
    expect(cur!.label.startsWith('●')).toBe(true);
    expect(opts.every(o => typeof o.category === 'string' && o.category.length > 0)).toBe(true);
  });
});
