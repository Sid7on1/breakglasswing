import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_DIR = path.join(process.cwd(), '.breakglass');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  defaultAgent: string;
  model: string;
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
  selfCritic: boolean;
  allowSelfEvolution: boolean;
  reasoningEffort?: string; // off by default; 'low'|'medium'|'high' to speed up thinking models
}

const DEFAULTS: CliConfig = {
  defaultAgent: 'bimax',
  model: 'meta/llama-3.1-70b-instruct',
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
  selfCritic: false,
  allowSelfEvolution: false,
};

let cached: CliConfig | null = null;

export async function loadConfig(): Promise<CliConfig> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    cached = { ...DEFAULTS, ...parsed };
    cached!.workspaceRoot = path.resolve(parsed.workspaceRoot || DEFAULTS.workspaceRoot);
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached!;
}

export function getConfig(): CliConfig {
  if (!cached) throw new Error('Config not loaded. Call loadConfig() first.');
  return cached;
}

export async function saveConfig(updates: Partial<CliConfig>): Promise<CliConfig> {
  const current = await loadConfig();
  cached = { ...current, ...updates };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cached, null, 2), 'utf-8');
  return cached;
}
