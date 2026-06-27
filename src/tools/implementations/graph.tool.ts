import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { GraphStore } from '../../graph/graph.store';
import { GraphNode } from '../../graph/models';
import { ImpactEngine } from '../../graph/impact.engine';
import { fmtNode, searchNodes, resolveNodeId } from '../../graph/node.search';
import { readSymbolSource } from '../../graph/symbol.source';
import { planContext } from '../../graph/context.planner';
import { getTopNodes } from '../../graph/pagerank';
import { globalCodemem } from '../../graph/codemem/backend';

// When a lookup misses, ORIENT the model instead of dead-ending: tell it what the graph actually
// holds — node-type counts + the most central REAL symbols — so it searches actual names rather than
// guessing conceptual ones (the "assumed an Architecture node exists" problem). No hardcoded
// workflow; just enough signal for the model to self-correct its next call.
function graphOrientation(store: GraphStore): string {
  const nodes = [...store.getGraph().nodes.values()];
  if (nodes.length === 0) return '';
  // Count only the searchable definition types — STATEMENT/BLOCK/VARIABLE are graph internals the
  // model can't usefully search for, so they'd just be noise here.
  const SHOWN = new Set(['FILE', 'CLASS', 'FUNCTION', 'INTERFACE']);
  const byType = new Map<string, number>();
  for (const n of nodes) if (SHOWN.has(n.type)) byType.set(n.type, (byType.get(n.type) || 0) + 1);
  const types = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${c} ${t}`).join(', ');
  const central = getTopNodes(store, 12).map(r => r.label).filter(Boolean);
  return `\n\nThis graph indexes ${types || nodes.length + ' nodes'}.` +
    (central.length ? ` Its most central symbols: ${central.join(', ')}.` : '') +
    `\nThese are CODE symbols, not domain concepts — search one of the real names above, or run` +
    ` GET_DEPENDENTS / READ_SYMBOL on it.`;
}

export const createGraphQueryTool = (governor: IGovernor, graphStore: GraphStore) => buildTool({
  name: 'GraphQueryTool',
  description: `Queries the live dependency graph (AST topological map) of the project — classes, functions, files and how they connect. Use it to "zoom out" and understand impact BEFORE editing.

# Query verbs (pass as the \`query\` string)
- \`SEARCH_NODES *\` — START HERE on an unfamiliar repo: lists the most central nodes so you see what actually exists (don't guess concept names). \`SEARCH_NODES <keyword>\` then finds a specific symbol/file (matches name, purpose, path).
- \`GET_DEPENDENTS <node>\` — DIRECT callers/users of this symbol (the immediate call sites you MUST update if you change its signature). For transitive reach use BLAST_RADIUS.
- \`GET_DEPENDENCIES <node>\` — what this symbol DIRECTLY depends on (the symbols it calls/uses).
- \`BLAST_RADIUS <node>\` — downstream reach + highest criticality if you modify this node. Run this before signature-changing edits.
- \`READ_SYMBOL <node>\` — return ONLY that symbol's source (its exact line range), with a header (file, signature, criticality). Prefer this over reading a whole file when you just need one function/class.
- \`SEMANTIC <natural-language query>\` — VECTOR search that bridges vocabulary (finds "publish" when you search "send"). Use when you don't know the exact symbol name. Powered by the baked-in codebase-memory engine's local code embeddings.
- \`ARCHITECTURE [path]\` — high-level structural overview: packages, services, and de-facto module clusters (community detection). Use to grasp how an unfamiliar codebase is organized.
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
  execute: async (args: { query: string }, context?: any) => {
    const raw = (args.query || '').trim();
    if (!raw) return 'Error: empty query.';

    const verbs = ['SEARCH_NODES', 'GET_DEPENDENTS', 'GET_DEPENDENCIES', 'BLAST_RADIUS', 'READ_SYMBOL', 'SEMANTIC', 'ARCHITECTURE'];
    const firstSpace = raw.indexOf(' ');
    const maybeVerb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toUpperCase();
    const verb = verbs.includes(maybeVerb) ? maybeVerb : null;
    const target = verb ? raw.slice(firstSpace + 1).trim() : raw;

    // codebase-memory engine: when connected + indexed, it fronts these verbs with a richer,
    // 158-language graph + local semantic search. Any miss returns null → native graph below.
    if (globalCodemem.isReady()) {
      let r: string | null = null;
      if (verb === 'SEMANTIC') r = await globalCodemem.search(target, true);
      else if (verb === 'SEARCH_NODES' && target && target !== '*') r = await globalCodemem.search(target, false);
      else if (verb === 'GET_DEPENDENTS') r = await globalCodemem.traceCalls(target, 'inbound');
      else if (verb === 'GET_DEPENDENCIES') r = await globalCodemem.traceCalls(target, 'outbound');
      else if (verb === 'BLAST_RADIUS') r = await globalCodemem.blastRadius(target);
      else if (verb === 'READ_SYMBOL') r = await globalCodemem.readSymbol(target);
      else if (verb === 'ARCHITECTURE') r = await globalCodemem.architecture(target || undefined);
      if (r) return r;
    }
    // Engine-only verbs with no native equivalent: guide the model when the engine isn't ready.
    if (verb === 'SEMANTIC') return 'Semantic search needs the codebase-memory engine, which is still indexing or unavailable. Use SEARCH_NODES <keyword> for now.';
    if (verb === 'ARCHITECTURE') return 'The architecture overview needs the codebase-memory engine, which is still indexing or unavailable. Explore with SEARCH_NODES * and ls for now.';

    const graph = graphStore.getGraph();
    if (graph.nodes.size === 0) {
      return 'The dependency graph is empty. Run /index (local AST) or /index-ai (semantic) first.';
    }

    if (verb === 'SEARCH_NODES') {
      // Discovery: `SEARCH_NODES *` (or no keyword) lists the most central nodes so the model can see
      // what's actually in the graph and pick real names — instead of guessing concepts.
      if (!target || target === '*') {
        const top = getTopNodes(graphStore, 30);
        if (top.length === 0) return 'The graph is empty.';
        return `Most central ${top.length} nodes (use these names with READ_SYMBOL / GET_DEPENDENTS / BLAST_RADIUS):\n` +
          top.map(r => `- ${r.type} ${r.label}${r.filePath ? ` (${r.filePath})` : ''}`).join('\n');
      }
      const hits = searchNodes(graphStore, target);
      if (hits.length === 0) return `No nodes match "${target}".` + graphOrientation(graphStore);
      return `Found ${hits.length} node(s) for "${target}":\n` + hits.map(n => '- ' + fmtNode(n)).join('\n');
    }

    const engine = new ImpactEngine(graphStore);

    if (verb === 'GET_DEPENDENTS' || verb === 'GET_DEPENDENCIES') {
      const resolved = resolveNodeId(graphStore, target);
      if (resolved.ambiguous) {
        return `"${target}" is ambiguous. Candidates:\n` + resolved.ambiguous.map(n => '- ' + fmtNode(n)).join('\n');
      }
      if (!resolved.id) return `No node found for "${target}". Try SEARCH_NODES ${target}.`;
      // Resolve DIRECT callers/callees, mirroring context.planner so the two never disagree:
      //  • depth 2 crosses the analyzer's block layer (symbol --CONTAINS--> block --CALLS--> neighbor),
      //  • non-symbol intermediaries (blocks/statements/vars) are dropped,
      //  • for dependents the target's own structural parents (the file/class that CONTAINS it) are
      //    excluded — they OWN the symbol, they don't depend on it.
      // This is the fix for the "6 dependents vs 2 real callers" overcount (owners + transitive noise).
      const isSym = (n: GraphNode) => n.type === 'FUNCTION' || n.type === 'CLASS' || n.type === 'INTERFACE';
      let nodes: GraphNode[];
      let dir: string;
      if (verb === 'GET_DEPENDENTS') {
        const parents = new Set(graph.edges.filter(e => e.targetId === resolved.id && e.type === 'CONTAINS').map(e => e.sourceId));
        nodes = engine.getReverseDependencies(resolved.id, 2).filter(isSym).filter(n => !parents.has(n.id));
        dir = 'directly depend on';
      } else {
        nodes = engine.getForwardDependencies(resolved.id, 2).filter(isSym);
        dir = 'are directly depended on by';
      }
      if (nodes.length === 0) return `Nothing ${dir} ${resolved.id} in the graph.`;
      return `${nodes.length} node(s) that ${dir} ${resolved.id} (direct only — use BLAST_RADIUS for transitive reach):\n` +
        nodes.slice(0, 40).map(n => '- ' + fmtNode(n)).join('\n');
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

    if (verb === 'READ_SYMBOL') {
      const resolved = resolveNodeId(graphStore, target);
      if (resolved.ambiguous) {
        return `"${target}" is ambiguous. Candidates:\n` + resolved.ambiguous.map(n => '- ' + fmtNode(n)).join('\n');
      }
      if (!resolved.id) return `No node found for "${target}". Try SEARCH_NODES ${target}.`;
      const node = graphStore.getNode(resolved.id)!;
      const { text, error } = await readSymbolSource(node, context?.cwd || process.cwd());
      if (error) return `Error reading ${node.id}: ${error}`;
      const header = [
        `// ${node.type} ${node.name}${node.criticality ? ` [${node.criticality}${node.riskScore != null ? ` risk=${node.riskScore}` : ''}]` : ''}`,
        `// ${node.filePath}:${node.startLine}-${node.endLine}`,
        node.signature ? `// ${node.signature}` : '',
      ].filter(Boolean).join('\n');
      return `${header}\n${text}`;
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

