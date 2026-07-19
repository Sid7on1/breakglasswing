import { MODEL_CATALOG, modelMenuOptions, DEFAULT_CODING_MODEL, DEFAULT_LITE_MODEL } from '../cli/models';

describe('model catalog', () => {
  it('includes the verified working models across tiers', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    // Every recommended NIM id was probed live 2026-07-19 (hi + tool call + vision call). The
    // qwen3.5 pair is the default work/quick/vision family; gpt-oss-120b and mistral-small-4 are
    // fast probed alternatives. Models that timed out or 404'd for a free account that day are
    // deliberately NOT recommended (asserted below).
    expect(ids).toEqual(expect.arrayContaining([
      'mistralai/mistral-small-4-119b-2603', 'qwen/qwen3.5-397b-a17b', 'z-ai/glm-5.2',
      'openai/gpt-oss-120b', 'minimaxai/minimax-m3', 'stepfun-ai/step-3.7-flash',
      'qwen/qwen3.5-122b-a10b', 'nvidia/nemotron-nano-12b-v2-vl', 'sarvamai/sarvam-m',
    ]));
    expect(ids).not.toContain('stepfun-ai/step-3.5-flash'); // invalid on NIM
    expect(MODEL_CATALOG.some(m => m.tier === 'coding')).toBe(true);
    expect(MODEL_CATALOG.some(m => m.tier === 'lite')).toBe(true);
    expect(MODEL_CATALOG.some(m => m.tier === 'vision')).toBe(true);
  });

  it('uses the correct GLM publisher slug (z-ai, not zai) and omits models that failed the probe', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    expect(ids).toContain('z-ai/glm-5.2');
    expect(ids).not.toContain('zai/glm-5.2'); // the 404 typo
    // 2026-07-19: timed out (90s+ cold) or 404'd for a free NIM account — kept out of the picker.
    for (const bad of ['deepseek-ai/deepseek-v4-pro', 'deepseek-ai/deepseek-v4-flash', 'google/gemma-4-31b-it']) {
      expect(ids).not.toContain(bad);
    }
    expect(ids).toContain('moonshotai/kimi-k2.6');
  });

  it('defaults are valid catalog entries', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    expect(ids).toContain(DEFAULT_CODING_MODEL);
    expect(ids).toContain(DEFAULT_LITE_MODEL);
  });

  it('modelMenuOptions marks the current model and carries category labels', () => {
    const opts = modelMenuOptions('mistralai/mistral-small-4-119b-2603');
    const cur = opts.find(o => o.value === 'mistralai/mistral-small-4-119b-2603');
    expect(cur!.label.startsWith('●')).toBe(true);
    expect(opts.every(o => typeof o.category === 'string' && o.category.length > 0)).toBe(true);
  });
});
