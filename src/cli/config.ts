import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ─── Configuration scopes and precedence ────────────────────────────────────────────────────────
// Effective config is composed from explicit scopes, lowest to highest precedence:
//
//   1. BUILT-IN DEFAULTS  (DEFAULTS below)
//   2. USER GLOBAL        ~/.breakglass/config.json          — persisted preferences
//   3. WORKSPACE/PROJECT  <cwd>/.breakglass/config.json      — per-codebase fields only
//   4. ENVIRONMENT        BGW_* variables                    — volatile, session-scoped
//
// (CLI flags and test overrides ride the ENVIRONMENT scope: both set BGW_*/BIMAX_* vars.)
//
// The invariant that makes scope 4 safe: VOLATILE VALUES NEVER PERSIST. Only two things may
// write config files — an explicit user action (a /command, the Settings UI) or a runtime
// recovery write that passes the volatility guard in saveConfig. This is the structural fix for
// the observed contamination class: a benchmark run with BGW_MODEL=mock caused healModel to
// persist {"model":"mock"} into the user's global config. Provenance is queryable via
// configSource(key), and every file write is atomic (tmp + rename).
// API keys are stored separately in ~/.breakglass/.env (see env.loader.ts).

// BIMAX_BREAKGLASS_DIR relocates the global dir (multi-profile + test isolation) — the same
// override env.loader.ts honours for the secrets file. Resolved lazily so tests can retarget it.
const globalDir = () => process.env.BIMAX_BREAKGLASS_DIR || path.join(os.homedir(), '.breakglass');
const globalPath = () => path.join(globalDir(), 'config.json');
const projectDir = () => path.join(process.cwd(), '.breakglass');
const projectPath = () => path.join(projectDir(), 'config.json');

// Fields that belong to the project, not to the user's global preferences.
const PROJECT_KEYS: (keyof CliConfig)[] = ['onboardingComplete', 'workspaceRoot'];

// Environment overrides: the volatile scope. Maps config key → env var. Parsed on load; tracked
// as provenance 'env'; refused persistence for runtime-origin writes.
const ENV_OVERRIDES: Partial<Record<keyof CliConfig, string>> = {
  model: 'BGW_MODEL',
  liteModel: 'BGW_LITE_MODEL',
  visionModel: 'BGW_VISION_MODEL',
  reasoningEffort: 'BGW_REASONING_EFFORT',
  computerPip: 'BIMAX_COMPUTER_PIP',
  computerRecord: 'BIMAX_COMPUTER_RECORD',
  computerVisible: 'BIMAX_COMPUTER_VISIBLE',
  // Lets tests/CI pin the approval cadence deterministically (the PTY approval scenarios depend
  // on 'always'), and lets cautious users force per-action prompts without editing config files.
  computerApprovals: 'BIMAX_COMPUTER_APPROVALS',
};

export type ConfigSource = 'default' | 'global' | 'project' | 'env';

