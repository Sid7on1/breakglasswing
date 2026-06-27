import { AgentLoop } from '../core/agent.loop';
import { ToolRegistry } from '../tools/tool.registry';
import { LLMProvider, ChatEvent, Message } from '../core/llm.provider';
import { cliEvents, ToolCallEntry } from '../cli/events';

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
 * C3 live tool-arg streaming: a `tool_call_partial` event must surface as a live "running" tool
 * entry on the UI bus (so the call shows as it forms) WITHOUT being executed — only the final
 * authoritative `tool_call` runs the tool.
 */
describe('AgentLoop — live tool-arg streaming (tool_call_partial)', () => {
  it('emits a running tool_call for the partial without executing it', async () => {
    let execCount = 0;
    const registry = new ToolRegistry();
    registry.register({
      name: 'WriteFileTool', description: 'writes', schema: {},
      isDestructive: false, isConcurrencySafe: true,
      execute: async () => { execCount++; return 'OK'; },
    } as any);

    let call = 0;
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        call++;
        if (call === 1) {
          yield { type: 'tool_call_partial', id: 'tc1', name: 'WriteFileTool', args: '{"path":"/tmp/' };
          yield { type: 'tool_call_partial', id: 'tc1', name: 'WriteFileTool', args: '{"path":"/tmp/x","content":"hi"}' };
          yield { type: 'tool_call', id: 'tc1', name: 'WriteFileTool', args: '{"path":"/tmp/x","content":"hi"}' };
          yield { type: 'done' };
        } else {
          yield { type: 'token', text: 'Done.' };
          yield { type: 'done' };
        }
      },
    };

    const seen: ToolCallEntry[] = [];
    const onCall = (c: ToolCallEntry) => seen.push(c);
    cliEvents.on('tool_call', onCall);
    try {
      const loop = new AgentLoop(mockLlm, registry, null as any);
      // eslint-disable-next-line no-empty
      for await (const _ of loop.execute([{ role: 'user', content: 'go' }], 'sys', { maxIterations: 2 })) {}
    } finally {
      cliEvents.off('tool_call', onCall);
    }

    // The partials surfaced as running entries (live activity) with the growing args...
    const running = seen.filter(c => c.id === 'tc1' && c.status === 'running');
    expect(running.length).toBeGreaterThanOrEqual(2);
    expect(running.some(c => c.input === '{"path":"/tmp/')).toBe(true);
    // ...and the tool executed exactly once (driven by the final tool_call, not the partials).
    expect(execCount).toBe(1);
  });
});

/**
 * A turn that produces nothing visible — no streamed text, no tool call, not pure filler
 * (e.g. a coding model that emitted only `reasoning_content` then ended empty, or a model
 * that went silent right after a tool result) must not leave the user staring at a stopped
 * spinner. The loop nudges once for a direct answer; bounded so it can't spin.
 */
describe('AgentLoop — recovers from a silent empty turn', () => {
  it('nudges once when a turn is completely empty, then completes', async () => {
    let call = 0;
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        call++;
        if (call === 1) {
          // Only reasoning, no visible content, no tool call — collapses to empty.
          yield { type: 'thinking', text: 'hmm let me think' };
          yield { type: 'done' };
        } else {
          yield { type: 'token', text: 'Here is the actual answer.' };
          yield { type: 'done' };
        }
      },
    };

    const loop = new AgentLoop(mockLlm, new ToolRegistry(), null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'do it' }], 'sys', { maxIterations: 5 })) {
      out += t;
    }

    expect(call).toBe(2); // nudged exactly once
    expect(out).toContain('Here is the actual answer.');
    // The nudge was injected as a user message so the model re-answers.
    expect(loop.messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('empty response'))).toBe(true);
  });

  it('surfaces a visible note rather than dead silence if it stays empty', async () => {
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        // Always empty — exhausts the single empty-turn retry.
        yield { type: 'done' };
      },
    };

    const loop = new AgentLoop(mockLlm, new ToolRegistry(), null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'do it' }], 'sys', { maxIterations: 5 })) {
      out += t;
    }

    // Never silent — the user gets a note explaining no response came back.
    expect(out).toContain('No response was produced');
  });
});

/**
 * Cooperative cancellation: when the front-end interrupts a turn, the loop must stop at the next
 * safe boundary — it must not start the next tool batch and must not begin another iteration.
 */
describe('AgentLoop — honors an AbortSignal', () => {
  it('does not execute tools once the signal is aborted mid-stream', async () => {
    let execCount = 0;
    const registry = new ToolRegistry();
    registry.register({
      name: 'WriteFileTool', description: 'writes', schema: {},
      isDestructive: false, isConcurrencySafe: true,
      execute: async () => { execCount++; return 'OK'; },
    } as any);

    const ctrl = new AbortController();
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        // The user interrupts while the model is still streaming its tool-call turn.
        yield { type: 'token', text: 'starting…' };
        ctrl.abort();
        yield { type: 'tool_call', id: 'tc1', name: 'WriteFileTool', args: '{"path":"/tmp/x","content":"hi"}' };
        yield { type: 'done' };
      },
    };

    const loop = new AgentLoop(mockLlm, registry, null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'go' }], 'sys', { maxIterations: 5, signal: ctrl.signal })) {
      out += t;
    }

    // The turn stopped before the tool ran, and the loop didn't spin into another iteration.
    expect(execCount).toBe(0);
    expect(out).toContain('starting…');
  });

  it('does not start a new iteration when aborted between turns', async () => {
    let calls = 0;
    const ctrl = new AbortController();
    const mockLlm: LLMProvider = {
      async *chat(): AsyncGenerator<ChatEvent> {
        calls++;
        ctrl.abort(); // abort right after the first turn's stream opens
        yield { type: 'token', text: 'partial' };
        yield { type: 'done' };
      },
    };

    const loop = new AgentLoop(mockLlm, new ToolRegistry(), null as any);
    // eslint-disable-next-line no-empty
    for await (const _ of loop.execute([{ role: 'user', content: 'go' }], 'sys', { maxIterations: 5, signal: ctrl.signal })) {}

    expect(calls).toBe(1); // never looped back for a second model call
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
    expect(out).toContain('retrying (1/2)');
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
