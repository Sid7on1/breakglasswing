import { heuristicTier, decideTier, applyBrief, clearClassifierCache, isConversational } from '../cli/model.router';

describe('model.router — heuristicTier', () => {
  it('short-circuits obvious chat/acks to lite (no LLM)', () => {
    for (const p of ['hi', 'hey', 'thanks!', 'ok', 'cool', 'yeah', 'got it']) {
      expect(heuristicTier(p)).toBe('lite');
    }
  });

  it('never routes a real task to lite just because it starts chatty', () => {
    expect(heuristicTier('ok now refactor the parser to support async')).not.toBe('lite');
    expect(heuristicTier('fix the failing tests in src/engine')).not.toBe('lite');
  });

  it('routes unmistakable coding work straight to heavy (no LLM)', () => {
    expect(heuristicTier('refactor the parser to support async')).toBe('heavy');
    expect(heuristicTier('implement retry logic in the fetch layer')).toBe('heavy');
    expect(heuristicTier('fix the bug in session loading')).toBe('heavy');
    expect(heuristicTier('debug why startup hangs')).toBe('heavy');
  });

  it('routes code fences and stack traces straight to heavy', () => {
    expect(heuristicTier('why does this fail?\n```js\nconst x = await y;\n```')).toBe('heavy');
    expect(heuristicTier('crash:\nTypeError: boom\n    at run (/app/src/main.ts:10:3)')).toBe('heavy');
  });

  it('leaves ambiguous prompts to the classifier', () => {
    expect(heuristicTier('please rework the tokenizer to stream')).toBeNull();
    expect(heuristicTier('what does the governor do here')).toBeNull();
  });

  it('empty input is lite', () => {
    expect(heuristicTier('   ')).toBe('lite');
  });
});