export interface CliConfig {
  defaultAgent: string;
  model: string;       // the CODING model — drives the main agent loop
  liteModel: string;   // the LITE model — used for cheap aux calls (summaries, self-critic, ask-user)
  visionModel: string; // the VISION model — image turns reroute here when the coding model is text-only ('' = none)
  // Resilience chain: when the active model keeps failing mid-run (retry budget exhausted, or the
  // provider starts rejecting it), the loop switches to this model once instead of dying. '' = off.
  fallbackModel: string;
  // Model sub-agents run on. '' (default) = inherit the main model. A per-spawn `model` arg on
  // SpawnSubagentTool overrides this for that one agent.
  subagentModel: string;
  timeout: number;
  temperature: number;
  topP: number; // nucleus sampling cap; clips the low-probability tail that drives dropped tool args / fabricated paths
  maxTokens: number;
  theme: string;
  verbose: boolean;
  dangerouslySkipPermissions: boolean;
  skipSemanticMetadata: boolean;
  autoIndex: boolean;
  excludeFromIndex: string[];
  maxToolIterations: number;
  maxSubAgents: number;
  // Resume recent, bounded outcome assignments after an engine crash. Bypass-mode and ambiguous
  // snapshots always require manual recovery regardless of this preference.
  autoResumeAgents: boolean;
  // Wake the parent coordinator when background outcome work settles, then keep converging until
  // verified, waiting on active work, user-blocked, interrupted, or stopped by a circuit breaker.
  autoContinueOutcome: boolean;
  notificationBell: boolean;
  customRoutingRules: string[][];
  workspaceRoot: string;
  autoAgentDecisions: boolean;
  diffApproval: boolean;
  blastGate: boolean; // G5: confirm edits touching HIGH/CRITICAL graph symbols (off by default)
  gitAutoCommit: boolean; // B1: auto-commit each successful edit (off by default)
  autoVerify: boolean; // B2: typecheck after edits + feed errors back (off by default)
  sandboxBash: boolean; // B3: run BashTool under macOS sandbox-exec (off by default)
  selfCritic: boolean;
  adversarialVerify: boolean; // Phase 4: full-model red-team pass after self-critic (off by default)
  allowSelfEvolution: boolean;
  reasoningEffort?: string; // off by default; 'low'|'medium'|'high' to speed up thinking models
  onboardingComplete: boolean; // per-project: has the map-graph/AI-graph onboarding flow run once?
  showMapPanel: boolean; // pinned codebase-map overview panel above the input
  showTokenMeter: boolean; // live "tokens that will be sent" estimate near the input
  // How much we put on the wire each turn:
  //   'smart' (default) — send only the core working-set of tool schemas; rare/heavy tools and
  //                       all MCP tools are deferred, loaded on demand via ToolSearchTool.
  //   'full'            — send every tool description, every turn (no deferral). Heavier, but the
  //                       model always sees the entire toolbox.
  contextMode: 'smart' | 'full';
  // The active model's context window in tokens. Drives when proactive compaction fires. 0 = use
  // the safe built-in default (128k). Set this to YOUR model's real window — bimax talks to any
  // OpenAI-compatible provider, so we can't reliably auto-detect it (no Claude-style per-variant map).
  contextWindowTokens: number;
  // Let the model emit multiple tool calls per turn (batched reads/greps run concurrently → faster).
  // Default true; set false for backends that reject multi-tool turns (e.g. NVIDIA NIM).
  parallelToolCalls: boolean;
  // Optional TUI keybinding overrides, e.g. { "search": "ctrl+/", "toggleLogs": "ctrl+l" }.
  // Action names + defaults live in keybindings.ts; only overrides go here.
  keybindings?: Record<string, string>;
  // Accessibility: calm static UI — disables spinner/shimmer animation (also set via BGW_REDUCED_MOTION env).
  reducedMotion?: boolean;
  // Computer-use approval cadence: 'always' prompts for every acting verb (click/type/open/…);
  // 'high-impact-only' auto-approves routine interaction and prompts ONLY for high-impact actions
  // (delete/send/purchase/submit/permissions — see action.impact.ts). The sensitive-target hard
  // floor (password managers, security settings, wallets) applies in BOTH modes and cannot be waived.
  computerApprovals: 'always' | 'high-impact-only';
  // true: visible physical mouse/keyboard with the target raised. false: background-first semantic
  // Accessibility delivery, with PID-scoped sidecar fallback for controls lacking AX handles.
  computerVisible: boolean;
  // Native always-on-top ScreenCaptureKit stream of the active target window. It is presentation
  // only: model perception still uses the original per-action PNG and exact coordinate metadata.
  computerPip: boolean;
  // Opt-in: allow computer-use screen recording. Recording NEVER starts implicitly — only an
  // explicit record_start action (which itself requires approval, and separate explicit approval
  // for whole-display capture) can begin one, and only when this is true.
  computerRecord: boolean;
}

const DEFAULTS: CliConfig = {
  defaultAgent: 'bimax',
  // Work: fastest prompt-faithful text controller in the grounded 2026-07-29 rerun (exact reply
  // 0.36s, correct ComputerTool open 0.57s). Screenshot turns route to the explicit Vision slot.
  model: 'mistralai/mistral-nemotron',
  // Quick slot: plain model, never a reasoner. Live exact reply 0.61s; valid tool call 0.56s.
  liteModel: 'meta/llama-3.1-8b-instruct',
  // Vision: the only served candidate that both typed the exact message for a proven contact and
  // refused to act blindly when the selected phone-number conversation was not the recipient.
  visionModel: 'nvidia/nemotron-nano-12b-v2-vl',
  fallbackModel: '', // off by default — set to a second NIM id to survive mid-run model outages
  subagentModel: '', // '' = sub-agents use the main model

  timeout: 120000,
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 4096,
  theme: 'auto',
  verbose: false,
  dangerouslySkipPermissions: false,
  skipSemanticMetadata: false,
  autoIndex: true,
  excludeFromIndex: [],
  maxToolIterations: 500, // Several hours of visual stepping at ordinary model latency; progress-aware loop guards catch stalls.
  maxSubAgents: 4, // hard global runtime ceiling; nested agents share the same lease coordinator
  autoResumeAgents: true,
  autoContinueOutcome: true,
  notificationBell: false,
  customRoutingRules: [],
  workspaceRoot: process.cwd(),
  autoAgentDecisions: false,
  diffApproval: false,
  blastGate: false,
  gitAutoCommit: false,
  autoVerify: false,
  sandboxBash: false,
  selfCritic: false,
  adversarialVerify: false,
  allowSelfEvolution: false,
  onboardingComplete: false,
  showMapPanel: true,
  showTokenMeter: true,
  contextMode: 'smart',
  contextWindowTokens: 0,
  parallelToolCalls: true,
  computerApprovals: 'high-impact-only',
  // Reliability default: visible physical input. Users can choose background-first coexistence;
  // action receipts and fresh target-window screenshots still verify every delivered step.
  computerVisible: true,
  computerPip: true,
  // Privacy default: recording is OFF. Screen recording captures everything visible — it must be
  // an explicit, approved user decision (record_start), never an ambient side effect of acting.
  computerRecord: false,
};

