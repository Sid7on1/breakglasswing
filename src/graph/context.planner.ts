import { IGraphStore, GraphNode } from './models';
import { ImpactEngine } from './impact.engine';
import { resolveNodeId } from './node.search';
import { readSymbolSource } from './symbol.source';

// G3 — Graph-Guided Context Pack.
// Instead of dumping a whole file into the LLM, assemble the *minimal* context needed to
// safely edit a symbol: the target symbol's full body, plus the SIGNATURES ONLY of its
// direct callers (reverse deps) and callees/types (forward deps). Token-budgeted and
// ranked by criticality so the most important neighbors survive truncation.

const CHARS_PER_TOKEN = 4; // Rough, model-agnostic estimate — good enough for budgeting.
const CRIT_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface ContextPackEntry {
  nodeId: string;
  role: 'target' | 'caller' | 'callee';
  text: string; // full body for the target; a single signature line for neighbors
}

export interface ContextPack {
  targetId: string;
  entries: ContextPackEntry[];
  text: string;        // assembled, ready to inject into the prompt
  tokenEstimate: number;
  truncated: boolean;  // true if some neighbor signatures were dropped to fit the budget
}

export interface PlanContextOptions {
  cwd: string;
  maxTokens?: number; // hard cap on the assembled pack (default 1500)
  depth?: number;     // neighbor traversal depth (default 2 — see note below)
}

// Default traversal depth is 2, not 1: the static analyzer attaches CALLS/USES edges to the
// function's inner *block* node (func --CONTAINS--> block --CALLS--> callee), so the real
// neighbor sits one structural hop past the target. Depth 2 crosses that block layer;
// non-symbol intermediaries (blocks/statements/vars) are dropped by `isSymbol`.
const DEFAULT_DEPTH = 2;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** A node is "code we can show source/signature for" if it is a class/function/method/iface. */
function isSymbol(n: GraphNode): boolean {
  return n.type === 'FUNCTION' || n.type === 'CLASS' || n.type === 'INTERFACE';
}

function critRank(n: GraphNode): number {
  return CRIT_RANK[n.criticality || ''] || 0;
}

async function readBody(node: GraphNode, cwd: string): Promise<string | null> {
  const { text } = await readSymbolSource(node, cwd);
  return text ?? null;
}

/** A neighbor's one-line signature for the pack (falls back to the symbol name). */
function signatureLine(n: GraphNode): string {
  const sig = n.signature || n.name;
  const where = n.filePath ? ` (${n.filePath}${n.startLine != null ? `:${n.startLine}` : ''})` : '';
  const crit = n.criticality ? ` [${n.criticality}]` : '';
  return `${sig}${where}${crit}`;
}

/**
 * Assemble a minimal, token-budgeted context pack for editing `target` (a node id or
 * keyword). Returns `{ error }` if the target can't be uniquely resolved.
 */
export async function planContext(
  store: IGraphStore,
  target: string,
  opts: PlanContextOptions
): Promise<ContextPack | { error: string }> {
  const maxTokens = opts.maxTokens ?? 1500;
  const depth = opts.depth ?? DEFAULT_DEPTH;

  const resolved = resolveNodeId(store, target);
  if (resolved.ambiguous) {
    return { error: `"${target}" is ambiguous (${resolved.ambiguous.length} candidates). Be more specific.` };
  }
  if (!resolved.id) return { error: `No node found for "${target}".` };

  const targetNode = store.getNode(resolved.id)!;
  const engine = new ImpactEngine(store);

  // Structural parents (the file/class that CONTAINS the target) show up in the reverse
  // traversal but are not "callers" — exclude them so the callers list is real dependents.
  const structuralParents = new Set(
    store.getEdgesTo(resolved.id).filter(e => e.type === 'CONTAINS').map(e => e.sourceId)
  );

  // Direct callers (who depends on this) and callees/types (what this uses).
  const callers = engine.getReverseDependencies(resolved.id, depth)
    .filter(isSymbol)
    .filter(n => !structuralParents.has(n.id));
  const callees = engine.getForwardDependencies(resolved.id, depth).filter(isSymbol);

  // Build the target entry first — it is always included (the whole point of the pack).
  const body = await readBody(targetNode, opts.cwd);
  const targetText = body
    ?? `${targetNode.signature || targetNode.name} (source unavailable — re-run /index)`;
  const entries: ContextPackEntry[] = [
    { nodeId: targetNode.id, role: 'target', text: targetText },
  ];

  // Rank neighbors: highest criticality first, deduped, excluding the target itself.
  const seen = new Set<string>([targetNode.id]);
  const rankNeighbor = (n: GraphNode) => !seen.has(n.id) && seen.add(n.id);
  const rankedCallers = callers.filter(rankNeighbor).sort((a, b) => critRank(b) - critRank(a));
  const rankedCallees = callees.filter(rankNeighbor).sort((a, b) => critRank(b) - critRank(a));

  // Fill the remaining budget with neighbor signatures (callers before callees), dropping
  // the rest once we'd blow the cap.
  let tokenEstimate = estimateTokens(targetText);
  let truncated = false;
  const addNeighbors = (nodes: GraphNode[], role: 'caller' | 'callee') => {
    for (const n of nodes) {
      const line = signatureLine(n);
      const cost = estimateTokens(line);
      if (tokenEstimate + cost > maxTokens) { truncated = true; continue; }
      tokenEstimate += cost;
      entries.push({ nodeId: n.id, role, text: line });
    }
  };
  addNeighbors(rankedCallers, 'caller');
  addNeighbors(rankedCallees, 'callee');

  const text = renderPack(targetNode, entries, truncated);
  // Re-estimate on the fully-rendered text so the reported figure matches what's injected.
  return { targetId: targetNode.id, entries, text, tokenEstimate: estimateTokens(text), truncated };
}

function renderPack(targetNode: GraphNode, entries: ContextPackEntry[], truncated: boolean): string {
  const out: string[] = [];
  const targetEntry = entries.find(e => e.role === 'target')!;
  const crit = targetNode.criticality ? ` [${targetNode.criticality}${targetNode.riskScore != null ? ` risk=${targetNode.riskScore}` : ''}]` : '';
  const loc = targetNode.filePath
    ? `${targetNode.filePath}${targetNode.startLine != null ? `:${targetNode.startLine}-${targetNode.endLine}` : ''}`
    : '(location unknown)';

  out.push(`===== CONTEXT PACK: ${targetNode.type} ${targetNode.name}${crit} =====`);
  out.push(`// ${loc}`);
  out.push('');
  out.push('--- TARGET (full source) ---');
  out.push(targetEntry.text);

  const callers = entries.filter(e => e.role === 'caller');
  if (callers.length) {
    out.push('');
    out.push('--- CALLERS (depend on this — update if you change its signature) ---');
    for (const c of callers) out.push(`// ${c.text}`);
  }

  const callees = entries.filter(e => e.role === 'callee');
  if (callees.length) {
    out.push('');
    out.push('--- CALLEES / TYPES (used by this) ---');
    for (const c of callees) out.push(`// ${c.text}`);
  }

  if (truncated) {
    out.push('');
    out.push('// (some neighbors omitted to fit the token budget — query GraphQueryTool for more)');
  }
  return out.join('\n');
}
