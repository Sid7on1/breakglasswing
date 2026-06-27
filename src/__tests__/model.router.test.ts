import { heuristicTier, decideTier, applyBrief, clearClassifierCache } from '../cli/model.router';

describe('model.router — heuristicTier', () => {
  it('short-circuits obvious chat/acks to lite (no LLM)', () => {
    for (const p of ['hi', 'hey', 'thanks!', 'ok', 'cool', 'yeah', 'got it']) {
      expect(heuristicTier(p)).toBe('lite');
    }
  });

  it('does not short-circuit a real task that merely starts chatty', () => {
    expect(heuristicTier('ok now refactor the parser to support async')).toBeNull();
    expect(heuristicTier('fix the failing tests in src/engine')).toBeNull();
  });

  it('empty input is lite', () => {
    expect(heuristicTier('   ')).toBe('lite');
  });
});

describe('model.router — decideTier', () => {
  const fakeLlm = (reply: string) => ({ chatCompletion: jest.fn().mockResolvedValue(reply) }) as any;

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
    const llm = { chatCompletion: jest.fn().mockRejectedValue(new Error('boom')) } as any;
    const d = await decideTier(llm, 'do something ambiguous and long enough to pass the heuristic', null);
    expect(d).toEqual({ tier: 'lite', via: 'fallback' });
  });
});

describe('model.router — classifier cache', () => {
  const fakeLlm = (reply: string) => ({ chatCompletion: jest.fn().mockResolvedValue(reply) }) as any;
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
    const llm = { chatCompletion: jest.fn().mockRejectedValue(new Error('boom')) } as any;
    const p = 'an ambiguous request long enough to pass the heuristic gate';
    const a = await decideTier(llm, p, null);
    const b = await decideTier(llm, p, null);
    expect(a.via).toBe('fallback');
    expect(b.via).toBe('fallback');
    expect(llm.chatCompletion).toHaveBeenCalledTimes(2); // retried, not served stale from cache
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
