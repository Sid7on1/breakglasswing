import { MODEL_CATALOG, modelMenuOptions, DEFAULT_CODING_MODEL, DEFAULT_LITE_MODEL } from '../cli/models';

describe('model catalog', () => {
  it('includes the curated models across tiers', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    expect(ids).toEqual(expect.arrayContaining([
      'minimaxai/minimax-m3', 'deepseek-ai/deepseek-v4-pro', 'zai/glm-5.1',
      'deepseek-ai/deepseek-v4-flash', 'minimaxai/minimax-m2.7', 'sarvamai/sarvam-m',
    ]));
    expect(MODEL_CATALOG.some(m => m.tier === 'coding')).toBe(true);
    expect(MODEL_CATALOG.some(m => m.tier === 'lite')).toBe(true);
  });

  it('defaults are valid catalog entries', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    expect(ids).toContain(DEFAULT_CODING_MODEL);
    expect(ids).toContain(DEFAULT_LITE_MODEL);
  });

  it('modelMenuOptions marks the current model and carries category labels', () => {
    const opts = modelMenuOptions('zai/glm-5.1');
    const cur = opts.find(o => o.value === 'zai/glm-5.1');
    expect(cur!.label.startsWith('●')).toBe(true);
    expect(opts.every(o => typeof o.category === 'string' && o.category.length > 0)).toBe(true);
  });
});