let cached: CliConfig | null = null;
let sources: Partial<Record<keyof CliConfig, ConfigSource>> = {};

/** Where the effective value of `key` came from. 'default' until loadConfig() has run. */
export function configSource(key: keyof CliConfig): ConfigSource {
  return sources[key] || 'default';
}

/** Test seam: drop the module-level cache so the next loadConfig() re-reads scopes. */
export function __resetConfigForTests(): void {
  cached = null;
  sources = {};
}

// Distinguishes "file absent" (normal) from "file corrupt" (must not be silently treated as
// empty — a later save would then rewrite the file from just the update, losing every other
// key). A corrupt file is preserved to config.json.corrupt-<ts> and an empty scope returned.
async function readJson(file: string): Promise<Partial<CliConfig>> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    return {}; // absent/unreadable — an empty scope
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      await fs.copyFile(file, backup);
      console.warn(`[Config] ${file} is not valid JSON — preserved a copy at ${backup} and continuing with defaults for that scope.`);
    } catch { /* best-effort backup */ }
    return {};
  }
}

// Atomic write: same-directory temp file + rename, so a crash mid-write can never leave a
// half-written config.json, and concurrent writers each land a complete file (last one wins,
// which is the same semantics the two processes would have had with whole-file writes).
let tmpSeq = 0;
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../core/fault.injection').faultPoint('config.write');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${++tmpSeq}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8');
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    try { await fs.unlink(tmp); } catch { /* already gone */ }
    throw e;
  }
}

