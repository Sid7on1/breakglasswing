import { GraphStore } from '../graph/graph.store';
import { GraphNode } from '../graph/models';
import { formatRepoMapOutline } from '../graph/pagerank';

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, name: id, type: 'FUNCTION', filePath: `${id}.ts`, ...extra,
});

function storeWith(nodes: GraphNode[]): GraphStore {
  const s = new GraphStore(':memory:');
  nodes.forEach(n => s.addNode(n));
  return s;
}

describe('formatRepoMapOutline — aider-style repo map', () => {
  it('returns empty string when the graph is not indexed', () => {
    expect(formatRepoMapOutline(storeWith([]))).toBe('');
  });

  it('renders signatures grouped by file under a header', () => {
    const store = storeWith([
      node('a1', { filePath: 'auth.ts', signature: 'function login(u: string): Token', startLine: 10 }),
      node('a2', { filePath: 'auth.ts', signature: 'function logout(): void', startLine: 2 }),
      node('b1', { filePath: 'db.ts', signature: 'class Connection', startLine: 1, type: 'CLASS' }),
    ]);
    const out = formatRepoMapOutline(store, 1500);
    expect(out).toContain('[RepoMap]');
    expect(out).toContain('auth.ts:');
    expect(out).toContain('db.ts:');
    expect(out).toContain('function login(u: string): Token');
    expect(out).toContain('class Connection');
    // Within a file, symbols are ordered by source line (logout @2 before login @10).
    expect(out.indexOf('function logout')).toBeLessThan(out.indexOf('function login'));
  });

  it('respects the token budget (a tiny budget admits few symbols)', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      node(`f${i}`, { filePath: `mod${i}.ts`, signature: `function veryLongSymbolName${i}(argument: SomeType): ReturnType` }),
    );
    const tiny = formatRepoMapOutline(storeWith(many), 80);
    const big = formatRepoMapOutline(storeWith(many), 1500);
    expect(tiny.length).toBeGreaterThan(0);
    expect(big.length).toBeGreaterThan(tiny.length); // a larger budget admits more symbols
  });

  it('falls back to "type name" when a node has no signature', () => {
    const out = formatRepoMapOutline(storeWith([node('x', { filePath: 'x.ts', signature: undefined })]), 1500);
    expect(out).toContain('function x');
  });
});
