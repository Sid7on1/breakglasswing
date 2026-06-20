import { IGraphStore, GraphNode } from './models';

export interface PageRankResult {
  nodeId: string;
  label: string;
  type: string;
  score: number;
  filePath?: string;
}

/**
 * PageRank on the code reference graph. High-scoring nodes are symbols that many
 * other nodes depend on — the "load-bearing" identifiers in the codebase.
 *
 * Uses the standard iterative algorithm with damping factor d (default 0.85).
 * Converges in ~30 iterations for typical code graphs (<50k nodes).
 */
export function computePageRank(
  store: IGraphStore,
  iterations = 30,
  damping = 0.85,
): Map<string, number> {
  const graph = store.getGraph();
  const nodes = Array.from(graph.nodes.values());
  if (nodes.length === 0) return new Map();

  const N = nodes.length;
  const scores = new Map<string, number>();
  for (const n of nodes) scores.set(n.id, 1 / N);

  // Pre-compute out-degree for each node
  const outDegree = new Map<string, number>();
  for (const n of nodes) outDegree.set(n.id, store.getEdgesFrom(n.id).length);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    for (const n of nodes) next.set(n.id, (1 - damping) / N);

    for (const n of nodes) {
      const outEdges = store.getEdgesFrom(n.id);
      if (outEdges.length === 0) {
        // Dangling node: distribute its rank evenly (teleportation only)
        continue;
      }
      const contribution = (scores.get(n.id) ?? 0) * damping / outEdges.length;
      for (const edge of outEdges) {
        next.set(edge.targetId, (next.get(edge.targetId) ?? 0) + contribution);
      }
    }

    for (const [id, s] of next) scores.set(id, s);
  }

  return scores;
}

/**
 * Returns the top-K nodes by PageRank score as a formatted outline string.
 * Filters to FUNCTION and CLASS types since those are what the agent cares about.
 */
export function getTopNodes(store: IGraphStore, k = 15): PageRankResult[] {
  const scores = computePageRank(store);
  const graph = store.getGraph();

  const results: PageRankResult[] = [];
  for (const [id, score] of scores) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    if (node.type !== 'FUNCTION' && node.type !== 'CLASS' && node.type !== 'FILE') continue;
    results.push({
      nodeId: id,
      label: node.name || id,
      type: node.type,
      score,
      filePath: node.filePath,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Formats top-K nodes as a compact outline string for injection into system context.
 */
export function formatRepoMapOutline(store: IGraphStore, k = 15): string {
  const top = getTopNodes(store, k);
  if (top.length === 0) return '';

  const lines = ['[RepoMap] Top load-bearing symbols (PageRank):'];
  for (const r of top) {
    const loc = r.filePath ? ` — ${r.filePath}` : '';
    lines.push(`  ${r.type.toLowerCase()} ${r.label}${loc}`);
  }
  return lines.join('\n');
}
