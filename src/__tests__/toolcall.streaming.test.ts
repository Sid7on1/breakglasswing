import { applyToolCallDelta, ToolCallSlot } from '../core/llm.adapter';

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
});
