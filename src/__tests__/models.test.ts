import { MODEL_CATALOG, modelMenuOptions, DEFAULT_CODING_MODEL, DEFAULT_LITE_MODEL, autoSelectCandidates, isReasoningModel } from '../cli/models';

describe('model catalog', () => {
  it('includes the verified working models across tiers', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    // Every recommended NIM id was probed live 2026-07-19 (hi + tool call + vision call). The
    // qwen3.5 pair is the default work/quick/vision family; gpt-oss-120b and mistral-small-4 are
    // fast probed alternatives. Models that timed out or 404'd for a free account that day are
    // deliberately NOT recommended (asserted below).
    expect(ids).toEqual(expect.arrayContaining([
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia/nemotron-3-nano-30b-a3b',
      'meta/llama-3.1-8b-instruct',
      'mistralai/mistral-small-4-119b-2603', 'qwen/qwen3.5-397b-a17b', 'z-ai/glm-5.2',
      'deepseek-ai/deepseek-v4-pro', 'openai/gpt-oss-120b', 'minimaxai/minimax-m3', 'stepfun-ai/step-3.7-flash',
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
    // DeepSeek V4 Pro is retained as an explicit opt-in; these unverified variants stay hidden.
    for (const bad of ['deepseek-ai/deepseek-v4-flash', 'google/gemma-4-31b-it']) {
      expect(ids).not.toContain(bad);
    }
    expect(ids).toContain('moonshotai/kimi-k2.6');
  });

  it('defaults are valid catalog entries', () => {
    const ids = MODEL_CATALOG.map(m => m.value);
    expect(ids).toContain(DEFAULT_CODING_MODEL);
    expect(ids).toContain(DEFAULT_LITE_MODEL);
  });

  it('no default points at a model the healer is forbidden to choose', () => {
    // A default that is avoidAutoSelect is self-contradictory: it ships every new config pointing
    // at a model we have already decided is too unreliable to select on a user's behalf.
    const avoided = new Set(MODEL_CATALOG.filter(m => m.avoidAutoSelect).map(m => m.value));
    expect(avoided.has(DEFAULT_CODING_MODEL)).toBe(false);
    expect(avoided.has(DEFAULT_LITE_MODEL)).toBe(false);
  });

  it('the shipped config defaults ARE the catalog defaults, and are all selectable', () => {
    // Two files held the same three model ids and drifted apart: the catalog still advertised
    // mistral-nemotron as the default Work model long after config.ts had abandoned it for
    // declaring no Function Calling, while config.ts shipped step-3.7-flash and
    // nemotron-3-nano-omni — both of which the catalog flags avoidAutoSelect from live probes.
    //
    // That drift is not cosmetic. The failover path (core/agent.loop.ts fallbackModelFor) consults
    // the CATALOG to decide whether a model is safe to select automatically, so a default the
    // catalog silently disagrees with is handed to every new user while the guard reports itself
    // satisfied. Asserting the agreement is what keeps one of these edits from moving alone.
    const { DEFAULTS } = require('../cli/config') as typeof import('../cli/config');
    const avoided = new Set(MODEL_CATALOG.filter(m => m.avoidAutoSelect).map(m => m.value));

    expect(DEFAULTS.model).toBe(DEFAULT_CODING_MODEL);
    expect(DEFAULTS.liteModel).toBe(DEFAULT_LITE_MODEL);

    for (const [slot, id] of Object.entries({
      model: DEFAULTS.model, liteModel: DEFAULTS.liteModel, visionModel: DEFAULTS.visionModel,
    })) {
      expect(MODEL_CATALOG.map(m => m.value)).toContain(id); // a default must be a real catalog id
      expect({ slot, avoided: avoided.has(id) }).toEqual({ slot, avoided: false });
    }
  });

  it('the quick-slot default is a plain model, never a reasoner', () => {
    // The slot exists to answer "hi" instantly. This is the rule the catalog states for itself;
    // it regressed once already when the default was set to a reasoning model.
    expect(isReasoningModel(DEFAULT_LITE_MODEL)).toBe(false);
  });

  it('modelMenuOptions marks the current model and carries category labels', () => {
    const opts = modelMenuOptions('mistralai/mistral-small-4-119b-2603');
    const cur = opts.find(o => o.value === 'mistralai/mistral-small-4-119b-2603');
    expect(cur!.label.startsWith('●')).toBe(true);
    expect(opts.every(o => typeof o.category === 'string' && o.category.length > 0)).toBe(true);
  });
});

// The auto-selection policy the self-healer uses when a configured model has gone stale. Every
// case here is a property of the policy, not a pinned model id, so re-probing the catalog and
// changing which models are recommended cannot silently invalidate these.
describe('autoSelectCandidates — what the healer is allowed to pick for you', () => {
  const allIds = MODEL_CATALOG.map(m => m.value);

  it('only ever offers models the provider actually serves', () => {
    const served = ['openai/gpt-oss-120b', 'stepfun-ai/step-3.7-flash'];
    for (const slot of ['coding', 'lite', 'vision'] as const) {
      expect(autoSelectCandidates(slot, served).every(id => served.includes(id))).toBe(true);
    }
  });

  it('never auto-picks a model flagged avoidAutoSelect, even when it is the only one served', () => {
    const avoided = MODEL_CATALOG.filter(m => m.avoidAutoSelect).map(m => m.value);
    expect(avoided.length).toBeGreaterThan(0); // guard: the flag must actually be in use
    for (const slot of ['coding', 'lite', 'vision'] as const) {
      expect(autoSelectCandidates(slot, avoided)).toEqual([]);
    }
  });

  it('returns nothing rather than picking an arbitrary provider id', () => {
    // The regression this encodes: the old healer used servedIds[0], which on NVIDIA is
    // "01-ai/yi-large" — listed by /models but a 404 on chat/completions. An empty result is the
    // correct answer, so the caller can leave the pin alone and tell the user to run /model.
    expect(autoSelectCandidates('coding', ['01-ai/yi-large', 'some/unknown-model'])).toEqual([]);
    expect(autoSelectCandidates('coding', [])).toEqual([]);
  });

  it('prefers a model from the requested slot over one borrowed from another slot', () => {
    const visionOnly = MODEL_CATALOG.find(m => m.tier === 'vision' && !m.avoidAutoSelect)!.value;
    const codingOnly = MODEL_CATALOG.find(m => m.tier === 'coding' && !m.avoidAutoSelect)!.value;
    expect(autoSelectCandidates('coding', [visionOnly, codingOnly])[0]).toBe(codingOnly);
  });

  it('still borrows from another slot rather than leaving a slot unhealed', () => {
    const visionOnly = MODEL_CATALOG.find(m => m.tier === 'vision' && !m.avoidAutoSelect)!.value;
    expect(autoSelectCandidates('coding', [visionOnly])).toEqual([visionOnly]);
  });

  it('ranks plain models above reasoning models within the quick slot', () => {
    // The quick slot exists to answer "hi" instantly; a reasoner there hides 20-30s of thought.
    // The ordering guarantee applies to the slot's OWN models — models borrowed from another slot
    // are a last resort and keep catalog order, so they are excluded here.
    const inSlot = new Set(MODEL_CATALOG.filter(m => m.tier === 'lite').map(m => m.value));
    const quick = autoSelectCandidates('lite', allIds).filter(id => inSlot.has(id));
    const firstReasoner = quick.findIndex(isReasoningModel);
    const lastPlain = quick.map(isReasoningModel).lastIndexOf(false);
    if (firstReasoner !== -1 && lastPlain !== -1) expect(lastPlain).toBeLessThan(firstReasoner);
  });

  it('a served plain quick model outranks a served quick reasoner', () => {
    const plain = MODEL_CATALOG.find(m => m.tier === 'lite' && !m.avoidAutoSelect && !isReasoningModel(m.value))?.value;
    const reasoner = MODEL_CATALOG.find(m => m.tier === 'lite' && !m.avoidAutoSelect && isReasoningModel(m.value))?.value;
    if (plain && reasoner) expect(autoSelectCandidates('lite', [reasoner, plain])[0]).toBe(plain);
  });

  it('produces no duplicates', () => {
    const out = autoSelectCandidates('coding', allIds);
    expect(out.length).toBe(new Set(out).size);
  });
});
