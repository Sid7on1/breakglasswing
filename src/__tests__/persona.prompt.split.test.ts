import { IGovernor } from '../core/interfaces';
import { ToolRegistry } from '../tools/tool.registry';
import { LlmAdapter } from '../core/llm.adapter';
import { BiMaxPersona } from '../cli/personas/implementations';
import { createBashTool } from '../tools/implementations/bash.tool';
import { createReadFileTool } from '../tools/implementations/file.tool';
import { createWebFetchTool } from '../tools/implementations/webfetch.tool';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;
const llm = {} as unknown as LlmAdapter;

function persona(): BiMaxPersona {
  const r = new ToolRegistry();
  [createBashTool(governor), createReadFileTool(governor), createWebFetchTool(governor)].forEach(t => r.register(t));
  return new BiMaxPersona(r, llm);
}

describe('Persona system prompt — static/dynamic cache split', () => {
  it('static prefix is byte-identical across turns regardless of memory / plan mode', () => {
    const p = persona();
    const a = p.getSystemPromptParts({ memory: 'remembered fact A', planMode: false });
    const b = p.getSystemPromptParts({ memory: 'totally different memory B', planMode: true });
    // The cacheable prefix must not move when only per-turn content changes.
    expect(a.staticPrefix).toBe(b.staticPrefix);
    // ...and it must be a genuine prefix of the full prompt.
    expect(p.getSystemPrompt({ memory: 'x' }).startsWith(a.staticPrefix)).toBe(true);
  });

  it('volatile content lives in the dynamic suffix, not the static prefix', () => {
    const p = persona();
    const { staticPrefix, dynamicSuffix } = p.getSystemPromptParts({ memory: 'SECRET-MEMORY-TOKEN', planMode: true });
    expect(staticPrefix).not.toContain('SECRET-MEMORY-TOKEN');
    expect(dynamicSuffix).toContain('SECRET-MEMORY-TOKEN');
    expect(staticPrefix).not.toContain('PLAN MODE');
    expect(dynamicSuffix).toContain('PLAN MODE');
    // Environment (cwd) is per-session/dynamic.
    expect(staticPrefix).not.toContain('### ENVIRONMENT');
    expect(dynamicSuffix).toContain('### ENVIRONMENT');
  });

  it('identity and behavioural rules stay in the static prefix', () => {
    const p = persona();
    const { staticPrefix } = p.getSystemPromptParts({});
    expect(staticPrefix).toContain('### IDENTITY');
    expect(staticPrefix).toContain('OUTPUT CONTRACT');
  });

  it('smart mode defers WebFetchTool — it appears under LOAD-ON-DEMAND in the suffix, not as a sent tool', () => {
    const p = persona();
    const { dynamicSuffix } = p.getSystemPromptParts({ contextMode: 'smart' });
    expect(dynamicSuffix).toContain('LOAD-ON-DEMAND');
    expect(dynamicSuffix).toContain('WebFetchTool');
  });

  it('getSystemPrompt = staticPrefix + dynamicSuffix joined', () => {
    const p = persona();
    const parts = p.getSystemPromptParts({ memory: 'm' });
    const full = p.getSystemPrompt({ memory: 'm' });
    expect(full).toBe([parts.staticPrefix, parts.dynamicSuffix].filter(Boolean).join('\n\n'));
  });
});
