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
    reg.register(fakeTool('ScoutTool'));      // not in CORE → deferred
    reg.register(fakeTool('mcp__github__create')); // mcp__ → always deferred
    reg.register(createToolSearchTool(governor, reg));
  });

  it('full mode sends every tool except ToolSearchTool', () => {
    expect(names(reg.getSchemas({ mode: 'full' }))).toEqual(
      ['BashTool', 'ReadFileTool', 'ScoutTool', 'mcp__github__create'].sort(),
    );
  });

  it('smart mode sends only core tools + ToolSearchTool, deferring the rest', () => {
    expect(names(reg.getSchemas({ mode: 'smart' }))).toEqual(
      ['BashTool', 'ReadFileTool', 'ToolSearchTool'].sort(),
    );
  });

  it('keeps precision editing and targeted verification callable in smart mode', () => {
    reg.register(fakeTool('SymbolEditTool'));
    reg.register(fakeTool('RelatedTestsTool'));
    expect(names(reg.getSchemas({ mode: 'smart' }))).toEqual(
      expect.arrayContaining(['SymbolEditTool', 'RelatedTestsTool']),
    );
    expect(reg.isDeferred('SymbolEditTool')).toBe(false);
  });

  it('classifies deferred tools correctly', () => {
    expect(reg.isDeferred('ScoutTool')).toBe(true);
    expect(reg.isDeferred('mcp__github__create')).toBe(true);
    expect(reg.isDeferred('ReadFileTool')).toBe(false);
    expect(reg.isDeferred('ToolSearchTool')).toBe(false);
  });

  it('deferredSummary lists undiscovered deferred tools only', () => {
    const before = reg.deferredSummary().map(t => t.name).sort();
    expect(before).toEqual(['ScoutTool', 'mcp__github__create'].sort());
  });

  it('once discovered, a deferred tool is sent in smart mode and drops off the summary', () => {
    reg.markDiscovered(['ScoutTool']);
    expect(names(reg.getSchemas({ mode: 'smart' }))).toContain('ScoutTool');
    expect(reg.deferredSummary().map(t => t.name)).not.toContain('ScoutTool');
  });

  it('searchDeferred by keyword marks matches discovered and returns their schemas', () => {
    const found = reg.searchDeferred('scout');
    expect(found.map((s: any) => s.name)).toContain('ScoutTool');
    expect(reg.isDiscovered('ScoutTool')).toBe(true);
  });

  it('searchDeferred supports select:Name syntax', () => {
    const found = reg.searchDeferred('select:mcp__github__create');
    expect(found.map((s: any) => s.name)).toEqual(['mcp__github__create']);
    expect(reg.isDiscovered('mcp__github__create')).toBe(true);
  });

  // Note: these use DEFERRED tool names (not CORE tools like WebFetchTool, which are never deferred).
  it('searchDeferred fuzzy-ranks by relevance, name over description', () => {
    const r = new ToolRegistry();
    r.register(fakeTool('ScoutTool', 'browse the internet'));          // "scout" in the NAME
    r.register(fakeTool('CrawlerTool', 'scout and index remote pages')); // "scout" only in description
    r.register(fakeTool('DockerTool', 'run containers'));               // irrelevant
    const found = r.searchDeferred('scout').map((s: any) => s.name);
    expect(found[0]).toBe('ScoutTool');    // name hit ranks first
    expect(found).not.toContain('DockerTool'); // irrelevant tool excluded
  });

  it('searchDeferred matches abbreviations/dropped chars (proving fuzzy, not substring)', () => {
    const r = new ToolRegistry();
    r.register(fakeTool('ScoutTool', 'browse the internet'));
    r.register(fakeTool('DockerTool', 'run containers'));
    // "scot" is a subsequence of "scout" — no contiguous substring match, so the old includes() path
    // would find nothing; fuzzysort still resolves it.
    const found = r.searchDeferred('scot').map((s: any) => s.name);
    expect(found).toContain('ScoutTool');
  });

  it('unregister clears discovery state', () => {
    reg.markDiscovered(['ScoutTool']);
    reg.unregister('ScoutTool');
    expect(reg.isDiscovered('ScoutTool')).toBe(false);
    expect(names(reg.getSchemas({ mode: 'smart' }))).not.toContain('ScoutTool');
  });
});

