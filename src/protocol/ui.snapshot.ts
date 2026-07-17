import { cliEvents } from '../cli/events';
import { IGraphStore } from '../graph/models';
import { summarizeGraph, isCodebase } from '../graph/graph.summary';
import { isCodememReady } from '../graph/codemem/backend';
import { getHeadroomSavedTokens } from '../memory/headroom.compress';
import type { ToolRegistry, ContextMode } from '../tools/tool.registry';

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
  // local semantic search), 'native' (BiMax's in-memory AST graph), or 'none' (not indexed yet).
  // Lets the Go TUI badge the codebase map / footer so the user knows semantic search is live.
  engine: 'codebase-memory' | 'native' | 'none';
}

// Mind-layer strip for the footer: how many learned weak spots the self-model is routing
// around, how many drives are deviating (fresh measurements only), and compiled habit count.
// The detail arrays make the 🧠 chip EXPLAINABLE (v2 §3.11): the TUI's mind HUD renders the
// top weak spots with their posterior stats, the deviating drives with a measurement
// sparkline, and the compiled habit names — evidence, not an opaque counter.
export interface UiSnapshotMindWeak {
  tool: string;
  domain: string;
  failRate: number; // posterior mean failure rate
  pWeak: number;    // P(θ > weak level) — the decision statistic
  n: number;        // window samples behind it
  advice: string;
}

export interface UiSnapshotMindDrive {
  label: string;
  value: string;    // human-readable last measurement ("3 type errors", "41 TODOs")
  ok: boolean;      // at setpoint?
  // Recent measurement history, oldest → newest (1 = at setpoint, 0 = deviating) — sparkline fuel.
  spark: number[];
}

// The epistemic ledger's verification posture — the correctness half of the mind HUD's "receipts".
export interface UiSnapshotMindLedger {
  resolved: number;      // claims a build/test run confirmed
  open: number;          // edits whose correctness nothing has checked yet
  expired: number;       // claims that timed out unverified (a verification-coverage gap)
  coveragePct: number;   // resolved / (resolved + expired) — % of claims that ever met evidence
  overconfident: number; // domains with a statistically significant overconfidence gap
}

export interface UiSnapshotMind {
  weakSpots: number;
  driveDeviations: number;
  habits: number;
  weak?: UiSnapshotMindWeak[];
  drives?: UiSnapshotMindDrive[];
  habitNames?: string[];
  ledger?: UiSnapshotMindLedger;
}

// --- Protocol v2 additive fields ------------------------------------------------------------
// All optional: a v1 front-end ignores them, a v2 front-end hides the matching panel when absent.

/** One saved session for the front-end's session list (sidebar) — from db/session.meta. */
export interface UiSnapshotSession {
  id: string;
  title: string;
  startedAt: string; // ISO
  messageCount: number;
  cwd: string;
  current: boolean;  // the live session this engine process is writing
}

/** One Time Machine checkpoint (sandbox/checkpoint.manager) for the History strip. */
export interface UiSnapshotCheckpoint {
  id: string;
  label: string;
  ts: number;   // epoch ms
  auto: boolean;
}

export interface UiSnapshotGit {
  branch: string;
  dirty: number; // changed files (index + worktree + untracked)
  ahead: number;
  behind: number;
}

/** Computer-use posture: what BiMax can observe/act on right now, truthfully. All values are read
 * from live engine state (browser runtime, MCP manager, model capabilities, governor, taint). */
export interface UiSnapshotComputer {
  /** URL of the live automated page, or null when no browser session is open. */
  browserUrl: string | null;
  /** Desktop-control companion (pinned open-computer-use MCP): install/connection posture. */
  desktop: 'connected' | 'configured' | 'not-installed';
  /** Registered native desktop tool count (0 unless connected). */
  desktopTools: number;
  /** Whether the ACTIVE model advertises vision (screenshots become model-visible observations). */
  vision: boolean;
  /** Standing session-scoped computer-control grants (domain:… / app:…). */
  grants: string[];
  /** Untrusted web/MCP/page content has entered the conversation window. */
  tainted: boolean;
}

/** Live tool fabric: what the model can call now vs what remains load-on-demand. */
export interface UiSnapshotTools {
  registered: number;
  ready: number;
  deferred: number;
  discovered: number;
  mcp: number;
  graphReady: boolean;
}

