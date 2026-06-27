import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StaticAnalyzer } from '../graph/static.analyzer';
import { GraphStore } from '../graph/graph.store';
import { createGraphQueryTool } from '../tools/implementations/graph.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// G2: READ_SYMBOL must return ONLY the target symbol's source (its exact line range),
// not the whole file — the core token-saving win of the graph context engine.
describe('GraphQueryTool — READ_SYMBOL (G2)', () => {
  let proj: string;
  let store: GraphStore;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-readsym-'));
    fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'CommonJS', strict: false },
      include: ['*.ts'],
    }));
    const src = [
      '',                                               // 1
      'export function greet(name: string): string {',  // 2
      '  return `hi ${name}`;',                          // 3
      '}',                                               // 4
      '',                                                // 5
      'export function farewell(name: string): string {',// 6
      '  return `bye ${name}`;',                         // 7
      '}',                                               // 8
    ].join('\n');
    fs.writeFileSync(path.join(proj, 'sample.ts'), src);

    store = new GraphStore(':memory:');
    new StaticAnalyzer(proj, store).analyzeProject();
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('returns only the target function body, not the whole file', async () => {
    const tool = createGraphQueryTool(governor, store);
    const out = await tool.execute({ query: 'READ_SYMBOL func:sample.ts:greet' }, { cwd: proj });

    // The target's body is present...
    expect(out).toContain('2: export function greet(name: string): string {');
    expect(out).toContain('3:   return `hi ${name}`;');
    // ...and the unrelated sibling function is NOT included.
    expect(out).not.toContain('farewell');
    // Header carries file + line range + signature.
    expect(out).toContain('sample.ts:2-4');
  });

  it('resolves a bare keyword to the symbol', async () => {
    const tool = createGraphQueryTool(governor, store);
    const out = await tool.execute({ query: 'READ_SYMBOL farewell' }, { cwd: proj });
    expect(out).toContain('6: export function farewell(name: string): string {');
    expect(out).not.toContain('greet');
  });

  it('reports a helpful error when the node is unknown', async () => {
    const tool = createGraphQueryTool(governor, store);
    const out = await tool.execute({ query: 'READ_SYMBOL doesNotExist' }, { cwd: proj });
    expect(out).toMatch(/No node found/);
  });
});