describe('ToolSearchTool', () => {
  it('loads a deferred tool and reports it as callable', async () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool('ScoutTool', 'ScoutTool scouts web pages and APIs'));
    const search = createToolSearchTool(governor, reg);
    const out = await search.execute({ query: 'scout' });
    expect(out).toContain('ScoutTool');
    expect(out).toContain('<functions>');
    expect(reg.isDiscovered('ScoutTool')).toBe(true);
  });

  it('explains when nothing matches but deferred tools exist', async () => {
    const reg = new ToolRegistry();
    reg.register(fakeTool('ScoutTool'));
    const search = createToolSearchTool(governor, reg);
    const out = await search.execute({ query: 'select:NopeTool' });
    expect(out).toContain('No deferred tools matched');
    expect(out).toContain('ScoutTool');
  });
});

describe('ToolRegistry — index-gated graph tools', () => {
  let reg: ToolRegistry;
  let indexed: boolean;

  beforeEach(() => {
    reg = new ToolRegistry();
    indexed = false;
    reg.setGraphReadyCheck(() => indexed);
    reg.register(fakeTool('ReadFileTool'));
    reg.register(fakeTool('GraphQueryTool', 'GraphQueryTool queries the dependency graph'));
    reg.register(fakeTool('GraphContextTool', 'GraphContextTool builds a token-budgeted context pack'));
    reg.register(createToolSearchTool(governor, reg));
  });

  it('disables graph tools (both modes) until the repo is indexed', () => {
    expect(names(reg.getSchemas({ mode: 'full' }))).not.toContain('GraphQueryTool');
    expect(names(reg.getSchemas({ mode: 'smart' }))).not.toContain('GraphContextTool');
    // and they must not leak through the deferred/load-on-demand path either
    expect(reg.isDeferred('GraphQueryTool')).toBe(false);
    expect(reg.deferredSummary().map(t => t.name)).not.toContain('GraphQueryTool');
    expect(reg.searchDeferred('graph').map((s: any) => s.name)).not.toContain('GraphQueryTool');
  });

  it('sends and promotes graph tools in BOTH modes once indexed', () => {
    indexed = true;
    expect(names(reg.getSchemas({ mode: 'smart' }))).toEqual(
      expect.arrayContaining(['GraphQueryTool', 'GraphContextTool']),
    );
    expect(names(reg.getSchemas({ mode: 'full' }))).toEqual(
      expect.arrayContaining(['GraphQueryTool', 'GraphContextTool']),
    );
  });

  it('a throwing readiness check degrades to "not indexed"', () => {
    reg.setGraphReadyCheck(() => { throw new Error('graph store unavailable'); });
    expect(reg.isGraphReady()).toBe(false);
    expect(names(reg.getSchemas({ mode: 'full' }))).not.toContain('GraphQueryTool');
  });
});

// Models (esp. MiniMax) emit mangled tool names natively. getTool resolves common near-misses to the
// right tool instead of erroring "tool not found" — so a turn isn't wasted on a typo'd name.
describe('ToolRegistry — getTool resolves mangled/aliased names', () => {
  let reg: ToolRegistry;
  beforeEach(() => {
    reg = new ToolRegistry();
    reg.register(fakeTool('ReadFileTool'));
    reg.register(fakeTool('EditFileTool'));
    reg.register(fakeTool('MultiEditTool'));
  });

  it('resolves the observed "ReadFileFile" mangle to ReadFileTool', () => {
    expect(reg.getTool('ReadFileFile')?.name).toBe('ReadFileTool');
  });
  it('resolves snake_case / missing-suffix / short aliases', () => {
    expect(reg.getTool('read_file')?.name).toBe('ReadFileTool');
    expect(reg.getTool('Read')?.name).toBe('ReadFileTool');
    expect(reg.getTool('edit')?.name).toBe('EditFileTool');
  });
  it('still returns exact matches and undefined for true unknowns', () => {
    expect(reg.getTool('MultiEditTool')?.name).toBe('MultiEditTool');
    expect(reg.getTool('xyz')).toBeUndefined();
  });
});