export interface UiSnapshot {
  models: { coding: string; lite: string };
  goalCount: number;
  mind: UiSnapshotMind;
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
  // Multi-repo workspace: how many repos are in context and their names, so the TUI status bar
  // always shows the working set (workspace.manager.ts). count <= 1 = single-repo session.
  workspace: { count: number; names: string[]; writable: number };
  // v2: recent sessions (newest first, capped) for the front-end sidebar; resume via `/resume <id>`.
  sessions?: UiSnapshotSession[];
  // v2: Time Machine checkpoints (newest first, capped) for the History strip; restore via `/rewind <id>`.
  checkpoints?: UiSnapshotCheckpoint[];
  // v2: coarse git state for header pills. Front-ends that can poll git natively (the Electron app)
  // may prefer their own fresher poll; this is for the ones that can't.
  git?: UiSnapshotGit;
  // v3 additive: live registry posture for desktop/tooling surfaces.
  tools?: UiSnapshotTools;
  // v3 additive: computer-use capability/safety posture for the desktop app's Runtime lane.
  computer?: UiSnapshotComputer;
}

/** Lazily-computed baseline (system prompt + tool schemas). Set by headless.entry, which has the
 *  personas + tool registry; ui.snapshot only sees the graph store. */
let baselineFn: (() => number) | undefined;
export function setTokensBaseline(fn: () => number): void { baselineFn = fn; }