export const createGraphContextTool = (governor: IGovernor, graphStore: GraphStore) => buildTool({
  name: 'GraphContextTool',
  description: `Assembles a MINIMAL, token-budgeted context pack for editing a specific symbol, using the dependency graph — so you load exactly what you need instead of dumping whole files into context.

# Usage
- \`PLAN_CONTEXT <node|keyword>\` (or just \`<node|keyword>\`) — returns the target symbol's FULL source plus the SIGNATURES of its direct callers (who depends on it) and callees/types (what it uses).

Prefer this over ReadFileTool whenever you are about to modify an existing function/class: it shows you the call-site contract you must preserve and the things that break, at a fraction of the tokens.`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'PLAN_CONTEXT <target>, or a bare node id/keyword (e.g. "handlePayment").' }
    },
    required: ['query']
  },
  execute: async (args: { query: string }, context?: any) => {
    const raw = (args.query || '').trim();
    if (!raw) return 'Error: empty query.';

    const firstSpace = raw.indexOf(' ');
    const maybeVerb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toUpperCase();
    const target = maybeVerb === 'PLAN_CONTEXT' ? raw.slice(firstSpace + 1).trim() : raw;
    if (!target) return 'Error: PLAN_CONTEXT needs a target symbol (e.g. PLAN_CONTEXT handlePayment).';

    // Prefer the codebase-memory engine when ready; fall back to the native context planner.
    if (globalCodemem.isReady()) {
      const r = await globalCodemem.planContext(target);
      if (r) return r;
    }

    if (graphStore.getGraph().nodes.size === 0) {
      return 'The dependency graph is empty. Run /index (local AST) or /index-ai (semantic) first.';
    }

    const cwd = context?.cwd || process.cwd();
    const pack = await planContext(graphStore, target, { cwd });
    if ('error' in pack) {
      return `${pack.error} Try GraphQueryTool SEARCH_NODES ${target}.`;
    }
    return pack.text;
  }
}, governor);
