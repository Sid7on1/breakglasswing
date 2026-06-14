import { Command, globalCommandRegistry } from './registry';
import { setBlastGateEnabled, isBlastGateEnabled } from '../blastGate';
import { setVerifyEnabled, isVerifyEnabled } from '../../sandbox/verify.loop';
import { setSandboxEnabled, isSandboxEnabled, sandboxAvailable } from '../../sandbox/exec.sandbox';

globalCommandRegistry.register({
  name: '/governor',
  description: 'Toggle Governor Mode',
  category: 'Configuration',
  execute: async (args, context) => {
    // /governor sandbox [on|off] — run BashTool under macOS sandbox-exec (writes restricted to workspace).
    if ((args[0] || '').toLowerCase() === 'sandbox') {
      const sub = (args[1] || '').toLowerCase();
      if (sub === 'on' || sub === 'off') {
        const on = sub === 'on';
        setSandboxEnabled(on);
        await context.saveConfig({ sandboxBash: on });
        const note = on && !sandboxAvailable() ? ' (note: sandbox-exec unavailable here — commands run unsandboxed)' : '';
        return { type: 'message', level: 'success', content: `Bash sandbox is ${on ? 'ON — shell writes restricted to the workspace + temp' : 'OFF'}.${note}` };
      }
      return {
        type: 'menu',
        title: `Bash sandbox (currently ${isSandboxEnabled() ? 'ON' : 'OFF'}${sandboxAvailable() ? '' : ', unavailable on this OS'})`,
        options: [
          { label: '[ ON ]', value: '/governor sandbox on', desc: 'Restrict shell file-writes to the workspace + temp' },
          { label: '[ OFF ]', value: '/governor sandbox off', desc: 'Run shell commands without isolation' },
        ],
        onSelect: (opt: any) => context.executeCommand(opt.value),
      };
    }

    // /governor verify [on|off] — typecheck after edits and feed errors back for self-repair.
    if ((args[0] || '').toLowerCase() === 'verify') {
      const sub = (args[1] || '').toLowerCase();
      if (sub === 'on' || sub === 'off') {
        const on = sub === 'on';
        setVerifyEnabled(on);
        await context.saveConfig({ autoVerify: on });
        return { type: 'message', level: 'success', content: `Auto-verify is ${on ? 'ON — edits are typechecked and failures fed back for one repair pass' : 'OFF'}.` };
      }
      return {
        type: 'menu',
        title: `Auto-verify after edits (currently ${isVerifyEnabled() ? 'ON' : 'OFF'})`,
        options: [
          { label: '[ ON ]', value: '/governor verify on', desc: 'Typecheck edited files; feed errors back to the agent' },
          { label: '[ OFF ]', value: '/governor verify off', desc: 'No automatic typecheck after edits' },
        ],
        onSelect: (opt: any) => context.executeCommand(opt.value),
      };
    }

    // /governor blast-gate [on|off] — confirm edits that touch HIGH/CRITICAL graph symbols.
    if ((args[0] || '').toLowerCase() === 'blast-gate') {
      const sub = (args[1] || '').toLowerCase();
      if (sub === 'on' || sub === 'off') {
        const on = sub === 'on';
        setBlastGateEnabled(on);
        await context.saveConfig({ blastGate: on });
        return { type: 'message', level: 'success', content: `Blast-radius edit gate is ${on ? 'ON — edits touching HIGH/CRITICAL symbols will ask for confirmation' : 'OFF'}.` };
      }
      return {
        type: 'menu',
        title: `Blast-radius edit gate (currently ${isBlastGateEnabled() ? 'ON' : 'OFF'})`,
        options: [
          { label: '[ ON ]', value: '/governor blast-gate on', desc: 'Confirm edits to HIGH/CRITICAL symbols, showing downstream impact' },
          { label: '[ OFF ]', value: '/governor blast-gate off', desc: 'Apply edits without the blast-radius check' },
        ],
        onSelect: (opt: any) => context.executeCommand(opt.value),
      };
    }
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
        title: 'Settings — pick one to configure',
        options: [
          { label: 'Model', value: '/model', desc: 'Choose the LLM model (applies live)' },
          { label: 'Theme', value: '/config theme', desc: 'Color theme' },
          { label: 'Provider', value: '/provider', desc: 'Switch AI provider' },
          { label: 'API Keys', value: '/keys', desc: 'Add / replace API keys' },
          { label: 'Governor (permissions)', value: '/governor', desc: 'Approve actions vs. auto-allow' },
          { label: 'Blast-radius gate', value: '/governor blast-gate', desc: 'Confirm edits to critical symbols (off)' },
          { label: 'Auto-verify edits', value: '/governor verify', desc: 'Typecheck + self-repair after edits (off)' },
          { label: 'Bash sandbox', value: '/governor sandbox', desc: 'Restrict shell writes to workspace (off)' },
          { label: 'Auto-commit', value: '/autocommit', desc: 'Commit after each agent edit (off)' },
          { label: 'Diff approval', value: '/diff-approval', desc: 'Review edits before they apply (off)' },
          { label: 'Self-critic', value: '/self-critic', desc: 'Agent reviews its own work (off)' },
        ],
        onSelect: (opt: any) => context.executeCommand(opt.value),
      };
    }

    if (args[0] === 'theme' && args.length === 1) {
      return {
        type: 'menu',
        title: 'Select theme',
        options: [
          { label: 'Auto (match terminal)', value: '/config set theme auto' },
          { label: 'Dark', value: '/config set theme dark' },
          { label: 'Light', value: '/config set theme light' },
          { label: 'Dark ANSI', value: '/config set theme dark-ansi' },
          { label: 'Light ANSI', value: '/config set theme light-ansi' },
        ],
        onSelect: (opt: any) => context.executeCommand(opt.value),
      };
    }

    if (args[0] === 'set' && args.length >= 3) {
      const key = args[1];
      const val = args.slice(2).join(' ');
      const updates: any = {};
      
      if (key === 'theme' && ['dark', 'light', 'auto', 'dark-ansi', 'light-ansi', 'dark-daltonized', 'light-daltonized', 'ansi', 'daltonized'].includes(val)) {
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
