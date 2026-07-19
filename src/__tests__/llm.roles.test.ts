import { normalizeNvidiaMessages, selectRequestModel } from '../core/llm.adapter';
import { Message } from '../core/llm.provider';

describe('normalizeNvidiaMessages', () => {
  it('consolidates every interleaved system message at the request head', () => {
    const messages: Message[] = [
      { role: 'system', content: 'base rules' },
      { role: 'user', content: 'first task' },
      { role: 'assistant', content: 'done' },
      { role: 'system', content: '[TurnContext] latest context' },
      { role: 'user', content: 'second task' },
    ];

    const out = normalizeNvidiaMessages(messages);

    expect(out.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(out[0].content).toContain('base rules');
    expect(out[0].content).toContain('[TurnContext] latest context');
    expect(out.slice(1).some(m => m.role === 'system')).toBe(false);
  });

  it('bridges a tool result before a fresh screenshot user turn', () => {
    const messages: Message[] = [
      { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ComputerTool', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
      { role: 'system', content: '[RepoMap] refreshed' },
      { role: 'user', content: [{ type: 'text', text: '[BrowserScreenshot]' }] as any },
    ];

    const out = normalizeNvidiaMessages(messages);

    expect(out.map(m => m.role)).toEqual(['system', 'assistant', 'tool', 'assistant', 'user']);
    expect(out.some((m, i) => i > 0 && m.role === 'system')).toBe(false);
    expect(out.some((m, i) => m.role === 'user' && out[i - 1]?.role === 'tool')).toBe(false);
  });
});

describe('selectRequestModel', () => {
  it('routes a GLM screenshot turn to the configured Vision model', () => {
    expect(selectRequestModel(
      'z-ai/glm-5.2',
      'mistralai/mistral-small-4-119b-2603',
      true,
      'nvidia',
    )).toBe('mistralai/mistral-small-4-119b-2603');
  });

  it('keeps non-image work on GLM', () => {
    expect(selectRequestModel(
      'z-ai/glm-5.2',
      'mistralai/mistral-small-4-119b-2603',
      false,
      'nvidia',
    )).toBe('z-ai/glm-5.2');
  });
});
