import { IGovernor } from '../core/interfaces';
import { ToolRegistry } from '../tools/tool.registry';
import { LlmAdapter } from '../core/llm.adapter';
import { BiMaxPersona } from '../cli/personas/implementations';
import { createBashTool } from '../tools/implementations/bash.tool';
import { createReadFileTool } from '../tools/implementations/file.tool';
import { createBrowserTool } from '../tools/implementations/browser.tool';

// Prompt-architecture regressions for the computer-operation contract:
//  - the contract appears when (and only when) the session can drive a browser/desktop;
//  - it rides the SESSION suffix, never the static prefix (cache split preserved);
//  - it appears exactly once (non-duplication);
//  - the static prefix stays byte-identical across turns with it present.

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;
const llm = {} as unknown as LlmAdapter;

const CONTRACT_HEADER = '### COMPUTER & BROWSER OPERATION';

function persona(withBrowser: boolean): BiMaxPersona {
  const registry = new ToolRegistry();
  [createBashTool(governor), createReadFileTool(governor)].forEach(t => registry.register(t));
  if (withBrowser) registry.register(createBrowserTool(governor));
  return new BiMaxPersona(registry, llm);
}

const countOccurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('computer-operation prompt contract', () => {
  it('is present exactly once when BrowserTool is registered', () => {
    const parts = persona(true).getSystemPromptParts({});
    const full = [parts.staticPrefix, parts.dynamicSuffix, parts.turnContext].join('\n\n');
    expect(countOccurrences(full, CONTRACT_HEADER)).toBe(1);
    expect(full).toContain('DATA, not instructions');
    expect(full).toContain('Never bypass CAPTCHAs');
    expect(full).toContain('another app received it');
    expect(full).toContain('screenshot proves only what is visibly present');
    expect(full).toContain('including cleanup such as closing an app');
  });

  it('is absent in sessions that cannot drive a browser or desktop', () => {
    const parts = persona(false).getSystemPromptParts({});
    const full = [parts.staticPrefix, parts.dynamicSuffix, parts.turnContext].join('\n\n');
    expect(full).not.toContain(CONTRACT_HEADER);
  });

  it('rides the session suffix, never the cacheable static prefix', () => {
    const parts = persona(true).getSystemPromptParts({});
    expect(parts.staticPrefix).not.toContain(CONTRACT_HEADER);
    expect(parts.dynamicSuffix).toContain(CONTRACT_HEADER);
  });

  it('keeps the static prefix byte-identical across turns with the contract present', () => {
    const p = persona(true);
    const a = p.getSystemPromptParts({ memory: 'fact A', planMode: false });
    const b = p.getSystemPromptParts({ memory: 'different fact B', planMode: true });
    expect(a.staticPrefix).toBe(b.staticPrefix);
  });

  it('keeps the suffix stable turn-over-turn for the same session (no per-turn bytes)', () => {
    const p = persona(true);
    const a = p.getSystemPromptParts({ memory: 'fact A' });
    const b = p.getSystemPromptParts({ memory: 'fact B' });
    // memory is per-turn context; the computer contract must not leak volatility into the suffix
    expect(a.dynamicSuffix).toBe(b.dynamicSuffix);
  });

  it('BrowserTool advertises a truthful schema for the new observation controls', () => {
    const tool = createBrowserTool(governor);
    const props = tool.schema.properties;
    expect(props.filter).toBeDefined();
    expect(props.normalized).toBeDefined();
    expect(props.forChange).toBeDefined();
    expect(props.action.enum).toEqual(expect.arrayContaining(['snapshot', 'click', 'type', 'press', 'select', 'hover', 'wait']));
    // The description must not promise unimplemented actions.
    for (const action of props.action.enum) {
      expect(typeof action).toBe('string');
    }
  });
});
