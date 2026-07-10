// Mirror of the engine's wire contract (src/protocol/protocol.ts in the repo root) plus the
// payload shapes the renderer consumes (src/cli/events.ts, src/protocol/ui.snapshot.ts).
// Keep in sync by hand — the protocol is versioned (PROTOCOL_VERSION) and the app refuses to
// drive a mismatched engine.

// v2 (2026-07-10): ui_snapshot gains optional sessions / checkpoints / git — all additive; this
// app hides the matching UI (sessions list, History strip) when a field is absent, so an older
// engine still works behind the mismatch banner.
// v3 (2026-07-11): silent config round-trip (configGet/configSet → configResult) — Settings
// pages read/write the engine config directly, nothing prints into the transcript.
export const PROTOCOL_VERSION = 3;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

// --- Outbound: engine → app ---------------------------------------------------------------

export interface EventMsg { t: 'event'; name: string; args: any[] }

export interface RequestMsg {
  t: 'request';
  id: number;
  kind: 'prompt' | 'diff' | 'input';
  question: string;
  options: string[];
  isAsk?: boolean;
  isMulti?: boolean;
  body?: string;
  masked?: boolean;
}

export interface ReadyMsg { t: 'ready'; protocol: number }

export interface CompletionItem {
  value: string;
  label: string;
  desc: string;
  kind: 'command' | 'symbol' | 'path';
  disabled?: boolean;
  disabledReason?: string;
}

export interface QueryResultMsg { t: 'queryResult'; id: number; items: CompletionItem[] }
export interface PongMsg { t: 'pong'; id: number }
export interface ConfigResultMsg { t: 'configResult'; id: number; config: { [k: string]: JsonValue } }

export type Outbound = EventMsg | RequestMsg | ReadyMsg | QueryResultMsg | PongMsg | ConfigResultMsg;

// --- Inbound: app → engine ------------------------------------------------------------------

export interface ReplyMsg { t: 'reply'; id: number; value: string }
export interface InputMsg { t: 'input'; text: string }
export interface InterruptMsg { t: 'interrupt' }
export interface QueryMsg { t: 'query'; id: number; text: string }
export interface MenuSelectMsg { t: 'menuSelect'; id: string; value: string }
export interface PingMsg { t: 'ping'; id: number }
export interface ConfigGetMsg { t: 'configGet'; id: number }
export interface ConfigSetMsg { t: 'configSet'; id: number; patch: { [k: string]: JsonValue } }

export type Inbound = ReplyMsg | InputMsg | InterruptMsg | QueryMsg | MenuSelectMsg | PingMsg | ConfigGetMsg | ConfigSetMsg;

/** The engine settings the wire exposes (allowlist lives in headless.entry.ts). */
export interface EngineConfig {
  model?: string;
  liteModel?: string;
  fallbackModel?: string;
  subagentModel?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeout?: number;
  reasoningEffort?: string;
  contextMode?: 'smart' | 'full';
  contextWindowTokens?: number;
  parallelToolCalls?: boolean;
  maxToolIterations?: number;
  maxSubAgents?: number;
  notificationBell?: boolean;
  verbose?: boolean;
  reducedMotion?: boolean;
  theme?: string;
  autoIndex?: boolean;
  gitAutoCommit?: boolean;
  autoVerify?: boolean;
  sandboxBash?: boolean;
  selfCritic?: boolean;
  adversarialVerify?: boolean;
  diffApproval?: boolean;
  blastGate?: boolean;
  showMapPanel?: boolean;
  showTokenMeter?: boolean;
}

// --- Event payloads --------------------------------------------------------------------------

export interface ToolCallEntry {
  id: string;
  toolName: string;
  input: string;
  output: string;
  status: 'running' | 'success' | 'error';
  startTime: string;
  endTime?: string;
  parentId?: string;
  agentLabel?: string;
}

export interface MessageEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  level?: 'info' | 'warn' | 'error' | 'success';
  uiComponent?: string;
  payload?: any;
  content: string;
  thoughtMs?: number;
  timestamp: string;
}

export interface MindWeakSpot {
  tool: string;
  domain: string;
  failRate: number;
  pWeak: number;
  n: number;
  advice: string;
}

export interface MindDrive {
  label: string;
  value: string;
  ok: boolean;
  spark: number[];
}

export interface MindLedger {
  resolved: number;
  open: number;
  expired: number;
  coveragePct: number;
  overconfident: number;
}

/** One sub-agent claim from the engine's blackboard (subagent_update payload). */
export interface SubAgentClaim {
  taskId: string;
  agentType: string;
  scope: string;
  prompt: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  toolCalls: number;
  endedAt?: number;
  result?: string;
  error?: string;
}

/** v2: one saved session for the sidebar list; resume with `/resume <id>`. */
export interface UiSnapshotSession {
  id: string;
  title: string;
  startedAt: string;
  messageCount: number;
  cwd: string;
  current: boolean;
}

/** v2: one Time Machine checkpoint for the History strip; restore with `/rewind <id>`. */
export interface UiSnapshotCheckpoint {
  id: string;
  label: string;
  ts: number;
  auto: boolean;
}

export interface UiSnapshot {
  models: { coding: string; lite: string };
  goalCount: number;
  mind: {
    weakSpots: number;
    driveDeviations: number;
    habits: number;
    weak?: MindWeakSpot[];
    drives?: MindDrive[];
    habitNames?: string[];
    ledger?: MindLedger;
  };
  graph: {
    nodeCount: number;
    fileCount: number;
    aiGraphBuilt: boolean;
    modules: { name: string; criticality?: string }[];
    engine: 'codebase-memory' | 'native' | 'none';
  };
  contextWindow: number;
  tokensBaseline: number;
  compressionSaved: number;
  workspace: { count: number; names: string[]; writable: number };
  sessions?: UiSnapshotSession[];
  checkpoints?: UiSnapshotCheckpoint[];
  git?: { branch: string; dirty: number; ahead: number; behind: number };
}
