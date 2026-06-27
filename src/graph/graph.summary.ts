import * as fs from 'fs';
import * as path from 'path';
import { IGraphStore, GraphNode } from './models';

// Top-level overview of the codebase graph — the data behind the pinned map panel and `/map`.
// Pure, React-free, and cheap so it can run on every render.

const CRIT_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export interface ModuleSummary {
  name: string;
  filePath?: string;
  criticality?: GraphNode['criticality'];
  riskScore?: number;
}

export interface GraphSummary {
  nodeCount: number;
  fileCount: number;
  topModules: ModuleSummary[];
  aiGraphBuilt: boolean; // true once the semantic augmenter has annotated nodes
}

function critRank(n: GraphNode): number {
  return CRIT_RANK[n.criticality || ''] || 0;
}

/** A node we can meaningfully surface as a "module" in the overview. */
function isSymbol(n: GraphNode): boolean {
  return n.type === 'FUNCTION' || n.type === 'CLASS' || n.type === 'INTERFACE';
}

/**
 * Summarize the graph for the overview UI. `topN` symbols are ranked by riskScore then
 * criticality, de-duped to one entry per file so the list reads like a module map rather
 * than a pile of methods from the same file.
 */
export function summarizeGraph(store: IGraphStore, topN: number = 6): GraphSummary {
  const nodes = Array.from(store.getGraph().nodes.values());
  let fileCount = 0;
  let aiGraphBuilt = false;
  const symbols: GraphNode[] = [];

  for (const n of nodes) {
    if (n.type === 'FILE') fileCount++;
    if (isSymbol(n)) symbols.push(n);
    // The semantic augmenter is the only thing that sets these fields; AST-only graphs lack them.
    if (!aiGraphBuilt && (n.criticality != null || n.riskScore != null || n.purpose != null)) {
      aiGraphBuilt = true;
    }
  }

  symbols.sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0) || critRank(b) - critRank(a));

  const seenFiles = new Set<string>();
  const topModules: ModuleSummary[] = [];
  for (const n of symbols) {
    const key = n.filePath || n.id;
    if (seenFiles.has(key)) continue;
    seenFiles.add(key);
    topModules.push({ name: n.name, filePath: n.filePath, criticality: n.criticality, riskScore: n.riskScore });
    if (topModules.length >= topN) break;
  }

  return { nodeCount: nodes.length, fileCount, topModules, aiGraphBuilt };
}

const CODEBASE_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Makefile', '.project'];

import * as os from 'os';

/** True if `cwd` looks like a real project root (not a scratch directory or the home folder). */
export function isCodebase(cwd: string): boolean {
  try {
    const isHome = path.resolve(cwd) === path.resolve(os.homedir());
    const isRoot = path.resolve(cwd) === path.resolve('/');
    if (isHome || isRoot) return false;
  } catch { /* ignore */ }

  return CODEBASE_MARKERS.some((m) => {
    try { return fs.existsSync(path.join(cwd, m)); } catch { return false; }
  });
}
