import { ContextManager } from '../memory/context.manager';
import { Message } from '../core/llm.provider';

// reactiveCompact never calls the LLM, so a no-op provider is enough here.
const noopLlm: any = { chat: async function* () { /* never used */ } };

const history: Message[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'do the thing' },
  { role: 'assistant', content: 'ok' },
];

describe('ContextManager.reactiveCompact — overflow detection parity with classifyStreamError', () => {
  it('compacts on HTTP 413 even when the message text matches no known spelling', async () => {
    const cm = new ContextManager(noopLlm);
    const err: any = new Error('Request Entity Too Large');
    err.status = 413;
    const out = await cm.reactiveCompact(history, err);
    expect(out.some(m => String(m.content).includes('aggressively compacted'))).toBe(true);
  });

  it('compacts on code=context_length_exceeded (the agent loop tags classifier-detected overflows)', async () => {
    const cm = new ContextManager(noopLlm);
    const err: any = new Error('opaque provider text');
    err.code = 'context_length_exceeded';
    const out = await cm.reactiveCompact(history, err);
    expect(out.some(m => String(m.content).includes('aggressively compacted'))).toBe(true);
  });

  it('compacts on a "too large" message with no status/code attached', async () => {
    const cm = new ContextManager(noopLlm);
    const out = await cm.reactiveCompact(history, new Error('input is too large for this model'));
    expect(out.some(m => String(m.content).includes('aggressively compacted'))).toBe(true);
  });

  it('still rethrows genuinely non-context errors', async () => {
    const cm = new ContextManager(noopLlm);
    await expect(cm.reactiveCompact(history, new Error('network down'))).rejects.toThrow('network down');
  });
});
