import { cliEvents } from '../cli/events';
import { IGraphStore } from '../graph/models';
import { summarizeGraph, isCodebase } from '../graph/graph.summary';
import { isCodememReady } from '../graph/codemem/backend';
import { getHeadroomSavedTokens } from '../memory/headroom.compress';

// Footer state that the Ink UI reads directly from engine singletons (getConfig, getGoalManager)
// rather than from events. An out-of-process front-end can't reach those, so we snapshot them into
// a `ui_snapshot` event the ProtocolHost forwards. Emitted once at startup and again whenever the
// underlying state changes (config / goals / graph), so the Go footer + map panel + token-meter
// stay live without polling.

export interface UiSnapshotModule {
  name: string;
  criticality?: string;
}

export interface UiSnapshotGraph {
  nodeCount: number;
  fileCount: number;
  aiGraphBuilt: boolean;
  modules: UiSnapshotModule[];
  // Which engine is backing the graph tools: 'codebase-memory' (baked-in 158-language engine with
  // local semantic search), 'native' (Bimax's in-memory AST graph), or 'none' (not indexed yet).
  // Lets the Go TUI badge the codebase map / footer so the user knows semantic search is live.
  engine: 'codebase-memory' | 'native' | 'none';
}

export interface UiSnapshot {
  models: { coding: string; lite: string };
  goalCount: number;
  // The codebase-map graph overview, mirrored so the Go front-end can render CodebaseMapPanel and
  // size its token-meter context window — neither of which it can compute from the engine singletons.
  graph: UiSnapshotGraph;
  // Effective context window (tokens) for the active model, so the Go token meter shows a real
  // "how full" fraction instead of a bare count. Resolved from config / model capabilities here.
  contextWindow: number;
  // The fixed cost every request pays — system prompt + tool-schema JSON — so the Go token meter
  // reflects real usage (thousands of tokens) instead of just the streamed reply (~tens). The
  // front-end adds the live conversation tokens on top. Mirrors Ink's systemPromptTokens.
  tokensBaseline: number;
  // Cumulative tokens saved this session by Headroom-style backlog compression — shown next to the
  // token meter so the user sees the compression paying off.
  compressionSaved: number;
}

/** Lazily-computed baseline (system prompt + tool schemas). Set by headless.entry, which has the
 *  personas + tool registry; ui.snapshot only sees the graph store. */
let baselineFn: (() => number) | undefined;
export function setTokensBaseline(fn: () => number): void { baselineFn = fn; }

function snapshot(graphStore?: IGraphStore): UiSnapshot {
  let models = { coding: '', lite: '' };
  let goalCount = 0;
  let contextWindow = 0;
  try {
    const { getConfig } = require('../cli/config');
    const c = getConfig();
    models = { coding: c.model, lite: c.liteModel };
    contextWindow = c.contextWindowTokens || 0;
  } catch { /* config not ready */ }
  if (!contextWindow || contextWindow <= 0) {
    try {
      const { capabilitiesFor } = require('../core/capabilities');
      contextWindow = capabilitiesFor(undefined, models.coding || models.lite).contextWindow || 0;
    } catch { /* capabilities optional */ }
  }
  try {
    const { getGoalManager } = require('../memory/goal.manager');
    goalCount = getGoalManager().getActiveGoals().length;
  } catch { /* goal manager not initialized */ }

  const codememReady = (() => { try { return isCodememReady(); } catch { return false; } })();
  let graph: UiSnapshotGraph = { nodeCount: 0, fileCount: 0, aiGraphBuilt: false, modules: [], engine: codememReady ? 'codebase-memory' : 'none' };
  try {
    // Only surface the map in a real project root — never in a scratch dir like ~ or the Desktop,
    // where a stale/global graph would otherwise show hundreds of thousands of junk nodes.
    if (graphStore && isCodebase(process.cwd())) {
      const s = summarizeGraph(graphStore);
      graph = {
        nodeCount: s.nodeCount,
        fileCount: s.fileCount,
        aiGraphBuilt: s.aiGraphBuilt,
        modules: s.topModules.slice(0, 5).map((m) => ({ name: m.name, criticality: m.criticality })),
        // codebase-memory wins the badge when live; else native if the in-memory graph has nodes.
        engine: codememReady ? 'codebase-memory' : (s.nodeCount > 0 ? 'native' : 'none'),
      };
    }
  } catch { /* graph summary best-effort */ }

  let tokensBaseline = 0;
  try { tokensBaseline = baselineFn ? baselineFn() : 0; } catch { /* best-effort */ }

  let compressionSaved = 0;
  try { compressionSaved = getHeadroomSavedTokens(); } catch { /* best-effort */ }

  return { models, goalCount, graph, contextWindow, tokensBaseline, compressionSaved };
}

/** Begin emitting `ui_snapshot` (immediately + on config/goal/graph changes). Call after the host attaches. */
export function startUiSnapshot(graphStore?: IGraphStore): void {
  const emit = () => cliEvents.emit('ui_snapshot', snapshot(graphStore));
  emit();
  cliEvents.on('config_changed', emit);
  cliEvents.on('goals_changed', emit);
  cliEvents.on('graph_changed', emit);
  cliEvents.on('mcp_changed', emit);
}
