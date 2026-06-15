import { ToolRegistry } from '../tools/tool.registry';
import { BuiltTool } from '../tools/tool.factory';
import { createToolSearchTool } from '../tools/implementations/toolsearch.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// Minimal fake tool — enough for the registry to slot it in and emit a schema.
function fakeTool(name: string, description = `${name} does a thing`): BuiltTool {
  return { name, description, schema: { type: 'object', properties: {} }, isDestructive: false, isConcurrencySafe: true, execute: async () => 'ok' };
}

function names(schemas: any[]): string[] {
  return schemas.map(s => s.name).sort();
}

describe('ToolRegistry — smart vs full context modes', () => {
  let reg: ToolRegistry;

  beforeEach(() => {
    reg = new ToolRegistry();
    // A couple of core tools, a deferred native tool, a deferred MCP tool.
    reg.register(fakeTool('ReadFileTool'));
    reg.register(fakeTool('BashTool'));
    reg.register(fakeTool('WebFetchTool'));      // not in CORE → deferred
    reg.register(fakeTool('mcp__github__create')); // mcp__ → always deferred
    reg.register(createToolSearchTool(governor, reg));
  });

  it('full mode sends every tool except ToolSearchTool', () => {
    expect(names(reg.getSchemas({ mode: 'full' }))).toEqual(
      ['BashTool', 'ReadFileTool', 'WebFetchTool', 'mcp__github__create'].sort(),
    );
  });

  it('smart mode sends only core tools + ToolSearchTool, deferring the rest', () => {
    expect(names(reg.getSchemas({ mode: 'smart' }))).toEqual(
      ['BashTool', 'ReadFileTool', 'ToolSearchTool'].sort(),
    );
  });

  it('classifies deferred tools correctly', () => {
    expect(reg.isDeferred('WebFetchTool')).toBe(true);
    expect(reg.isDeferred('mcp__github__create')).toBe(true);
    expect(reg.isDeferred('ReadFileTool')).toBe(false);
    expect(reg.isDeferred('ToolSearchTool')).toBe(false);
  });

  it('deferredSummary lists undiscovered deferred tools only', () => {
    const before = reg.deferredSummary().map(t => t.name).sort();
    expect(before).toEqual(['WebFetchTool', 'mcp__github__create'].sort());
  });

  it('once discovered, a deferred tool is sent in smart mode and drops off the summary', () => {
    reg.markDiscovered(['WebFetchTool']);
    expect(names(reg.getSchemas({ mode: 'smart' }))).toContain('WebFetchTool');
    expect(reg.deferredSummary().map(t => t.name)).not.toContain('WebFetchTool');
  });

  it('searchDeferred by keyword marks matches discovered and returns their schemas', () => {
    const found = reg.searchDeferred('web fetch');
    expect(found.map((s: any) => s.name)).toContain('WebFetchTool');
    expect(reg.isDiscovered('WebFetchTool')).toBe(true);
  });

  it('searchDeferred supports select:Name syntax', () => {
    const found = reg.searchDeferred('select:mcp__github__create');
    expect(found.map((s: any) => s.name)).toEqual(['mcp__github__create']);
    expect(reg.isDiscovered('mcp__github__create')).toBe(true);
  });

  it('unregister clears discovery state', () => {
    reg.markDiscovered(['WebFetchTool']);
    reg.unregister('WebFetchTool');
    expect(reg.isDiscovered('WebFetchTool')).toBe(false);
    expect(names(reg.getSchemas({ mode: 'smart' }))).not.toContain('WebFetchTool');
  });
});

describe('ToolSearchTool', () => {
  it('loads a deferred tool and reports it as callable', async () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool('GraphQueryTool', 'GraphQueryTool queries the dependency graph'));
    const search = createToolSearchTool(governor, reg);
    const out = await search.execute({ query: 'graph dependency' });
    expect(out).toContain('GraphQueryTool');
    expect(out).toContain('<functions>');
    expect(reg.isDiscovered('GraphQueryTool')).toBe(true);
  });

  it('explains when nothing matches but deferred tools exist', async () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool('GraphQueryTool'));
    const search = createToolSearchTool(governor, reg);
    const out = await search.execute({ query: 'select:NopeTool' });
    expect(out).toContain('No deferred tools matched');
    expect(out).toContain('GraphQueryTool');
  });
});
