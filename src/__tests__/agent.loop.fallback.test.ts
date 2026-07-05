import { AgentLoop } from '../core/agent.loop';
import { ToolRegistry } from '../tools/tool.registry';
import { LLMProvider, ChatEvent } from '../core/llm.provider';

/**
 * Model fallback chain (the Claude Code `fallbackModel` analogue): when the active model keeps
 * failing — transient retry budget exhausted, or a hard provider rejection — the loop switches
 * the session to the configured fallback model ONCE and re-asks, instead of dying mid-run.
 */
describe('AgentLoop — fallback model chain', () => {
  afterEach(() => {
    delete process.env.BIMAX_FALLBACK_MODEL;
  });

  // An LLM whose chat() fails until applyConfig() switches the model, then succeeds.
  function makeFailoverLlm(failWith: ChatEvent) {
    const applied: any[] = [];
    let model = 'primary-model';
    const llm = {
      userModel: 'primary-model',
      applyConfig(cfg: any) {
        applied.push(cfg);
        if (cfg.model) { model = cfg.model; (llm as any).userModel = cfg.model; }
      },
      async *chat(): AsyncGenerator<ChatEvent> {
        if (model === 'primary-model') {
          yield failWith;
        } else {
          yield { type: 'token', text: `Answered on ${model}.` };
          yield { type: 'done' };
        }
      },
    };
    return { llm: llm as unknown as LLMProvider, applied };
  }

  it('fails over after the transient budget is exhausted and completes on the fallback', async () => {
    process.env.BIMAX_FALLBACK_MODEL = 'backup-model';
    const { llm, applied } = makeFailoverLlm({ type: 'error', message: 'stream stalled', recoverable: true, kind: 'transient' });

    const loop = new AgentLoop(llm, new ToolRegistry(), null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'go' }], 'sys', { maxIterations: 10 })) {
      out += t;
    }

    expect(applied).toEqual([{ model: 'backup-model' }]);
    expect(out).toContain('Answered on backup-model.');
    expect(out).not.toContain('provider returned an error');
  }, 15000); // rides through 2 real backoff sleeps (~3s) before the failover

  it('fails over immediately on a hard (unrecoverable) provider rejection', async () => {
    process.env.BIMAX_FALLBACK_MODEL = 'backup-model';
    const { llm, applied } = makeFailoverLlm({ type: 'error', message: 'model decommissioned', recoverable: false } as ChatEvent);

    const loop = new AgentLoop(llm, new ToolRegistry(), null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'go' }], 'sys', { maxIterations: 10 })) {
      out += t;
    }

    expect(applied).toEqual([{ model: 'backup-model' }]);
    expect(out).toContain('Answered on backup-model.');
  });

  it('fires only once — a failing fallback surfaces the error instead of ping-ponging', async () => {
    process.env.BIMAX_FALLBACK_MODEL = 'backup-model';
    let calls = 0;
    const llm = {
      userModel: 'primary-model',
      applyConfig(cfg: any) { if (cfg.model) (llm as any).userModel = cfg.model; },
      async *chat(): AsyncGenerator<ChatEvent> {
        calls++;
        // Both models are down.
        yield { type: 'error', message: 'everything is on fire', recoverable: false } as ChatEvent;
      },
    };

    const loop = new AgentLoop(llm as unknown as LLMProvider, new ToolRegistry(), null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'go' }], 'sys', { maxIterations: 10 })) {
      out += t;
    }

    expect(calls).toBe(2); // primary once, fallback once — then surfaced, never spun
    expect(out).toContain('The provider returned an error');
  });

  it('does not fail over to the model that is already active', async () => {
    process.env.BIMAX_FALLBACK_MODEL = 'primary-model'; // same as current
    let applies = 0;
    const llm = {
      userModel: 'primary-model',
      applyConfig() { applies++; },
      async *chat(): AsyncGenerator<ChatEvent> {
        yield { type: 'error', message: 'down', recoverable: false } as ChatEvent;
      },
    };

    const loop = new AgentLoop(llm as unknown as LLMProvider, new ToolRegistry(), null as any);
    let out = '';
    for await (const t of loop.execute([{ role: 'user', content: 'go' }], 'sys', { maxIterations: 10 })) {
      out += t;
    }

    expect(applies).toBe(0);
    expect(out).toContain('The provider returned an error');
  });
});
