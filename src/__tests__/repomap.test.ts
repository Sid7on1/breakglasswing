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

  it('personalizes: focus terms float matching symbols to the top (aider mentioned_idents)', () => {
    // `popular` has many callers (high PageRank); `setAuthCookie` is obscure. With no focus, popular
    // ranks first; with focus "auth", setAuthCookie must come first.
    const store = new GraphStore(':memory:');
    store.addNode(node('popular', { filePath: 'util.ts', signature: 'function popular(): void' }));
    store.addNode(node('setAuthCookie', { filePath: 'auth.ts', signature: 'function setAuthCookie(t: string)' }));
    // give `popular` inbound edges so PageRank ranks it above setAuthCookie
    for (let i = 0; i < 5; i++) {
      store.addNode(node(`caller${i}`, { filePath: `c${i}.ts`, signature: `function caller${i}()` }));
      store.addEdge({ sourceId: `caller${i}`, targetId: 'popular', type: 'CALLS' });
    }
    const plain = formatRepoMapOutline(store, 1500);
    expect(plain.indexOf('popular')).toBeLessThan(plain.indexOf('setAuthCookie'));

    const focused = formatRepoMapOutline(store, 1500, ['auth']);
    expect(focused.indexOf('setAuthCookie')).toBeLessThan(focused.indexOf('popular'));
  });
});

describe('focusTermsFromMessages', () => {
  const { focusTermsFromMessages } = require('../memory/context.manager');
  it('keeps code-ish tokens and drops prose', () => {
    const terms = focusTermsFromMessages([{ role: 'user', content: 'please fix setAuthCookie in src/auth.ts now' }]);
    expect(terms).toContain('setAuthCookie');
    expect(terms).toContain('src/auth.ts');
    expect(terms).not.toContain('please'); // plain prose word skipped
    expect(terms).not.toContain('fix');
  });
  it('returns [] for a vague request (falls back to pure PageRank)', () => {
    expect(focusTermsFromMessages([{ role: 'user', content: 'read all the codebase and suggest improvements' }])).toEqual([]);
  });
});
