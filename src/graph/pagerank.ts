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

const estTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Build a compact "repo map" for injection into the model's context — the same idea aider proved
 * works on non-caching models: instead of making the agent read whole files to orient itself, give
 * it a PageRank-ranked, token-budgeted outline of the codebase's load-bearing SYMBOLS (their
 * signatures, grouped by file). The model sees the skeleton of the whole repo for a fixed ~1.5k
 * tokens and can navigate straight to what it needs, rather than grepping/reading blindly.
 *
 * Greedy admission by descending PageRank until `maxTokens` is spent; within each file, symbols are
 * ordered by source line so the outline reads top-to-bottom. Falls back to `type name` when a node
 * has no captured signature (older graphs). Empty string when the graph isn't indexed.
 */
export function formatRepoMapOutline(store: IGraphStore, maxTokens = 1500): string {
  const scores = computePageRank(store);
  const graph = store.getGraph();

  // Only real top-level definitions — not STATEMENT/VARIABLE/BLOCK nodes, whose "signature" is just
  // a code line (`result = super.emit(...)`) and would fill the map with noise.
  const DEF_TYPES = new Set<GraphNode['type']>(['FUNCTION', 'CLASS', 'INTERFACE']);
  const ranked = Array.from(graph.nodes.values())
    .filter((n: GraphNode) => !!n.filePath && DEF_TYPES.has(n.type))
    .map((n: GraphNode) => ({ n, score: scores.get(n.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return '';

  const header =
    '[RepoMap] PageRank-ranked outline of the most load-bearing symbols in this repository ' +
    '(signatures only — NOT the full source). Use it to navigate: jump straight to the relevant ' +
    'file/symbol with ReadFileTool (startLine/endLine) or GraphContextTool instead of exploring blindly.';

  // `maxTokens` budgets the SYMBOL outline; the fixed header is overhead on top of it.
  const byFile = new Map<string, { line: number; text: string }[]>();
  const fileOrder: string[] = [];
  let used = 0;

  for (const { n } of ranked) {
    const file = n.filePath!;
    const sig = (n.signature || `${String(n.type).toLowerCase()} ${n.name}`).trim();
    const text = '  ' + sig;
    const isNewFile = !byFile.has(file);
    const cost = estTokens(text) + (isNewFile ? estTokens(file + ':') : 0);
    if (used + cost > maxTokens) break;
    used += cost;
    if (isNewFile) {
      byFile.set(file, []);
      fileOrder.push(file);
    }
    byFile.get(file)!.push({ line: n.startLine ?? 0, text });
  }
  if (byFile.size === 0) return '';

  const lines = [header];
  for (const file of fileOrder) {
    lines.push('', file + ':');
    for (const s of byFile.get(file)!.sort((a, b) => a.line - b.line)) lines.push(s.text);
  }
  return lines.join('\n');
}