function snapshot(graphStore?: IGraphStore, toolRegistry?: ToolRegistry): UiSnapshot {
  let models = { coding: '', lite: '' };
  let goalCount = 0;
  let contextWindow = 0;
  let contextMode: ContextMode = 'smart';
  try {
    const { getConfig } = require('../cli/config');
    const c = getConfig();
    models = { coding: c.model, lite: c.liteModel };
    contextWindow = c.contextWindowTokens || 0;
    contextMode = c.contextMode === 'full' ? 'full' : 'smart';
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

  let mind: UiSnapshotMind = { weakSpots: 0, driveDeviations: 0, habits: 0 };
  try {
    const { getSelfModel } = require('../mind/self.model');
    const { getDrivesEngine } = require('../mind/drives.engine');
    const { getHabitMiner } = require('../mind/habit.compiler');
    const { getEpistemicLedger } = require('../mind/epistemic.ledger');
    const weakAll = getSelfModel().weakSpots();
    const drivesEngine = getDrivesEngine();
    const deviations = drivesEngine.deviations();
    const compiled = getHabitMiner().habits().filter((h: any) => h.compiled);
    // Drive detail: deviating drives first, then healthy measured ones, capped at 5 —
    // enough for the HUD without bloating every snapshot frame.
    const measured = (drivesEngine.list() as any[])
      .filter((d: any) => d.lastOk !== undefined)
      .sort((a: any, b: any) => Number(a.lastOk) - Number(b.lastOk))
      .slice(0, 5);
    mind = {
      weakSpots: weakAll.length,
      driveDeviations: deviations.length,
      habits: compiled.length,
      weak: weakAll.slice(0, 4).map((w: any) => ({
        tool: w.tool, domain: w.domain, failRate: w.failRate, pWeak: w.pWeak, n: w.n, advice: w.advice,
      })),
      drives: measured.map((d: any) => ({
        label: d.label,
        value: d.lastValue || '',
        ok: !!d.lastOk,
        spark: (d.history || []).slice(-16).map((h: any) => (h.ok ? 1 : 0)),
      })),
      habitNames: compiled.slice(0, 5).map((h: any) => h.slug || h.key),
      ledger: (() => {
        const st = getEpistemicLedger().stats();
        const met = st.resolved + st.expired;
        return {
          resolved: st.resolved, open: st.open, expired: st.expired,
          coveragePct: met > 0 ? Math.round((st.resolved / met) * 100) : 0,
          overconfident: (getEpistemicLedger().overconfidentDomains() || []).length,
        };
      })(),
    };
  } catch { /* mind layer best-effort */ }

  let workspace = { count: 0, names: [] as string[], writable: 0 };
  try {
    const { tryGetWorkspace } = require('../core/workspace.manager');
    const ws = tryGetWorkspace();
    if (ws) workspace = ws.snapshot();
  } catch { /* workspace best-effort */ }

  // v2 fields — each independently best-effort so one broken subsystem never blanks the others.
  let sessions: UiSnapshotSession[] | undefined;
  try {
    const { listSessionMeta, getCurrentSessionId } = require('../db/session.meta');
    const current = getCurrentSessionId();
    sessions = (listSessionMeta(20) as any[]).map((m) => ({
      id: m.id,
      title: m.title || '(no messages yet)',
      startedAt: m.startedAt || '',
      messageCount: m.messageCount || 0,
      cwd: m.cwd || '',
      current: m.id === current,
    }));
  } catch { /* session meta best-effort */ }

  let checkpoints: UiSnapshotCheckpoint[] | undefined;
  try {
    const { globalCheckpointManager } = require('../sandbox/checkpoint.manager');
    if (globalCheckpointManager.isGitRepo()) {
      checkpoints = (globalCheckpointManager.list() as any[]).slice(0, 15).map((c) => ({
        id: c.id, label: c.label, ts: c.timestamp, auto: !!c.auto,
      }));
    }
  } catch { /* checkpoints best-effort */ }

  let git: UiSnapshotGit | undefined;
  try {
    const { getGitStatus } = require('../cli/git');
    const s = getGitStatus(process.cwd());
    if (s) {
      git = {
        branch: s.branch,
        dirty: s.added.length + s.modified.length + s.deleted.length + s.unstaged.length,
        ahead: s.ahead,
        behind: s.behind,
      };
    }
  } catch { /* git best-effort */ }

  let computer: UiSnapshotComputer | undefined;
  try {
    const { globalBrowserRuntime } = require('../browser/browser.runtime');
    const { globalMcpManager } = require('../mcp/manager');
    const { getTaintTracker } = require('../mind/taint');
    const desktopConnected = !!globalMcpManager.get('open-computer-use');
    const desktopConfigured = desktopConnected || globalMcpManager.configuredNames().includes('open-computer-use');
    let vision = false;
    try {
      const { capabilitiesFor } = require('../core/capabilities');
      vision = !!capabilitiesFor(undefined, models.coding || models.lite).visionInput;
    } catch { /* capabilities optional */ }
    computer = {
      browserUrl: (() => { try { return globalBrowserRuntime.currentUrl?.() ?? null; } catch { return null; } })(),
      desktop: desktopConnected ? 'connected' : desktopConfigured ? 'configured' : 'not-installed',
      desktopTools: desktopConnected ? (globalMcpManager.get('open-computer-use')?.toolNames.length ?? 0) : 0,
      vision,
      grants: (governorRef as any)?.computerGrants?.() ?? [],
      tainted: (() => { try { return getTaintTracker().isTainted(); } catch { return false; } })(),
    };
  } catch { /* computer posture best-effort */ }

  let tools: UiSnapshotTools | undefined;
  try {
    if (toolRegistry) {
      const names = toolRegistry.getToolNames();
      tools = {
        registered: names.length,
        ready: names.filter((name) => toolRegistry.isSent(name, contextMode)).length,
        deferred: names.filter((name) => toolRegistry.isDeferred(name) && !toolRegistry.isDiscovered(name)).length,
        discovered: names.filter((name) => toolRegistry.isDiscovered(name)).length,
        mcp: names.filter((name) => name.startsWith('mcp__')).length,
        graphReady: toolRegistry.isGraphReady(),
      };
    }
  } catch { /* registry posture best-effort */ }

  return { models, goalCount, mind, graph, contextWindow, tokensBaseline, compressionSaved, workspace, sessions, checkpoints, git, tools, computer };
}

// The governor is per-container (no engine singleton), so the host hands it in at startup for the
// computer-use grants readout. Absent → grants render empty, everything else still populates.
let governorRef: unknown;
export function setUiSnapshotGovernor(governor: unknown): void { governorRef = governor; }

/** Begin emitting `ui_snapshot` (immediately + on config/goal/graph changes). Call after the host attaches. */
export function startUiSnapshot(graphStore?: IGraphStore, toolRegistry?: ToolRegistry): void {
  // First snapshot is synchronous (the front-end needs footer state with the `ready` handshake);
  // afterwards a trailing 80ms debounce coalesces change bursts — a /beast step can fire
  // config+goals+graph+mind together, and each snapshot walks the whole graph summary.
  cliEvents.emit('ui_snapshot', snapshot(graphStore, toolRegistry));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emit = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      cliEvents.emit('ui_snapshot', snapshot(graphStore, toolRegistry));
    }, 80);
    timer.unref?.();
  };
  cliEvents.on('config_changed', emit);
  cliEvents.on('goals_changed', emit);
  cliEvents.on('graph_changed', emit);
  cliEvents.on('mcp_changed', emit);
  cliEvents.on('tools_changed', emit);
  // Mind layer: re-snapshot when self-model / drives / habits change so the footer's 🧠 strip
  // stays live.
  cliEvents.on('mind_changed', emit);
  // Workspace: repo registered / scoped / ignored → status-bar repo chip updates.
  cliEvents.on('workspace_changed', emit);
  // v2: checkpoint created / rewound → History strip updates; clear/resume → session list updates.
  cliEvents.on('timemachine_changed', emit);
  cliEvents.on('clear', emit);
  // Session recorder: thread created / titled / rotated / resumed → sidebar session list updates.
  cliEvents.on('session_changed', emit);
}
