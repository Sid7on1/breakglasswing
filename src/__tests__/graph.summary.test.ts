import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GraphStore } from '../graph/graph.store';
import { GraphNode } from '../graph/models';
import { summarizeGraph, isCodebase } from '../graph/graph.summary';

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, name: id, type: 'FUNCTION', filePath: `${id}.ts`, ...extra,
});

function storeWith(nodes: GraphNode[]): GraphStore {
  const s = new GraphStore(':memory:');
  nodes.forEach(n => s.addNode(n));
  return s;
}

describe('summarizeGraph', () => {
  it('counts nodes and files', () => {
    const store = storeWith([
      node('fileA', { type: 'FILE' }),
      node('fileB', { type: 'FILE' }),
      node('fn1'),
      node('Cls', { type: 'CLASS' }),
    ]);
    const s = summarizeGraph(store);
    expect(s.nodeCount).toBe(4);
    expect(s.fileCount).toBe(2);
  });

  it('ranks top modules by riskScore/criticality and dedupes by file', () => {
    const store = storeWith([
      node('low', { filePath: 'a.ts', riskScore: 10 }),
      node('high', { filePath: 'b.ts', riskScore: 90, criticality: 'CRITICAL' }),
      node('alsoInB', { filePath: 'b.ts', riskScore: 80 }), // same file as `high` → deduped out
      node('mid', { filePath: 'c.ts', riskScore: 50, criticality: 'MEDIUM' }),
    ]);
    const s = summarizeGraph(store);
    expect(s.topModules[0].name).toBe('high');
    // Only one entry per file path.
    const files = s.topModules.map(m => m.filePath);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toEqual(['b.ts', 'c.ts', 'a.ts']);
  });

  it('reports aiGraphBuilt false for an AST-only graph and true once annotated', () => {
    const astOnly = storeWith([node('fn1'), node('fn2')]);
    expect(summarizeGraph(astOnly).aiGraphBuilt).toBe(false);

    const annotated = storeWith([node('fn1'), node('fn2', { criticality: 'HIGH' })]);
    expect(summarizeGraph(annotated).aiGraphBuilt).toBe(true);
  });
});

describe('isCodebase', () => {
  it('is true when a project marker exists, false otherwise', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-cb-'));
    try {
      expect(isCodebase(dir)).toBe(false);
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      expect(isCodebase(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
