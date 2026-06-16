import { ContextManager } from '../memory/context.manager';
import { LLMProvider, Message, ChatEvent } from '../core/llm.provider';
import { contentToText } from '../core/multimodal';

// The cheap passes never call the LLM; summarize uses this stub so we can assert it fired.
function summarizerLlm(marker = 'SUMMARY'): LLMProvider {
  return {
    async *chat(): AsyncGenerator<ChatEvent> {
      yield { type: 'token', text: marker } as ChatEvent;
    },
  };
}
const noopLlm: LLMProvider = { async *chat(): AsyncGenerator<ChatEvent> { /* nothing */ } };

function toolExchange(id: string, result: string): Message[] {
  return [
    { role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: 'Bash', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: id, content: result },
  ];
}

describe('ContextManager — layered passes (smart vs full)', () => {
  it('full mode is a no-op: history passes through untouched', async () => {
    const cm = new ContextManager(noopLlm, 100); // tiny window, but full mode ignores it
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      ...Array.from({ length: 10 }).flatMap((_, i) => toolExchange(`c${i}`, 'X'.repeat(2000))),
    ];
    const out = await cm.checkAndCompact(messages, 'full');
    expect(out).toBe(messages);
  });

  it('capToolResults truncates a single oversized tool result', async () => {
    const cm = new ContextManager(noopLlm);
    const huge = 'A'.repeat(40000);
    const messages: Message[] = [
      { role: 'user', content: 'go' },
      ...toolExchange('c1', huge),
    ];
    const out = await cm.checkAndCompact(messages, 'smart');
    const toolMsg = out.find(m => m.role === 'tool')!;
    expect(toolMsg.content!.length).toBeLessThan(huge.length);
    expect(toolMsg.content).toContain('chars elided');
  });

  it('micro-compact clears OLD tool results but keeps the last 6 intact', async () => {
    const cm = new ContextManager(noopLlm);
    const messages: Message[] = [
      { role: 'user', content: 'go' },
      ...Array.from({ length: 10 }).flatMap((_, i) => toolExchange(`c${i}`, `result-${i}`)),
    ];
    const out = await cm.checkAndCompact(messages, 'smart');
    const tools = out.filter(m => m.role === 'tool');
    expect(tools).toHaveLength(10); // none dropped — pairing preserved
    // First 4 cleared, last 6 kept.
    expect(tools.slice(0, 4).every(t => t.content === '[tool result cleared to save context]')).toBe(true);
    expect(tools.slice(-6).map(t => t.content)).toEqual(
      ['result-4', 'result-5', 'result-6', 'result-7', 'result-8', 'result-9'],
    );
  });

  it('micro-compact never breaks tool pairing (no orphaned tool messages)', async () => {
    const cm = new ContextManager(noopLlm);
    const messages: Message[] = [
      { role: 'user', content: 'go' },
      ...Array.from({ length: 8 }).flatMap((_, i) => toolExchange(`c${i}`, `r${i}`)),
    ];
    const out = await cm.checkAndCompact(messages, 'smart');
    // Every tool message is still immediately preceded by an assistant tool_calls turn.
    out.forEach((m, i) => {
      if (m.role === 'tool') {
        expect(out[i - 1].role).toBe('assistant');
        expect(out[i - 1].tool_calls).toBeDefined();
      }
    });
  });

  it('summarizes under token pressure after the cheap passes', async () => {
    // Tiny window forces the threshold; many sizeable text turns guarantee we stay over it.
    const cm = new ContextManager(summarizerLlm('SUMMARY'), 200);
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      ...Array.from({ length: 20 }).map((_, i) => ({ role: 'user', content: `message number ${i} ` + 'word '.repeat(50) } as Message)),
    ];
    const out = await cm.checkAndCompact(messages, 'smart');
    expect(out.some(m => m.role === 'system' && contentToText(m.content).includes('SUMMARY'))).toBe(true);
    expect(out.length).toBeLessThan(messages.length);
  });

  it('scales the summarize threshold to the configured context window', async () => {
    const bigText = 'word '.repeat(400); // ~400 tokens per message
    // >15 messages so compact() has "older" turns beyond the protected last-15 to summarize.
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      ...Array.from({ length: 20 }).map((_, i) => ({ role: 'user', content: `m${i} ${bigText}` } as Message)),
    ];
    // Tiny window → over 70% → must summarize.
    const small = await new ContextManager(summarizerLlm('S'), 1000).checkAndCompact([...messages], 'smart');
    expect(small.some(m => m.role === 'system' && contentToText(m.content).includes('S'))).toBe(true);
    // Huge window → well under threshold → no summary, history intact.
    const big = await new ContextManager(summarizerLlm('S'), 1_000_000).checkAndCompact([...messages], 'smart');
    expect(big.some(m => m.role === 'system' && contentToText(m.content).includes('S'))).toBe(false);
  });

  it('treats a 0/invalid window as the safe 128k default', async () => {
    const cm = new ContextManager(noopLlm, 0);
    // A modest history must NOT trip compaction under the 128k default.
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      ...Array.from({ length: 5 }).map((_, i) => ({ role: 'user', content: `m${i} ` + 'word '.repeat(100) } as Message)),
    ];
    const out = await cm.checkAndCompact(messages, 'smart');
    expect(out).toEqual(messages);
  });

  it('leaves a small conversation alone', async () => {
    const cm = new ContextManager(noopLlm);
    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
    ];
    const out = await cm.checkAndCompact(messages, 'smart');
    expect(out).toEqual(messages);
  });
});
