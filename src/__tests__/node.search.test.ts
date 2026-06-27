import * as path from 'path';
import * as os from 'os';
import { GraphStore } from '../graph/graph.store';
import { resolveNodeId } from '../graph/node.search';
import { GraphNode } from '../graph/models';

const n = (id: string, name: string, type: any = 'FUNCTION'): GraphNode => ({ id, name, type, filePath: 'f.ts' });

function store(nodes: GraphNode[]): GraphStore {
  const s = new GraphStore(path.join(os.tmpdir(), `bimax-resolve-${Date.now()}-${Math.random()}.json`));
  nodes.forEach(x => s.addNode(x));
  return s;
}

describe('resolveNodeId', () => {
  it('prefers an exact NAME match over substring matches (the bare-class-name weakness)', () => {
    // "IncrementalAnalyzer" substring-matches the class AND its methods; it used to bail as ambiguous.
    const s = store([
      n('cls:IA', 'IncrementalAnalyzer', 'CLASS'),
      n('fn:IA.bootstrap', 'IncrementalAnalyzer.bootstrap'),
      n('fn:IA.update', 'IncrementalAnalyzer.update'),
    ]);
    const r = resolveNodeId(s, 'IncrementalAnalyzer');
    expect(r.id).toBe('cls:IA');
    expect(r.ambiguous).toBeUndefined();
  });

  it('still returns candidates when a bare name is genuinely ambiguous', () => {
    // Two distinct symbols named exactly "bootstrap" — no single exact match, so disambiguate.
    const s = store([n('a:bootstrap', 'bootstrap'), n('b:bootstrap', 'bootstrap')]);
    const r = resolveNodeId(s, 'bootstrap');
    expect(r.id).toBeUndefined();
    expect(r.ambiguous?.length).toBe(2);
  });

  it('resolves an exact node id directly', () => {
    const s = store([n('fn:x', 'x')]);
    expect(resolveNodeId(s, 'fn:x').id).toBe('fn:x');
  });
});
