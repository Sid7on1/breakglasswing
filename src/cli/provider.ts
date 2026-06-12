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

let currentProviderName: string = process.env.BGW_PROVIDER || 'nvidia';

export function getProviders(): LlmProvider[] {
  return [...PROVIDERS];
}

export function getProvider(name: string): LlmProvider | undefined {
  return PROVIDERS.find(p => p.name === name);
}

export function getCurrentProvider(): LlmProvider {
  return getProvider(currentProviderName) || PROVIDERS[0];
}

export function setProvider(name: string): LlmProvider | undefined {
  const found = getProvider(name);
  if (found) currentProviderName = found.name;
  return found;
}

export function buildKeyPool(): KeyConfig[] {
  const pool: KeyConfig[] = [];

  for (const provider of PROVIDERS) {
    const envVal = process.env[provider.apiKeyEnv];
    if (!envVal) continue;

    const keys = envVal.split(',').map(k => k.trim()).filter(Boolean);
    const labelPrefix = provider.name;

    keys.forEach((keyStr, i) => {
      const modelEnv = process.env[`${provider.apiKeyEnv}_MODEL_${i + 1}`]
                    || process.env[`${provider.apiKeyEnv}_MODEL`]
                    || provider.defaultModel;

      pool.push({
        keyStr,
        model: modelEnv,
        baseURL: provider.baseURL,
        provider: provider.name,
        label: `${labelPrefix} #${i + 1}`,
      });
    });
  }

  return pool;
}
