import { globalCommandRegistry } from './registry';
import { getProviders, setProvider, getCurrentProvider } from '../provider';

globalCommandRegistry.register({
  name: '/provider',
  description: 'Switch provider',
  category: 'Configuration',
  execute: async (args, context) => {
    if (args.length === 0) {
      const current = getCurrentProvider();
      const all = getProviders();
      return {
        type: 'message',
        level: 'info',
        content: `Current: ${current.name} (${current.baseURL})\nAvailable: ${all.map(p => p.name).join(', ')}\nUsage: /provider <name> — e.g. /provider openai`
      };
    }
    const found = setProvider(args[0]);
    if (found) {
      return {
        type: 'message',
        level: 'success',
        content: `Switched to ${found.name} (${found.baseURL})\nSet ${found.apiKeyEnv} env var for API key`
      };
    } else {
      return { type: 'message', level: 'error', content: `Unknown provider: ${args[0]}. Use /provider to list.` };
    }
  }
});

globalCommandRegistry.register({
  name: '/keys',
  description: 'Show/add API keys',
  category: 'Configuration',
  execute: async (args, context) => {
    if (args.length === 0) {
      const providers = getProviders();
      return {
        type: 'menu',
        title: 'Select Provider to enter API Key',
        options: providers.map(p => ({
          label: p.name,
          value: p.name,
          desc: process.env[p.apiKeyEnv] ? 'Key Configured' : 'Missing Key'
        }))
      };
    }
    return { type: 'message', level: 'error', content: 'Use the menu to enter keys.' };
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
