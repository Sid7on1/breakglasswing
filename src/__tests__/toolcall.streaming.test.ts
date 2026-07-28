import { applyToolCallDelta, finalizeToolCalls, hasMeaningfulStreamPayload, ToolCallSlot } from '../core/llm.adapter';

describe('hasMeaningfulStreamPayload — first-token attribution', () => {
  it('ignores transport preambles and usage-only frames', () => {
    expect(hasMeaningfulStreamPayload({ choices: [{ delta: { role: 'assistant' }, finish_reason: null }] })).toBe(false);
    expect(hasMeaningfulStreamPayload({ choices: [], usage: { prompt_tokens: 10 } })).toBe(false);
  });

  it.each([
    { choices: [{ delta: { content: 'hello' }, finish_reason: null }] },
    { choices: [{ delta: { reasoning_content: 'thinking' }, finish_reason: null }] },
    { choices: [{ delta: { reasoning: 'thinking' }, finish_reason: null }] },
    { choices: [{ delta: { tool_calls: [{ index: 0 }] }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ])('accepts content, reasoning, tool calls, and terminal frames', (chunk) => {
    expect(hasMeaningfulStreamPayload(chunk)).toBe(true);
  });
});

// Drive a sequence of streaming tool_call deltas through the accumulator and return the finished calls.
function accumulate(deltas: any[]): ToolCallSlot[] {
  const acc = new Map<number, ToolCallSlot>();
  for (const d of deltas) applyToolCallDelta(acc, d);
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s).filter(s => s.name);
}

describe('applyToolCallDelta — streaming tool-call accumulation', () => {
  it('assembles ONE complete call when the provider repeats id on every delta (minimax/NIM)', () => {
    // The bug: id present on each chunk was treated as a new call → truncated args.
    const out = accumulate([
      { index: 0, id: 'call_1', function: { name: 'WebSearchTool', arguments: '{"query": "' } },
      { index: 0, id: 'call_1', function: { arguments: 'richest person' } },
      { index: 0, id: 'call_1', function: { arguments: ' in the world"}' } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('WebSearchTool');
    expect(JSON.parse(out[0].args)).toEqual({ query: 'richest person in the world' });
  });

  it('assembles a call when id appears only on the first delta (standard OpenAI)', () => {
    const out = accumulate([
      { index: 0, id: 'call_a', function: { name: 'BashTool', arguments: '{"command":' } },
      { index: 0, function: { arguments: '"ls -la"}' } },
    ]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0].args)).toEqual({ command: 'ls -la' });
  });

  it('keeps parallel tool calls separate by index', () => {
    const out = accumulate([
      { index: 0, id: 'a', function: { name: 'ReadFileTool', arguments: '{"path":"a.ts"}' } },
      { index: 1, id: 'b', function: { name: 'ReadFileTool', arguments: '{"path":"b.ts"}' } },
    ]);
    expect(out.map(c => JSON.parse(c.args).path)).toEqual(['a.ts', 'b.ts']);
  });

  it('falls back to index 0 when the provider omits index', () => {
    const out = accumulate([
      { id: 'x', function: { name: 'GrepTool', arguments: '{"pattern":' } },
      { function: { arguments: '"todo"}' } },
    ]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0].args)).toEqual({ pattern: 'todo' });
  });

  // Framing verified live against NVIDIA NIM on 2026-07-27 (two calls, sixteen deltas): distinct
  // calls get distinct indices and each reassembles into valid JSON. These two guard the decoding
  // contract that observation established.
  it('reassembles each call from a real NVIDIA delta sequence into valid JSON', () => {
    const out = accumulate([
      { index: 0, id: 'tn3k9Eavm', function: { name: 'ComputerTool', arguments: '' } },
      { index: 0, function: { arguments: '{"action": "' } },
      { index: 0, function: { arguments: 'open' } },
      { index: 0, function: { arguments: '", "app": "' } },
      { index: 0, function: { arguments: 'Calculator' } },
      { index: 0, function: { arguments: '"}' } },
      { index: 1, id: 'kxe7ILNXg', function: { name: 'ComputerTool', arguments: '' } },
      { index: 1, function: { arguments: '{"action": "' } },
      { index: 1, function: { arguments: 'type", "text": "12*12"}' } },
    ]);

    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0].args)).toEqual({ action: 'open', app: 'Calculator' });
    expect(JSON.parse(out[1].args)).toEqual({ action: 'type', text: '12*12' });
    expect(out.map(c => c.id)).toEqual(['tn3k9Eavm', 'kxe7ILNXg']);
  });

  it('still treats a repeated id on a reused index as ONE call, not two', () => {
    // Guard against over-correcting: minimax/NIM repeat the id on every delta of a single call.
    const out = accumulate([
      { index: 0, id: 'call_1', function: { name: 'WebSearchTool', arguments: '{"query": "a' } },
      { index: 0, id: 'call_1', function: { arguments: 'b' } },
      { index: 0, id: 'call_1', function: { arguments: 'c"}' } },
    ]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0].args)).toEqual({ query: 'abc' });
  });

  it('keeps honouring real distinct indices when the provider uses them properly', () => {
    // Interleaved parallel calls on a well-behaved provider must not be re-keyed by the fix.
    const out = accumulate([
      { index: 0, id: 'a', function: { name: 'ReadFileTool', arguments: '{"path":' } },
      { index: 1, id: 'b', function: { name: 'BashTool', arguments: '{"command":' } },
      { index: 0, function: { arguments: '"a.ts"}' } },
      { index: 1, function: { arguments: '"ls"}' } },
    ]);
    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0].args)).toEqual({ path: 'a.ts' });
    expect(JSON.parse(out[1].args)).toEqual({ command: 'ls' });
  });
});

describe('finalizeToolCalls — output-ceiling truncation', () => {
  const acc = (...slots: Array<Partial<ToolCallSlot>>) => {
    const m = new Map<number, ToolCallSlot>();
    slots.forEach((s, i) => m.set(i, { id: `c${i}`, name: 'ComputerTool', args: '{}', ...s }));
    return m;
  };

  it('marks the call the model was still writing when the ceiling hit', () => {
    // The real emission: args cut mid-string, which the loop reported as the MODEL emitting
    // garbage. It is our output limit being reached, and the advice for the two differs.
    const out = finalizeToolCalls(acc({ args: '{"action": "click", "elementIndex": 14, "frameId": "f20-65050-67' }), 'length');
    expect(out).toHaveLength(1);
    expect(out[0].truncated).toBe(true);
    expect(() => JSON.parse(out[0].args)).toThrow();
  });

  it('marks only the LAST call — earlier ones completed before the model moved on', () => {
    const out = finalizeToolCalls(acc({ args: '{"a":1}' }, { args: '{"b":2}' }, { args: '{"c":' }), 'length');
    expect(out.map(c => !!c.truncated)).toEqual([false, false, true]);
  });

  it('marks nothing when the model stopped because it was done', () => {
    const out = finalizeToolCalls(acc({ args: '{"a":1}' }, { args: '{"b":2}' }), 'stop');
    expect(out.every(c => !c.truncated)).toBe(true);
  });

  it('keeps emission in index order and drops unnamed slots', () => {
    const m = new Map<number, ToolCallSlot>([
      [1, { id: 'b', name: 'BashTool', args: '{}' }],
      [0, { id: 'a', name: 'ReadFileTool', args: '{}' }],
      [2, { id: '', name: '', args: '' }],
    ]);
    expect(finalizeToolCalls(m, 'stop').map(c => c.name)).toEqual(['ReadFileTool', 'BashTool']);
  });
});
