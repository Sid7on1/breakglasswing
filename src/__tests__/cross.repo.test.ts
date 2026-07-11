import { GraphStore } from '../graph/graph.store';
import { GraphNode, GraphData } from '../graph/models';
import { parseRepoQualifier, pickRepoStore, composeCrossRepoMap, RepoStore } from '../graph/cross.repo';

// PR3 — cross-repo context packing. The pure pieces are unit-testable without a real workspace or
// disk: qualifier parsing, repo resolution, and merging several in-memory graph stores into one map.

function storeWith(fns: Array<{ name: string; file: string }>): GraphStore {
  const nodes = new Map<string, GraphNode>();
  for (const f of fns) {
    const id = `${f.file}#${f.name}`;
    nodes.set(id, { id, name: f.name, type: 'FUNCTION', filePath: f.file, signature: `function ${f.name}()`, startLine: 1 });
  }
  const s = new GraphStore(':memory:');
  s.setGraph({ nodes, edges: [] } as GraphData);
  return s;
}

describe('parseRepoQualifier', () => {
  it('splits a leading repo: prefix', () => {
    expect(parseRepoQualifier('repo:libfoo PLAN_CONTEXT parse')).toEqual({ repo: 'libfoo', rest: 'PLAN_CONTEXT parse' });
    expect(parseRepoQualifier('repo:lib-foo SEARCH_NODES x')).toEqual({ repo: 'lib-foo', rest: 'SEARCH_NODES x' });
  });
  it('returns no repo when the prefix is absent', () => {
    expect(parseRepoQualifier('SEARCH_NODES handlePayment')).toEqual({ rest: 'SEARCH_NODES handlePayment' });
    expect(parseRepoQualifier('  BLAST_RADIUS Foo  ')).toEqual({ rest: 'BLAST_RADIUS Foo' });
  });
});

describe('pickRepoStore', () => {
  const repos: RepoStore[] = [
    { name: 'bimax', root: '/a', primary: true, store: storeWith([]) },
    { name: 'lib-foo', root: '/b', primary: false, store: storeWith([]) },
  ];
  it('matches exact (normalized) and fuzzy names', () => {
    expect(pickRepoStore(repos, 'lib-foo')!.root).toBe('/b');
    expect(pickRepoStore(repos, 'libfoo')!.root).toBe('/b'); // normalized (dash removed)
    expect(pickRepoStore(repos, 'foo')!.root).toBe('/b');    // fuzzy contains
    expect(pickRepoStore(repos, 'bimax')!.primary).toBe(true);
  });
  it('returns undefined for an unknown repo', () => {
    expect(pickRepoStore(repos, 'nope')).toBeUndefined();
  });
});

describe('composeCrossRepoMap', () => {
  it('one indexed repo → plain single-repo outline (no cross-repo header)', () => {
    const repos: RepoStore[] = [{ name: 'bimax', root: '/a', primary: true, store: storeWith([{ name: 'alpha', file: 'a.ts' }]) }];
    const out = composeCrossRepoMap(repos, 1500, []);
    expect(out).toContain('[RepoMap] PageRank-ranked outline');
    expect(out).not.toContain('Cross-repo');
    expect(out).toContain('alpha');
  });

  it('merges multiple repos into one map, tagged per repo, still starting with [RepoMap]', () => {
    const repos: RepoStore[] = [
      { name: 'bimax', root: '/a', primary: true, store: storeWith([{ name: 'primarySym', file: 'a.ts' }]) },
      { name: 'libfoo', root: '/b', primary: false, store: storeWith([{ name: 'secondarySym', file: 'b.ts' }]) },
    ];
    const out = composeCrossRepoMap(repos, 1500, []);
    expect(out.startsWith('[RepoMap]')).toBe(true);   // strip-by-prefix in context.manager still works
    expect(out).toContain('Cross-repo outline');
    expect(out).toContain('PRIMARY repo "bimax"');
    expect(out).toContain('repo: libfoo');
    expect(out).toContain('primarySym');               // symbol from the primary repo
    expect(out).toContain('secondarySym');             // symbol pulled from the secondary repo
  });

  it('skips repos with no index and returns empty when nothing is indexed', () => {
    const repos: RepoStore[] = [{ name: 'bimax', root: '/a', primary: true, store: storeWith([]) }];
    expect(composeCrossRepoMap(repos, 1500, [])).toBe('');
  });
});
