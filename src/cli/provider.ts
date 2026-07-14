import { KeyConfig } from '../credits/api.key.manager';

export interface LlmProvider {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel: string;
}

const PROVIDERS: LlmProvider[] = [
  { name: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1', apiKeyEnv: 'NVIDIA_API_KEY', defaultModel: 'meta/llama-3.1-70b-instruct' },
  { name: 'openai', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o' },
  { name: 'anthropic', baseURL: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-3-opus-20240229' },
  { name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', defaultModel: 'openai/gpt-4o' },
  { name: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat' },
  { name: 'google', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'GOOGLE_API_KEY', defaultModel: 'gemini-2.0-flash' },
];

// Runtime override set by the /provider command; null means "follow BGW_PROVIDER". Resolved lazily
// (not captured at module load) so the env var is read AFTER env files are loaded — otherwise import
// hoisting could snapshot it before loadGlobalEnv() runs and silently fall back to 'nvidia'.
let providerOverride: string | null = null;
function activeProviderName(): string {
  return providerOverride || process.env.BGW_PROVIDER || 'nvidia';
}

export function getProviders(): LlmProvider[] {
  return [...PROVIDERS];
}

export function getProvider(name: string): LlmProvider | undefined {
  return PROVIDERS.find(p => p.name === name);
}

export function getCurrentProvider(): LlmProvider {
  return getProvider(activeProviderName()) || PROVIDERS[0];
}

export function setProvider(name: string): LlmProvider | undefined {
  const found = getProvider(name);
  if (found) providerOverride = found.name;
  return found;
}

function keysForProvider(provider: LlmProvider): KeyConfig[] {
  const envVal = process.env[provider.apiKeyEnv];
  if (!envVal) return [];
  return envVal.split(',').map(k => k.trim()).filter(Boolean).map((keyStr, i) => ({
    keyStr,
    model: process.env[`${provider.apiKeyEnv}_MODEL_${i + 1}`] || process.env[`${provider.apiKeyEnv}_MODEL`] || provider.defaultModel,
    // Escape hatch for local models, proxies, and test harnesses: point the ACTIVE provider's
    // OpenAI-compatible endpoint elsewhere without editing the provider table.
    baseURL: process.env.BGW_BASE_URL || provider.baseURL,
    provider: provider.name,
    label: `${provider.name} #${i + 1}`,
  }));
}

/**
 * Build the key rotation for the ACTIVE provider only (BGW_PROVIDER / the /provider command).
 *
 * Previously this pooled every provider that had a key into one rotation. That is broken with model
 * selection: a single chosen model id lives in one provider's namespace, so when a turn rotated to a
 * different provider's key it 400'd ("model not found") — the intermittent-400 bug. Keys stay
 * single-provider so the model namespace is consistent; switch providers with /provider. Falls back
 * to the first provider that has a key, so a misconfigured active provider never empties the pool.
 */
export function buildKeyPool(): KeyConfig[] {
  const active = keysForProvider(getCurrentProvider());
  if (active.length > 0) return active;
  for (const provider of PROVIDERS) {
    const keys = keysForProvider(provider);
    if (keys.length > 0) return keys;
  }
  return [];
}