function parseEnvValue(key: keyof CliConfig, raw: string): unknown {
  const kind = typeof (DEFAULTS as any)[key];
  if (kind === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
  if (kind === 'boolean') return raw !== 'false' && raw !== '0';
  return raw;
}

export async function loadConfig(): Promise<CliConfig> {
  if (cached) return cached;
  const globalCfg = await readJson(globalPath());
  const rawProjectCfg = await readJson(projectPath());
  // Old builds wrote the whole default object into .breakglass/config.json. Letting those stale
  // values override current defaults silently kept this workspace at 50 iterations even after the
  // long-run default was raised. The scope contract above is authoritative: only project-owned
  // fields may flow from this file.
  const projectCfg = Object.fromEntries(
    PROJECT_KEYS.filter(key => key in rawProjectCfg).map(key => [key, rawProjectCfg[key]]),
  ) as Partial<CliConfig>;
  // Compose the scopes in precedence order, recording where each effective value came from.
  const merged: CliConfig = { ...DEFAULTS, ...globalCfg, ...projectCfg };
  sources = {};
  for (const key of Object.keys(DEFAULTS) as (keyof CliConfig)[]) {
    if (key in projectCfg) sources[key] = 'project';
    else if (key in globalCfg) sources[key] = 'global';
    else sources[key] = 'default';
  }
  // Environment overrides win over both files but are VOLATILE: they colour the session and are
  // never written back. (Previously config.model silently clobbered BGW_MODEL — the precedence
  // was backwards, and the mock benchmark only worked because healModel then "healed" the config
  // model to the mock id and persisted it into the user's real config.)
  for (const [key, envVar] of Object.entries(ENV_OVERRIDES) as [keyof CliConfig, string][]) {
    const raw = process.env[envVar];
    if (raw !== undefined && raw !== '') {
      const v = parseEnvValue(key, raw);
      if (v !== undefined) { (merged as any)[key] = v; sources[key] = 'env'; }
    }
  }
  cached = merged;
  cached.workspaceRoot = path.resolve(projectCfg.workspaceRoot || globalCfg.workspaceRoot || DEFAULTS.workspaceRoot);
  // Migration: earlier builds saved "one model everywhere" by literally copying the coding model
  // into the lite slot. With a reasoning model that meant every small task (greeting, summary,
  // routing) sat behind an unhidable 20-30s think phase. Split it back apart in memory — the
  // coding slot keeps the user's pick; quick replies go to the plain lite default. Non-reasoning
  // picks are untouched (true single-model setups stay unified).
  try {
    const { isReasoningModel, LEGACY_SAFE_LITE_MODEL } = require('./models');
    if (cached.liteModel && cached.liteModel === cached.model && isReasoningModel(cached.liteModel)) {
      cached.liteModel = LEGACY_SAFE_LITE_MODEL;
    }
  } catch { /* models module unavailable in some test harnesses — defaults already sane */ }
  return cached;
}

export function getConfig(): CliConfig {
  if (!cached) throw new Error('Config not loaded. Call loadConfig() first.');
  return cached;
}

export interface SaveOptions {
  /**
   * Who is asking for persistence.
   *   'user'    (default) — an explicit user action (/command, Settings UI). Always persisted.
   *   'runtime' — automatic recovery/healing. Persisted ONLY when the affected key's effective
   *               value did not come from a volatile scope: if the key is currently
   *               env-overridden, the recovery was recovering a session-scoped value, and writing
   *               it would leak test/benchmark/CI state into the user's real configuration.
   */
  origin?: 'user' | 'runtime';
}

// In-process saves are serialized so two same-tick writers can't interleave their
// read-merge-write cycles (each write still lands atomically; this makes the MERGE atomic too).
let saveChain: Promise<unknown> = Promise.resolve();

export function saveConfig(updates: Partial<CliConfig>, opts: SaveOptions = {}): Promise<CliConfig> {
  const run = saveChain.then(() => doSave(updates, opts), () => doSave(updates, opts));
  saveChain = run;
  return run;
}

async function doSave(updates: Partial<CliConfig>, opts: SaveOptions = {}): Promise<CliConfig> {
  const origin = opts.origin || 'user';
  const current = await loadConfig();

  // The volatility guard: runtime-origin writes to env-overridden keys are dropped (in-memory
  // state still updates, so the session keeps working with the recovered value).
  let accepted: Partial<CliConfig> = updates;
  if (origin === 'runtime') {
    accepted = {};
    for (const [key, value] of Object.entries(updates) as [keyof CliConfig, any][]) {
      if (sources[key] === 'env') {
        console.warn(`[Config] Not persisting runtime change to "${key}" — its value came from ${ENV_OVERRIDES[key] || 'the environment'} and is session-scoped.`);
      } else {
        (accepted as any)[key] = value;
      }
    }
  }

  cached = { ...current, ...updates }; // the live session always reflects the requested state

  // Route each accepted key to the file it belongs in.
  const globalUpdates: Record<string, any> = {};
  const projectUpdates: Record<string, any> = {};
  for (const [key, value] of Object.entries(accepted)) {
    if (PROJECT_KEYS.includes(key as keyof CliConfig)) projectUpdates[key] = value;
    else globalUpdates[key] = value;
    // A persisted value's provenance becomes its destination scope.
    sources[key as keyof CliConfig] = PROJECT_KEYS.includes(key as keyof CliConfig) ? 'project' : 'global';
  }

  try {
    if (Object.keys(globalUpdates).length) {
      const existing = await readJson(globalPath());
      await writeJsonAtomic(globalPath(), { ...existing, ...globalUpdates });
      // Migrate-on-write: a legacy combined project file merges LAST in loadConfig, so a stale copy
      // of a global key there (e.g. an old `model`) silently shadows the value we just saved — the
      // user "changes model" and nothing actually changes (this pinned sub-agents to a model the
      // user had switched away from). Strip the just-updated global keys from the project file.
      try {
        const existingProject = await readJson(projectPath());
        const stale = Object.keys(globalUpdates).filter(k => k in existingProject);
        if (stale.length) {
          for (const k of stale) delete (existingProject as any)[k];
          await writeJsonAtomic(projectPath(), existingProject);
        }
      } catch { /* no project file — nothing to migrate */ }
    }
    if (Object.keys(projectUpdates).length) {
      const existing = await readJson(projectPath());
      await writeJsonAtomic(projectPath(), { ...existing, ...projectUpdates });
    }
  } catch (e: any) {
    // A read-only config dir (EROFS/EACCES/EPERM) must not crash the session — the in-memory
    // state above already reflects the change; it just won't survive a restart.
    if (['EROFS', 'EACCES', 'EPERM'].includes(e?.code)) {
      console.warn(`[Config] Config directory is not writable (${e.code}) — change applies to this session only.`);
    } else {
      throw e;
    }
  }

  return cached;
}
