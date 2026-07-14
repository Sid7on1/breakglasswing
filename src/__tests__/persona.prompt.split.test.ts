import { IGovernor } from '../core/interfaces';
import { ToolRegistry } from '../tools/tool.registry';
import { LlmAdapter } from '../core/llm.adapter';
import { BiMaxPersona } from '../cli/personas/implementations';
import { AgentPersona } from '../cli/personas/base.persona';
import { createBashTool } from '../tools/implementations/bash.tool';
import { createReadFileTool } from '../tools/implementations/file.tool';
import { createWebFetchTool } from '../tools/implementations/webfetch.tool';
import { BuiltTool } from '../tools/tool.factory';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OutcomeManager, __setOutcomeManager } from '../outcome/outcome.manager';

// A deferred tool that is in BiMaxPersona's allowedTools (so it reaches the prompt) but NOT in the
// core working set — exercises the LOAD-ON-DEMAND section. (WebFetchTool used to play this role, but
// it's now part of the core set.)
const fakeMemoryTool: BuiltTool = {
  name: 'MemoryQueryTool', description: 'Searches long-term memory.',
  schema: { type: 'object', properties: {} }, isDestructive: false, isConcurrencySafe: true,
  execute: async () => 'ok',
};

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;
const llm = {} as unknown as LlmAdapter;

function persona(): BiMaxPersona {
  const r = new ToolRegistry();
  [createBashTool(governor), createReadFileTool(governor), createWebFetchTool(governor), fakeMemoryTool].forEach(t => r.register(t));
  return new BiMaxPersona(r, llm);
}

describe('Persona system prompt — static/session/turn cache split', () => {
  it('static prefix is byte-identical across turns regardless of memory / plan mode', () => {
    const p = persona();
    const a = p.getSystemPromptParts({ memory: 'remembered fact A', planMode: false });
    const b = p.getSystemPromptParts({ memory: 'totally different memory B', planMode: true });
    // The cacheable prefix must not move when only per-turn content changes.
    expect(a.staticPrefix).toBe(b.staticPrefix);
    // ...and it must be a genuine prefix of the full prompt.
    expect(p.getSystemPrompt({ memory: 'x' }).startsWith(a.staticPrefix)).toBe(true);
  });

  it('per-turn volatile content (memory) lives in turnContext — NOT in the system prompt segments', () => {
    const p = persona();
    const { staticPrefix, dynamicSuffix, turnContext } = p.getSystemPromptParts({ memory: 'SECRET-MEMORY-TOKEN', planMode: true });
    // Recalled memory changes bytes every turn; in the system prompt it would invalidate the
    // provider's prompt-prefix cache from position 0 each turn.
    expect(staticPrefix).not.toContain('SECRET-MEMORY-TOKEN');
    expect(dynamicSuffix).not.toContain('SECRET-MEMORY-TOKEN');
    expect(turnContext).toContain('SECRET-MEMORY-TOKEN');
    // Plan mode toggles rarely → session suffix (one cache miss per toggle is fine).
    expect(staticPrefix).not.toContain('PLAN MODE');
    expect(dynamicSuffix).toContain('PLAN MODE');
    // Environment (cwd) is per-session/dynamic.
    expect(staticPrefix).not.toContain('### ENVIRONMENT');
    expect(dynamicSuffix).toContain('### ENVIRONMENT');
  });

  it('injects the active engine outcome contract into refreshed turn context', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-prompt-outcome-'));
    const manager = new OutcomeManager({ sessionId: () => 'prompt-session', directory: () => dir });
    try {
      manager.syncSession();
      manager.define('DELIVER-EXACT-OUTCOME', [{ id: 'verified', description: 'Result is verified' }]);
      __setOutcomeManager(manager);
      const parts = persona().getSystemPromptParts({});
      expect(parts.turnContext).toContain('DELIVER-EXACT-OUTCOME');
      expect(parts.staticPrefix).not.toContain('DELIVER-EXACT-OUTCOME');
      expect(parts.dynamicSuffix).not.toContain('DELIVER-EXACT-OUTCOME');
    } finally {
      manager.shutdown();
      __setOutcomeManager(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the session suffix is byte-stable when only per-turn content changes', () => {
    const p = persona();
    const a = p.getSystemPromptParts({ memory: 'fact A', exemplars: 'exemplar A' });
    const b = p.getSystemPromptParts({ memory: 'fact B', exemplars: 'exemplar B' });
    expect(a.dynamicSuffix).toBe(b.dynamicSuffix);
    expect(a.turnContext).not.toBe(b.turnContext);
  });

  it('identity and behavioural rules stay in the static prefix', () => {
    const p = persona();
    const { staticPrefix } = p.getSystemPromptParts({});
    expect(staticPrefix).toContain('### IDENTITY');
    expect(staticPrefix).toContain('OUTPUT CONTRACT');
  });

  it('smart mode defers MemoryQueryTool — it appears under LOAD-ON-DEMAND in the suffix, not as a sent tool', () => {
    const p = persona();
    const { dynamicSuffix } = p.getSystemPromptParts({ contextMode: 'smart' });
    expect(dynamicSuffix).toContain('LOAD-ON-DEMAND');
    expect(dynamicSuffix).toContain('MemoryQueryTool');
  });

  it('getSystemPrompt = all three segments joined', () => {
    const p = persona();
    const parts = p.getSystemPromptParts({ memory: 'm' });
    const full = p.getSystemPrompt({ memory: 'm' });
    expect(full).toBe([parts.staticPrefix, parts.dynamicSuffix, parts.turnContext].filter(Boolean).join('\n\n'));
  });
});

describe('injectTurnContext — cache-safe tail placement', () => {
  const tc = 'USER PREFERS TABS';

  it('inserts a [TurnContext] system message immediately before the latest user message', () => {
    const msgs: any[] = [
      { role: 'user', content: 'first task' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'second task' },
    ];
    AgentPersona.injectTurnContext(msgs, tc);
    expect(msgs).toHaveLength(4);
    expect(msgs[2].role).toBe('system');
    expect(msgs[2].content).toContain('[TurnContext]');
    expect(msgs[2].content).toContain(tc);
    expect(msgs[3].content).toBe('second task');
    // Never at the head — that would invalidate the whole-history prefix cache every turn.
    expect(msgs[0].content).toBe('first task');
  });

  it('strips the previous turn\'s [TurnContext] so exactly one copy exists', () => {
    const msgs: any[] = [
      { role: 'system', content: '[TurnContext]\nstale block from last turn' },
      { role: 'user', content: 'first task' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'second task' },
    ];
    AgentPersona.injectTurnContext(msgs, tc);
    const tcMsgs = msgs.filter(m => m.role === 'system' && String(m.content).startsWith('[TurnContext]'));
    expect(tcMsgs).toHaveLength(1);
    expect(tcMsgs[0].content).toContain(tc);
    expect(tcMsgs[0].content).not.toContain('stale block');
  });

  it('empty turn context strips old copies and injects nothing', () => {
    const msgs: any[] = [
      { role: 'system', content: '[TurnContext]\nstale' },
      { role: 'user', content: 'task' },
    ];
    AgentPersona.injectTurnContext(msgs, '');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('task');
  });

  it('appends when there is no user message (never targets the head)', () => {
    const msgs: any[] = [{ role: 'assistant', content: 'hello' }];
    AgentPersona.injectTurnContext(msgs, tc);
    expect(msgs[1].content).toContain(tc);
  });
});
