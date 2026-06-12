import { Command, globalCommandRegistry } from './registry';

globalCommandRegistry.register({
  name: '/governor',
  description: 'Toggle Governor Mode',
  category: 'Configuration',
  execute: async (args, context) => {
    if (args.length === 0) {
      return {
        type: 'menu',
        title: `Governor is currently ${context.options.governor.mode === 'bypass' ? 'OFF' : 'ON'}`,
        options: [
          { label: 'Turn ON (Active)', value: 'on', desc: 'Constraints and vetoes will apply' },
          { label: 'Turn OFF (Bypass)', value: 'off', desc: 'All actions will be auto-approved' }
        ]
      };
    } else if (args[0] === 'off') {
      context.options.governor.mode = 'bypass';
      return { type: 'message', level: 'success', content: 'Governor bypassed. All actions will be auto-approved.' };
    } else if (args[0] === 'on') {
      context.options.governor.mode = 'interactive';
      return { type: 'message', level: 'success', content: 'Governor is active. Constraints and vetoes will apply.' };
    } else {
      return { type: 'message', level: 'error', content: 'Usage: /governor on | /governor off' };
    }
  }
});

globalCommandRegistry.register({
  name: '/config',
  description: 'Show/set config',
  category: 'Configuration',
  execute: async (args, context) => {
    if (args.length === 0) {
      return {
        type: 'menu',
        title: 'Select config to change',
        options: [
          { label: 'Theme', value: 'theme', desc: 'dark, light, ansi, auto' },
          { label: 'Model', value: 'model', desc: 'Default LLM model' },
          { label: 'Skip Permissions', value: 'skipPerms', desc: 'true / false' },
          { label: 'Notification Bell', value: 'notificationBell', desc: 'true / false' },
          { label: 'Verbose Logging', value: 'verbose', desc: 'true / false' },
        ]
      };
    }
    
    if (args[0] === 'set' && args.length >= 3) {
      const key = args[1];
      const val = args.slice(2).join(' ');
      const updates: any = {};
      
      if (key === 'theme' && ['dark', 'light', 'ansi', 'daltonized', 'auto'].includes(val)) {
        updates.theme = val;
      } else if (key === 'verbose') {
        updates.verbose = val === 'true';
      } else if (key === 'skipPerms') {
        context.options.governor.mode = val === 'true' ? 'bypass' : 'interactive';
      } else if (key === 'model') {
        updates.model = val;
      } else if (key === 'notificationBell') {
        updates.notificationBell = val === 'true' || val === 'on';
      } else if (key === 'maxToolIterations') {
        updates.maxToolIterations = parseInt(val) || 15;
      } else {
        return { type: 'message', level: 'error', content: `Unknown key: ${key}. Keys: theme, verbose, skipPerms, model, notificationBell, maxToolIterations` };
      }
      
      await context.saveConfig(updates);
      return { type: 'message', level: 'success', content: `Config saved: ${key}=${val}` };
    }
    
    return { 
      type: 'message', 
      level: 'info', 
      content: `Config: agent=${context.options.agent} model=${context.options.model || 'default'} theme=${context.options.theme} verbose=${context.options.verbose} skipPerms=${context.options.governor.mode === 'bypass'}` 
    };
  }
});

globalCommandRegistry.register({
  name: '/agent-decisions',
  description: 'Toggle Auto Agent Decisions',
  category: 'Configuration',
  execute: async (args, context) => {
    const stateArg = args[0]?.toLowerCase();
    if (stateArg === 'on') {
      context.options.autoAgentDecisions = true;
      await context.saveConfig({ autoAgentDecisions: true });
      return { type: 'message', level: 'success', content: 'Auto Agent Decisions ENABLED.' };
    } else if (stateArg === 'off') {
      context.options.autoAgentDecisions = false;
      await context.saveConfig({ autoAgentDecisions: false });
      return { type: 'message', level: 'success', content: 'Auto Agent Decisions DISABLED.' };
    } else {
      return {
        type: 'menu',
        title: `Auto Agent Decisions (Currently: ${context.options.autoAgentDecisions ? 'ON' : 'OFF'})`,
        options: [
          { label: '[ ON ]', value: 'on', desc: 'Let the LLM auto-resolve ambiguities' },
          { label: '[ OFF ]', value: 'off', desc: 'Require human input' }
        ]
      };
    }
  }
});