// The mocks carry DISTINCT coding/lite models so the heuristic + classifier paths are exercised;
// when the two slots resolve to the same model, decideTier short-circuits via 'unified' (tested below).
describe('model.router — decideTier', () => {
  const fakeLlm = (reply: string) => ({ userModel: 'big/coding-model', liteModel: 'small/lite-model', chatCompletion: jest.fn().mockResolvedValue(reply) }) as any;

  it('a manual pin wins outright, no classifier call', async () => {
    const llm = fakeLlm('{"tier":"lite"}');
    const d = await decideTier(llm, 'refactor everything', 'heavy');
    expect(d).toEqual({ tier: 'heavy', via: 'pinned' });
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('obvious chat resolves via heuristic without the classifier', async () => {
    const llm = fakeLlm('{"tier":"heavy"}');
    const d = await decideTier(llm, 'hi', null);
    expect(d.tier).toBe('lite');
    expect(d.via).toBe('heuristic');
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('escalates via the lite classifier and carries the brief', async () => {
    const llm = fakeLlm('```json\n{"tier":"heavy","brief":"refactor the tokenizer"}\n```');
    const d = await decideTier(llm, 'please rework the tokenizer to stream', null);
    expect(d.tier).toBe('heavy');
    expect(d.brief).toBe('refactor the tokenizer');
    expect(d.via).toBe('classifier');
  });

  it('falls back to lite if the classifier throws', async () => {
    const llm = { userModel: 'big/coding-model', liteModel: 'small/lite-model', chatCompletion: jest.fn().mockRejectedValue(new Error('boom')) } as any;
    const d = await decideTier(llm, 'do something ambiguous and long enough to pass the heuristic', null);
    expect(d).toEqual({ tier: 'lite', via: 'fallback' });
  });
});

describe('model.router — unified single-model short-circuit', () => {
  it('skips heuristic AND classifier when both slots resolve to the same model', async () => {
    const llm = { userModel: 'stepfun-ai/step-3.7-flash', liteModel: 'stepfun-ai/step-3.7-flash', chatCompletion: jest.fn() } as any;
    const d = await decideTier(llm, 'refactor the parser to support async', null); // heavy-verb prompt — still unified
    expect(d).toEqual({ tier: 'lite', via: 'unified' });
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('short-circuits when no lite model is configured at all', async () => {
    const llm = { userModel: 'stepfun-ai/step-3.7-flash', liteModel: undefined, chatCompletion: jest.fn() } as any;
    const d = await decideTier(llm, 'please rework the tokenizer to stream', null);
    expect(d).toEqual({ tier: 'lite', via: 'unified' });
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('a manual pin still wins over unified', async () => {
    const llm = { userModel: 'same/model', liteModel: 'same/model', chatCompletion: jest.fn() } as any;
    const d = await decideTier(llm, 'anything', 'heavy');
    expect(d).toEqual({ tier: 'heavy', via: 'pinned' });
  });
});

describe('model.router — classifier cache', () => {
  const fakeLlm = (reply: string) => ({ userModel: 'big/coding-model', liteModel: 'small/lite-model', chatCompletion: jest.fn().mockResolvedValue(reply) }) as any;
  beforeEach(() => clearClassifierCache());

  it('serves a repeated prompt from cache without re-calling the classifier', async () => {
    const llm = fakeLlm('{"tier":"heavy","brief":"rework streaming"}');
    const p = 'rework the streaming pipeline end to end';
    const first = await decideTier(llm, p, null);
    const second = await decideTier(llm, p, null);
    expect(first.via).toBe('classifier');
    expect(second.via).toBe('cache');
    expect(second.tier).toBe('heavy');
    expect(second.brief).toBe('rework streaming');
    expect(llm.chatCompletion).toHaveBeenCalledTimes(1); // second hit skipped the LLM
  });

  it('normalizes whitespace/case so trivially-different prompts share a cache entry', async () => {
    const llm = fakeLlm('{"tier":"lite"}');
    await decideTier(llm, 'Reindex   The Project', null);
    const again = await decideTier(llm, 'reindex the project', null);
    expect(again.via).toBe('cache');
    expect(llm.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not cache a fallback (transient failure must not pin the route)', async () => {
    const llm = { userModel: 'big/coding-model', liteModel: 'small/lite-model', chatCompletion: jest.fn().mockRejectedValue(new Error('boom')) } as any;
    const p = 'an ambiguous request long enough to pass the heuristic gate';
    const a = await decideTier(llm, p, null);
    const b = await decideTier(llm, p, null);
    expect(a.via).toBe('fallback');
    expect(b.via).toBe('fallback');
    expect(llm.chatCompletion).toHaveBeenCalledTimes(2); // retried, not served stale from cache
  });
});

describe('model.router — isConversational (lite conversation lane gate)', () => {
  it('routes greetings, acks, and simple meta questions to the lite lane', () => {
    for (const p of ['hi', 'hey', 'thanks!', 'ok', 'cool', 'who are you', 'what can you do', 'how are you?']) {
      expect(isConversational(p)).toBe(true);
    }
  });

  it('NEVER routes real work to the lite lane (protects coding turns)', () => {
    for (const p of [
      'fix the bug in session loading',
      'refactor the parser',
      'what does this function do',        // needs to read code → full harness
      'read src/index.ts',                 // file path
      'look at @App.tsx',                  // @mention
      'summarize https://example.com',     // URL
      'why does this fail?\n```js\nx()\n```', // code context
      'ok now implement retry logic',      // starts chatty but is work
    ]) {
      expect(isConversational(p)).toBe(false);
    }
  });

  it('no hidden classifier call for a locally obvious greeting (the P0-3 gate)', async () => {
    // Distinct slot models so decideTier would normally reach the classifier — the greeting must
    // still resolve locally with zero chatCompletion calls.
    const llm = { userModel: 'big/coding-model', liteModel: 'small/lite-model', chatCompletion: jest.fn() } as any;
    expect(isConversational('hi')).toBe(true);
    const d = await decideTier(llm, 'hi', null);
    expect(d.via).toBe('heuristic');
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });
});

describe('model.router — applyBrief', () => {
  it('prepends the brief without altering the original prompt', () => {
    expect(applyBrief('add a route', 'wire up /health')).toBe('[Routing brief: wire up /health]\n\nadd a route');
  });
  it('returns the prompt unchanged when there is no brief', () => {
    expect(applyBrief('add a route')).toBe('add a route');
  });
});
