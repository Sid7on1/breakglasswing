import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { GraphStore } from '../../graph/graph.store';
import { ImpactEngine } from '../../graph/impact.engine';
import { GraphNode } from '../../graph/models';

function fmtNode(n: GraphNode): string {
  const crit = n.criticality ? ` [${n.criticality}${n.riskScore != null ? ` risk=${n.riskScore}` : ''}]` : '';
  const where = n.filePath ? ` (${n.filePath})` : '';
  return `${n.type} ${n.name}${crit}${where} — id=${n.id}`;
}

function searchNodes(store: GraphStore, keyword: string, limit = 25): GraphNode[] {
  const kw = keyword.toLowerCase();
  const hits: GraphNode[] = [];
  for (const node of store.getGraph().nodes.values()) {
    const hay = `${node.name} ${node.id} ${node.purpose || ''} ${node.filePath || ''}`.toLowerCase();
    if (hay.includes(kw)) hits.push(node);
    if (hits.length >= limit * 3) break;
  }
  // Prefer functions/classes over files, and higher criticality first.
  const critRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  hits.sort((a, b) => (critRank[b.criticality || ''] || 0) - (critRank[a.criticality || ''] || 0));
  return hits.slice(0, limit);
}

/** Resolve a query token to a node id: exact id, then unique keyword match. */
function resolveNodeId(store: GraphStore, token: string): { id?: string; ambiguous?: GraphNode[] } {
  if (store.getNode(token)) return { id: token };
  const matches = searchNodes(store, token, 6);
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length === 0) return {};
  return { ambiguous: matches };
}

export const createGraphQueryTool = (governor: IGovernor, graphStore: GraphStore) => buildTool({
  name: 'GraphQueryTool',
  description: `Queries the live dependency graph (AST topological map) of the project — classes, functions, files and how they connect. Use it to "zoom out" and understand impact BEFORE editing.

# Query verbs (pass as the \`query\` string)
- \`SEARCH_NODES <keyword>\` — find where domain logic lives without grepping (matches name, purpose, path).
- \`GET_DEPENDENTS <node>\` — who depends on this symbol (reverse deps). If you change a signature you MUST update these.
- \`GET_DEPENDENCIES <node>\` — what this symbol depends on (forward deps).
- \`BLAST_RADIUS <node>\` — downstream reach + highest criticality if you modify this node. Run this before signature-changing edits.
- \`<node>\` (bare) — the node plus its direct edges.

\`<node>\` may be an exact node id or a unique keyword; ambiguous keywords return candidates to disambiguate.`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A verb + target (e.g. "BLAST_RADIUS handlePayment") or a bare node id/keyword.' }
    },
    required: ['query']
  },
  execute: async (args: { query: string }) => {
    const raw = (args.query || '').trim();
    if (!raw) return 'Error: empty query.';

    const graph = graphStore.getGraph();
    if (graph.nodes.size === 0) {
      return 'The dependency graph is empty. Run /index (local AST) or /index-ai (semantic) first.';
    }

    const verbs = ['SEARCH_NODES', 'GET_DEPENDENTS', 'GET_DEPENDENCIES', 'BLAST_RADIUS'];
    const firstSpace = raw.indexOf(' ');
    const maybeVerb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toUpperCase();
    const verb = verbs.includes(maybeVerb) ? maybeVerb : null;
    const target = verb ? raw.slice(firstSpace + 1).trim() : raw;

    if (verb === 'SEARCH_NODES') {
      const hits = searchNodes(graphStore, target);
      if (hits.length === 0) return `No nodes match "${target}".`;
      return `Found ${hits.length} node(s) for "${target}":\n` + hits.map(n => '- ' + fmtNode(n)).join('\n');
    }

    const engine = new ImpactEngine(graphStore);

    if (verb === 'GET_DEPENDENTS' || verb === 'GET_DEPENDENCIES') {
      const resolved = resolveNodeId(graphStore, target);
      if (resolved.ambiguous) {
        return `"${target}" is ambiguous. Candidates:\n` + resolved.ambiguous.map(n => '- ' + fmtNode(n)).join('\n');
      }
      if (!resolved.id) return `No node found for "${target}". Try SEARCH_NODES ${target}.`;
      const nodes = verb === 'GET_DEPENDENTS'
        ? engine.getReverseDependencies(resolved.id, 4)
        : engine.getForwardDependencies(resolved.id, 4);
      const dir = verb === 'GET_DEPENDENTS' ? 'depend on' : 'are depended on by';
      if (nodes.length === 0) return `Nothing ${dir} ${resolved.id} in the graph.`;
      return `${nodes.length} node(s) that ${dir} ${resolved.id}:\n` + nodes.slice(0, 40).map(n => '- ' + fmtNode(n)).join('\n');
    }

    if (verb === 'BLAST_RADIUS') {
      const resolved = resolveNodeId(graphStore, target);
      if (resolved.ambiguous) {
        return `"${target}" is ambiguous. Candidates:\n` + resolved.ambiguous.map(n => '- ' + fmtNode(n)).join('\n');
      }
      if (!resolved.id) return `No node found for "${target}". Try SEARCH_NODES ${target}.`;
      const r = engine.calculateBlastRadius(resolved.id);
      const sev = r.totalImpactedNodes > 20 || r.highestRiskScore >= 70 ? '🔴 LARGE'
        : r.totalImpactedNodes > 5 ? '🟡 MODERATE' : '🟢 SMALL';
      return [
        `Blast radius for ${resolved.id}: ${sev}`,
        `- Impacted nodes: ${r.totalImpactedNodes} (files ${r.impactedFiles}, functions ${r.impactedFunctions}, classes ${r.impactedClasses})`,
        `- Highest downstream criticality score: ${r.highestRiskScore}`,
        r.totalImpactedNodes > 20 ? '⚠️ Large blast radius — review dependents carefully and run tests after editing.' : ''
      ].filter(Boolean).join('\n');
    }

    // Bare node id / keyword.
    const resolved = resolveNodeId(graphStore, target);
    if (resolved.ambiguous) {
      return `"${target}" matches several nodes — pick one or use SEARCH_NODES:\n` + resolved.ambiguous.map(n => '- ' + fmtNode(n)).join('\n');
    }
    if (!resolved.id) return `No node found for "${target}". Try: SEARCH_NODES ${target}`;
    const node = graphStore.getNode(resolved.id)!;
    const edges = graph.edges.filter(e => e.sourceId === resolved.id || e.targetId === resolved.id);
    return JSON.stringify({ node, edges }, null, 2);
  }
}, governor);
