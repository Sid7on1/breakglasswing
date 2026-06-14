import { AgentLoop } from '../core/agent.loop';
import { ToolRegistry } from '../tools/tool.registry';
import { LLMProvider, ChatEvent, Message } from '../core/llm.provider';

/**
 * End-to-end: when the model writes a tool call as plain text instead of using the
 * function-calling API, the loop must recover it, execute the real tool, and carry
 * on to produce the follow-up answer.
 */
describe('AgentLoop — recovers and executes a text-emitted tool call', () => {
  it('parses the leaked JSON, runs the tool, and continues the loop', async () => {
    let executedWith: any = null;
    const registry = new ToolRegistry();
    registry.register({
      name: 'WriteFileTool',
      description: 'writes a file',
      schema: {},
      isDestructive: false,
      isConcurrencySafe: true,
      execute: async (args: any) => { executedWith = args; return 'OK: file written'; },
    } as any);

    // Turn 1: emit a tool call as text. Turn 2 (after the tool result): real answer.
    let call = 0;
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        call++;
        if (call === 1) {
          yield { type: 'token', text: 'The final answer is {"name": "WriteFileTool", "parameters": {"path": "/tmp/x", "content": "working"}}.' };
        } else {
          yield { type: 'token', text: 'Done — the file is written.' };
        }
        yield { type: 'done' };
      },
    };

    const loop = new AgentLoop(mockLlm, registry, null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'create the file' }], 'sys', { maxIterations: 5 })) {
      out += t;
    }

    // The recovered call actually executed with the parsed arguments.
    expect(executedWith).toEqual({ path: '/tmp/x', content: 'working' });
    // The loop continued past the tool result to the real answer.
    expect(out).toContain('Done');

    // History is well-formed and clean: an assistant tool_calls message, a tool
    // result, then the final assistant answer — and no raw tool JSON persisted.
    const assistantWithToolCalls = loop.messages.find(m => m.role === 'assistant' && m.tool_calls?.length);
    expect(assistantWithToolCalls?.tool_calls?.[0].function.name).toBe('WriteFileTool');
    expect(loop.messages.some(m => m.role === 'tool')).toBe(true);
    const finalAssistant = [...loop.messages].reverse().find(m => m.role === 'assistant');
    expect(finalAssistant?.content).toContain('Done');
    expect(loop.messages.some(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('"name"'))).toBe(false);
  });
});

/**
 * A transient provider/model error (stalled stream, 5xx, one malformed tool-call
 * emission) must not kill the task: the loop discards the partial turn and re-asks,
 * up to a bound. Past the bound it surfaces the error instead of spinning.
 */
describe('AgentLoop — retries transient errors then gives up', () => {
  it('re-asks after a transient error and completes on the next attempt', async () => {
    let call = 0;
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        call++;
        if (call === 1) {
          yield { type: 'error', message: '400 Unterminated string', recoverable: true, kind: 'transient' };
        } else {
          yield { type: 'token', text: 'Recovered and answered.' };
          yield { type: 'done' };
        }
      },
    };

    const loop = new AgentLoop(mockLlm, new ToolRegistry(), null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'hi' }], 'sys', { maxIterations: 5 })) {
      out += t;
    }

    expect(call).toBe(2); // retried exactly once
    expect(out).toContain('Retrying (1/2)');
    expect(out).toContain('Recovered and answered.');
  });

  it('aborts after exhausting the transient retry budget', async () => {
    let call = 0;
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        call++;
        yield { type: 'error', message: 'Stream read timeout', recoverable: true, kind: 'transient' };
      },
    };

    const loop = new AgentLoop(mockLlm, new ToolRegistry(), null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'hi' }], 'sys', { maxIterations: 10 })) {
      out += t;
    }

    // Initial attempt + 2 retries, then the fatal surface — never an infinite spin.
    expect(call).toBe(3);
    expect(out).toContain('API Error');
  });
});
