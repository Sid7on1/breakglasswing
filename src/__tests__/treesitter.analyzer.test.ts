import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TreeSitterAnalyzer } from '../graph/treesitter.analyzer';
import { GraphStore } from '../graph/graph.store';
import { createGraphQueryTool } from '../tools/implementations/graph.tool';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

// M1 — tree-sitter multi-language backend. Index a Python fixture into the shared graph and
// confirm FILE/CLASS/FUNCTION nodes carry line ranges, CALLS edges resolve, and the existing
// graph tooling (READ_SYMBOL) works on it unchanged.
describe('TreeSitterAnalyzer — Python (M1)', () => {
  let proj: string;
  let store: GraphStore;

  beforeEach(async () => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-tree-'));
    // Line 1 blank so symbols don't start at line 1 — proves the 1-based offset.
    const src = [
      '',                                  // 1
      'def helper(x):',                    // 2
      '    return x + 1',                  // 3
      '',                                  // 4
      'def greet(name):',                  // 5
      '    return helper(name)',           // 6
      '',                                  // 7
      'class Widget:',                     // 8
      '    def render(self):',             // 9
      '        return greet("x")',         // 10
    ].join('\n');
    fs.writeFileSync(path.join(proj, 'sample.py'), src);

    store = new GraphStore(':memory:');
    await new TreeSitterAnalyzer(proj, store).analyzeProject();
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('emits a FILE node for the Python source', () => {
    const file = store.getNode('file:sample.py');
    expect(file).toBeDefined();
    expect(file!.type).toBe('FILE');
  });

  it('records functions with 1-based line ranges and a signature', () => {
    const greet = store.getNode('func:sample.py:greet');
    expect(greet).toBeDefined();
    expect(greet!.type).toBe('FUNCTION');
    expect(greet!.startLine).toBe(5);
    expect(greet!.endLine).toBe(6);
    expect(greet!.signature).toBe('def greet(name):');
  });

  it('records a class and its method with line ranges', () => {
    const cls = store.getNode('class:sample.py:Widget');
    expect(cls).toBeDefined();
    expect(cls!.startLine).toBe(8);

    const method = store.getNode('func:sample.py:Widget.render');
    expect(method).toBeDefined();
    expect(method!.startLine).toBe(9);
    expect(method!.endLine).toBe(10);
  });

  it('resolves a bare-name CALLS edge (greet → helper)', () => {
    const out = store.getEdgesFrom('func:sample.py:greet');
    expect(out.some(e => e.type === 'CALLS' && e.targetId === 'func:sample.py:helper')).toBe(true);
  });

  it('works with READ_SYMBOL — returns only that function body', async () => {
    const tool = createGraphQueryTool(governor, store);
    const res = await tool.execute({ query: 'READ_SYMBOL func:sample.py:helper' }, { cwd: proj });
    expect(res).toContain('2: def helper(x):');
    expect(res).toContain('3:     return x + 1');
    expect(res).not.toContain('greet');
  });
});

describe('TreeSitterAnalyzer — skips dependency / junk directories', () => {
  it('does not index files under node_modules, site-packages, .venv, Library, .vscode', async () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-ignore-'));
    // One real source file at the root...
    fs.writeFileSync(path.join(proj, 'app.py'), 'def real():\n    return 1\n');
    // ...and junk under every kind of ignored dir.
    for (const junkDir of ['node_modules', 'site-packages', '.venv', 'Library', '.vscode', '__pycache__']) {
      const d = path.join(proj, junkDir);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'junk.py'), 'def junk():\n    return 2\n');
    }
    const store = new GraphStore(':memory:');
    await new TreeSitterAnalyzer(proj, store).analyzeProject();

    expect(store.getNode('func:app.py:real')).toBeDefined();
    // No node from any ignored directory should exist.
    const ids = Array.from(store.getGraph().nodes.keys());
    expect(ids.some(id => /junk\.py/.test(id))).toBe(false);
    fs.rmSync(proj, { recursive: true, force: true });
  });
});
