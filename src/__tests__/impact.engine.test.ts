import * as path from 'path';
import * as os from 'os';
import { GraphStore } from '../graph/graph.store';
import { ImpactEngine } from '../graph/impact.engine';
import { GraphNode } from '../graph/models';

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, name: id, type: 'FUNCTION', filePath: `${id}.ts`, ...extra,
});

function storeWith(nodes: GraphNode[], edges: { sourceId: string; targetId: string }[]): GraphStore {
  const s = new GraphStore(path.join(os.tmpdir(), `bimax-impact-${Date.now()}.json`));
  nodes.forEach(n => s.addNode(n));
  edges.forEach(e => s.addEdge({ ...e, type: 'CALLS' as any }));
  return s;
}

describe('ImpactEngine.calculateBlastRadius', () => {
  it('reports the highest downstream riskScore (regression: was always 0)', () => {
    // caller (risk 80) --CALLS--> target. The caller is a reverse dependency of target.
    const store = storeWith(
      [node('target'), node('caller', { riskScore: 80, criticality: 'HIGH' })],
      [{ sourceId: 'caller', targetId: 'target' }],
    );
    const report = new ImpactEngine(store).calculateBlastRadius('target');
    expect(report.totalImpactedNodes).toBe(1);
    expect(report.highestRiskScore).toBe(80);
  });

  it('counts impacted nodes by type across the reverse-dependency closure', () => {
    const store = storeWith(
      [
        node('target'),
        node('fnA', { type: 'FUNCTION', riskScore: 10 }),
        node('clsB', { type: 'CLASS', riskScore: 30 }),
      ],
      [
        { sourceId: 'fnA', targetId: 'target' },
        { sourceId: 'clsB', targetId: 'fnA' }, // transitive dependent of target
      ],
    );
    const report = new ImpactEngine(store).calculateBlastRadius('target');
    expect(report.totalImpactedNodes).toBe(2);
    expect(report.impactedFunctions).toBe(1);
    expect(report.impactedClasses).toBe(1);
    expect(report.highestRiskScore).toBe(30);
  });
});
