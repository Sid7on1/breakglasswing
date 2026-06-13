import { ContextManager } from '../memory/context.manager';
import { LLMProvider, Message, ChatEvent } from '../core/llm.provider';

// reactiveCompact never calls the LLM, so a no-op provider is enough here.
const noopLlm: LLMProvider = {
  async *chat(): AsyncGenerator<ChatEvent> { /* nothing */ },
};

describe('ContextManager.reactiveCompact — tool-pairing safety', () => {
  const cm = new ContextManager(noopLlm);
  const ctxError = new Error('This model maximum context length is 8000 tokens');

  it('never lets the kept window begin with an orphaned tool result', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'do the thing' },
      { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Bash', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'result-1' },
      { role: 'tool', tool_call_id: 'c2', content: 'result-2' },
      { role: 'assistant', content: 'partial' },
      { role: 'user', content: 'next' },
      { role: 'assistant', content: 'final' },
    ];

    const out = await cm.reactiveCompact(messages, ctxError);
    const firstNonSystem = out.find(m => m.role !== 'system');
    // The slice(-5) window would have started on the two orphan tool results;
    // those must be dropped so the first kept message isn't a dangling tool reply.
    expect(firstNonSystem?.role).not.toBe('tool');
    expect(out.some(m => m.role === 'tool' && m.content === 'result-1')).toBe(false);
  });

  it('re-throws errors that are not context-length related', async () => {
    await expect(cm.reactiveCompact([], new Error('network down'))).rejects.toThrow('network down');
  });
});
