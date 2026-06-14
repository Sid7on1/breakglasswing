import { globalCommandRegistry } from './registry';
import { getProviders, setProvider, getCurrentProvider } from '../provider';
import { saveApiKeyToEnv } from '../env.loader';

// Apply a provider selection live: switch the active provider, persist the choice, and tell
// the user which key env var it needs. Shared by the picker's onSelect and `/provider <name>`.
function applyProvider(name: string, context: any) {
  const found = setProvider(name);
  if (!found) {
    context.addSystemMessage('error', `Unknown provider: ${name}. Open /provider to pick from the list.`);
    return;
  }
  try { saveApiKeyToEnv('BGW_PROVIDER', name); } catch { /* persistence optional */ }
  const hasKey = !!process.env[found.apiKeyEnv];
  context.addSystemMessage('success', `Provider switched to ${found.name} (${found.baseURL})`);
  if (!hasKey) context.addSystemMessage('info', `No ${found.apiKeyEnv} set yet — open /keys to add the API key.`);
}

globalCommandRegistry.register({
  name: '/provider',
  description: 'Switch provider',
  category: 'Configuration',
  execute: async (args, context) => {
    if (args.length >= 1) {
      applyProvider(args[0], context);
      return { type: 'none' };
    }
    const current = getCurrentProvider();
    return {
      type: 'menu',
      title: `Select provider (current: ${current.name})`,
      options: getProviders().map(p => ({
        label: p.name,
        value: p.name,
        desc: `${p.baseURL}${process.env[p.apiKeyEnv] ? ' · key set' : ' · no key'}`,
      })),
      onSelect: (opt: any) => applyProvider(opt.value, context),
    };
  }
});

// Prompt for and store a provider's API key (manual entry, masked). Reused by the picker.
function promptForKey(providerName: string, context: any) {
  const match = getProviders().find(p => p.name === providerName);
  if (!match) return;
  context.setActivePrompt({
    title: `Enter API key for ${match.name} (${match.apiKeyEnv})`,
    isMasked: true,
    onResolve: (keyStr: string) => {
      const key = (keyStr || '').trim();
      if (!key) { context.addSystemMessage('info', 'No key entered — nothing changed.'); return; }
      try {
        saveApiKeyToEnv(match.apiKeyEnv, key);
        process.env[match.apiKeyEnv] = key;
        context.addSystemMessage('success', `${match.apiKeyEnv} saved to ~/.breakglass/.env`);
      } catch (e: any) {
        context.addSystemMessage('error', `Failed to save key: ${e.message}`);
      }
    },
  });
}

globalCommandRegistry.register({
  name: '/keys',
  description: 'Show/add API keys',
  category: 'Configuration',
  execute: async (args, context) => {
    const providers = getProviders();
    return {
      type: 'menu',
      title: 'Select a provider to add / replace its API key',
      options: providers.map(p => ({
        label: p.name,
        value: p.name,
        desc: process.env[p.apiKeyEnv] ? `${p.apiKeyEnv} · configured` : `${p.apiKeyEnv} · missing`,
      })),
      onSelect: (opt: any) => promptForKey(opt.value, context),
    };
  }
});

globalCommandRegistry.register({
  name: '/sessions',
  description: 'List saved sessions',
  category: 'Session & Context',
  execute: async (args, context) => {
    return { type: 'message', level: 'info', content: 'Sessions feature is currently being migrated to the new State Store.' };
  }
});

globalCommandRegistry.register({
  name: '/resume',
  description: 'Resume a session',
  category: 'Session & Context',
  execute: async (args, context) => {
    return { type: 'message', level: 'info', content: 'Resume feature is currently being migrated to the new State Store.' };
  }
});
