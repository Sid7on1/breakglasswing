import { globalCommandRegistry } from './registry';
import { getCustomRules, addCustomRule, removeCustomRule, getKnownAgents } from '../agentRouter';
import { getCurrentProvider } from '../provider';

globalCommandRegistry.register({
  name: '/routes',
  description: 'List/add/remove routes',
  category: 'Configuration',
  execute: async (args, context) => {
    if (args[0] === 'add' && args.length >= 3) {
      const re = args[1];
      const agent = args.slice(2).join(' ');
      addCustomRule(re, agent);
      await context.saveConfig({ customRoutingRules: getCustomRules() });
      return { type: 'message', level: 'success', content: `Rule added: /${re}/ → ${agent}` };
    } else if (args[0] === 'remove' && args[1]) {
      const idx = parseInt(args[1]);
      const rules = getCustomRules();
      if (idx >= 0 && idx < rules.length) {
        removeCustomRule(idx);
        await context.saveConfig({ customRoutingRules: getCustomRules() });
        return { type: 'message', level: 'success', content: `Rule ${idx} removed` };
      } else {
        return { type: 'message', level: 'error', content: `Index ${idx} out of range. Use /routes to list rules.` };
      }
    } else {
      const rules = getCustomRules();
      return {
        type: 'menu',
        title: 'Routing Rules',
        options: [
          { label: '[+] Add New Rule', value: 'add_rule', desc: 'Create a new regex to agent mapping' },
          ...rules.map((r, i) => ({
            label: `/${r[0]}/`,
            value: i.toString(),
            desc: `→ ${r[1]} (Select to delete)`
          }))
        ]
      };
    }
  }
});

globalCommandRegistry.register({
  name: '/agents',
  description: 'List agent personas',
  category: 'Configuration',
  execute: async (args, context) => {
    return {
      type: 'menu',
      title: 'Select an Agent Persona',
      options: getKnownAgents().map(a => ({
        label: a,
        value: a,
        description: 'Specialized model preset'
      }))
    };
  }
});

globalCommandRegistry.register({
  name: '/model',
  description: 'Show current model',
  category: 'Configuration',
  execute: async (args, context) => {
    if (args.length === 0) {
      return {
        type: 'menu',
        title: 'Select Model',
        options: [
          { label: 'Llama 3.1 70B (Nvidia)', value: 'meta/llama-3.1-70b-instruct' },
          { label: 'Llama 3.3 70B (Nvidia)', value: 'meta/llama-3.3-70b-instruct' },
          { label: 'GPT-4o (OpenAI)', value: 'gpt-4o' },
          { label: 'Claude 3.5 Sonnet (Anthropic)', value: 'claude-3-5-sonnet-20241022' },
          { label: 'Gemini 2.0 Flash (Google)', value: 'gemini-2.0-flash' },
          { label: 'DeepSeek Chat', value: 'deepseek-chat' },
          { label: 'MiniMax 2.7', value: 'minimax/minimax-m2.7' }
        ]
      };
    }
    return { type: 'message', level: 'info', content: `Current model: ${context.options.model || 'meta/llama-3.1-70b-instruct'}` };
  }
});

globalCommandRegistry.register({
  name: '/context',
  description: 'Show current context',
  category: 'Session & Context',
  execute: async (args, context) => {
    return {
      type: 'menu',
      title: 'Current Context',
      options: [
        { label: 'Workspace', value: 'workspace', desc: context.cwd },
        { label: 'Model', value: '/model', desc: context.options.model || 'default' },
        { label: 'Agent', value: '/agents', desc: context.options.agent },
        { label: 'Provider', value: '/provider', desc: String(getCurrentProvider().name) },
        { label: 'Theme', value: '/config theme', desc: context.options.theme },
        { label: 'Verbose Logging', value: '/config verbose', desc: context.options.verbose ? 'On' : 'Off' },
        { label: 'Permissions', value: '/config skipPerms', desc: context.options.governor?.mode === 'bypass' ? 'Bypassed' : 'Strict' },
      ]
    };
  }
});

globalCommandRegistry.register({
  name: '/cost',
  description: 'Show session cost & usage',
  category: 'Session & Context',
  execute: async (args, context) => {
    return {
      type: 'message',
      level: 'info',
      content: 'Cost tracking is being migrated to StatsDashboard.'
    };
  }
});

globalCommandRegistry.register({
  name: '/clear',
  description: 'Clear screen',
  category: 'Session & Context',
  execute: async (args, context) => {
    // Return a redirect to the legacy clear handler in FullScreen if we need it
    // Or just a message since clear logic (setting history to []) is in FullScreen
    return { type: 'redirect', command: 'clear_screen' }; 
  }
});
