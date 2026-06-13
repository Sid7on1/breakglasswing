import { IGraphStore, GraphNode } from './models';

// Shared graph-node lookup/formatting used by every graph-backed tool (GraphQueryTool,
// READ_SYMBOL, the context planner, @symbol mentions). Lives in one module so resolution
// semantics (exact-id → unique-keyword → ambiguous) are identical everywhere.

const CRIT_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

/** One-line human/agent-readable description of a node. */
export function fmtNode(n: GraphNode): string {
  const crit = n.criticality ? ` [${n.criticality}${n.riskScore != null ? ` risk=${n.riskScore}` : ''}]` : '';
  const where = n.filePath ? ` (${n.filePath})` : '';
  return `${n.type} ${n.name}${crit}${where} — id=${n.id}`;
}

/** Keyword search across name/id/purpose/path, ranked by criticality. */
export function searchNodes(store: IGraphStore, keyword: string, limit = 25): GraphNode[] {
  const kw = keyword.toLowerCase();
  const hits: GraphNode[] = [];
  for (const node of store.getGraph().nodes.values()) {
    const hay = `${node.name} ${node.id} ${node.purpose || ''} ${node.filePath || ''}`.toLowerCase();
    if (hay.includes(kw)) hits.push(node);
    if (hits.length >= limit * 3) break;
  }
  hits.sort((a, b) => (CRIT_RANK[b.criticality || ''] || 0) - (CRIT_RANK[a.criticality || ''] || 0));
  return hits.slice(0, limit);
}

/** Resolve a query token to a node id: exact id, then unique keyword match. */
export function resolveNodeId(store: IGraphStore, token: string): { id?: string; ambiguous?: GraphNode[] } {
  if (store.getNode(token)) return { id: token };
  const matches = searchNodes(store, token, 6);
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length === 0) return {};
  return { ambiguous: matches };
}
