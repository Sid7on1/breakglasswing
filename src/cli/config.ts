import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Settings live in two places so that preferences persist no matter where you launch bimax:
//   • GLOBAL  (~/.breakglass/config.json)        — model, provider, theme, toggles, …
//   • PROJECT (<cwd>/.breakglass/config.json)     — only the fields that are inherently
//                                                   per-codebase (onboarding state, workspace root)
// On load we merge global ← project (project wins for its own keys). On save we route each
// changed field to the right file. API keys are stored separately in ~/.breakglass/.env.

const GLOBAL_DIR = path.join(os.homedir(), '.breakglass');
const GLOBAL_PATH = path.join(GLOBAL_DIR, 'config.json');
const projectDir = () => path.join(process.cwd(), '.breakglass');
const projectPath = () => path.join(projectDir(), 'config.json');

// Fields that belong to the project, not to the user's global preferences.
const PROJECT_KEYS: (keyof CliConfig)[] = ['onboardingComplete', 'workspaceRoot'];

export interface CliConfig {
  defaultAgent: string;
  model: string;       // the CODING model — drives the main agent loop
  liteModel: string;   // the LITE model — used for cheap aux calls (summaries, self-critic, ask-user)
  timeout: number;
  temperature: number;
  maxTokens: number;
  theme: string;
  verbose: boolean;
  dangerouslySkipPermissions: boolean;
  skipSemanticMetadata: boolean;
  autoIndex: boolean;
  excludeFromIndex: string[];
  maxToolIterations: number;
  maxSubAgents: number;
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
}

const DEFAULTS: CliConfig = {
  defaultAgent: 'bimax',
  model: 'minimaxai/minimax-m3',
  liteModel: 'meta/llama-3.1-70b-instruct',
  timeout: 120000,
  temperature: 0.7,
  maxTokens: 4096,
  theme: 'auto',
  verbose: false,
  dangerouslySkipPermissions: false,
  skipSemanticMetadata: false,
  autoIndex: true,
  excludeFromIndex: [],
  maxToolIterations: 15,
  maxSubAgents: 5,
  notificationBell: true,
  customRoutingRules: [],
  workspaceRoot: process.cwd(),
  autoAgentDecisions: false,
  diffApproval: false,
  blastGate: false,
  gitAutoCommit: false,
  autoVerify: false,
  sandboxBash: false,
  selfCritic: false,
  allowSelfEvolution: false,
  onboardingComplete: false,
  showMapPanel: true,
  showTokenMeter: true,
  contextMode: 'smart',
  contextWindowTokens: 0,
  parallelToolCalls: true,
};

let cached: CliConfig | null = null;

async function readJson(file: string): Promise<Partial<CliConfig>> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch {
    return {};
  }
}

export async function loadConfig(): Promise<CliConfig> {
  if (cached) return cached;
  const globalCfg = await readJson(GLOBAL_PATH);
  const projectCfg = await readJson(projectPath());
  // Project file may be a legacy combined config; merging it last preserves existing setups,
  // and the next saveConfig migrates global keys out to the global file.
  cached = { ...DEFAULTS, ...globalCfg, ...projectCfg };
  cached!.workspaceRoot = path.resolve(projectCfg.workspaceRoot || globalCfg.workspaceRoot || DEFAULTS.workspaceRoot);
  return cached!;
}

export function getConfig(): CliConfig {
  if (!cached) throw new Error('Config not loaded. Call loadConfig() first.');
  return cached;
}

export async function saveConfig(updates: Partial<CliConfig>): Promise<CliConfig> {
  const current = await loadConfig();
  cached = { ...current, ...updates };

  // Route each updated key to the file it belongs in.
  const globalUpdates: Record<string, any> = {};
  const projectUpdates: Record<string, any> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (PROJECT_KEYS.includes(key as keyof CliConfig)) projectUpdates[key] = value;
    else globalUpdates[key] = value;
  }

  if (Object.keys(globalUpdates).length) {
    const existing = await readJson(GLOBAL_PATH);
    await fs.mkdir(GLOBAL_DIR, { recursive: true });
    await fs.writeFile(GLOBAL_PATH, JSON.stringify({ ...existing, ...globalUpdates }, null, 2), 'utf-8');
  }
  if (Object.keys(projectUpdates).length) {
    const existing = await readJson(projectPath());
    await fs.mkdir(projectDir(), { recursive: true });
    await fs.writeFile(projectPath(), JSON.stringify({ ...existing, ...projectUpdates }, null, 2), 'utf-8');
  }

  return cached;
}
