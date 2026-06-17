import { globalCommandRegistry } from './registry';
import { getProviders, setProvider, getCurrentProvider } from '../provider';
import { saveApiKeyToEnv } from '../env.loader';
import { SessionStore } from '../session';

/** "2026-06-17_02-30-15.jsonl" → "2026-06-17 02:30:15" for display. */
function prettySessionName(file: string): string {
  const m = file.replace(/\.jsonl$/, '').match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : file.replace(/\.jsonl$/, '');
}

/** Print a read-only preview of a saved session into the transcript. */
async function previewSession(file: string, context: any): Promise<void> {
  const msgs = await new SessionStore().loadSession(file);
  if (msgs.length === 0) { context.addSystemMessage('info', `Session ${prettySessionName(file)} is empty or unreadable.`); return; }
  context.addSystemMessage('info', `--- Session ${prettySessionName(file)} · ${msgs.length} message(s) (preview) ---`);
  for (const m of msgs.slice(-30)) {
    const who = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'BiMax' : 'System';
    const text = typeof m.content === 'string' ? m.content : '';
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (snippet) context.addSystemMessage('info', `${who}: ${snippet}`);
  }
}

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
  description: 'Browse saved sessions (pick one to preview)',
  category: 'Session & Context',
  execute: async (_args, context) => {
    const files = await new SessionStore().listSessions();
    if (files.length === 0) {
      return { type: 'message', level: 'info', content: 'No saved sessions yet (.breakglass/sessions). They accrue as you chat.' };
    }
    return {
      type: 'menu',
      title: 'Saved sessions — pick one to preview (newest first)',
      options: files.slice(0, 40).map(f => ({ label: prettySessionName(f), value: f, desc: f, category: 'Sessions' })),
      onSelect: (opt: any) => { void previewSession(opt.value, context); },
    };
  }
});

globalCommandRegistry.register({
  name: '/resume',
  aliases: ['/session'],
  description: 'Preview a saved session (by id, or pick from the list)',
  category: 'Session & Context',
  execute: async (args, context) => {
    if (args[0]) {
      const files = await new SessionStore().listSessions();
      const match = files.find(f => f === args[0] || f === `${args[0]}.jsonl` || f.startsWith(args[0]));
      if (!match) return { type: 'message', level: 'error', content: `No session matching "${args[0]}". Open /sessions to browse.` };
      await previewSession(match, context);
      return { type: 'none' };
    }
    return { type: 'redirect', command: '/sessions' };
  }
});
