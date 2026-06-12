import { globalCommandRegistry } from './registry';

globalCommandRegistry.register({
  name: '/help',
  description: 'Show all available commands',
  category: 'General',
  execute: async (args, context) => {
    return {
      type: 'menu',
      title: 'BiMAX Command Palette',
      options: [
        { label: '/sessions', value: '/sessions', desc: 'List saved sessions', category: 'Session & Context' },
        { label: '/resume', value: '/resume', desc: 'Resume a session', category: 'Session & Context' },
        { label: '/clear', value: '/clear', desc: 'Clear screen', category: 'Session & Context' },
        { label: '/cost', value: '/cost', desc: 'Show session cost & usage', category: 'Session & Context' },
        { label: '/context', value: '/context', desc: 'Show current context', category: 'Session & Context' },

        { label: '/config', value: '/config', desc: 'Show/set config', category: 'Configuration' },
        { label: '/keys', value: '/keys', desc: 'Show/add API keys', category: 'Configuration' },
        { label: '/model', value: '/model', desc: 'Show current model', category: 'Configuration' },
        { label: '/provider', value: '/provider', desc: 'Switch provider', category: 'Configuration' },
        { label: '/agents', value: '/agents', desc: 'List agent personas', category: 'Configuration' },
        { label: '/routes', value: '/routes', desc: 'List/add/remove routes', category: 'Configuration' },
        { label: '/governor', value: '/governor', desc: 'Toggle Governor', category: 'Configuration' },
        { label: '/agent-decisions', value: '/agent-decisions', desc: 'Toggle Auto Agent Decisions', category: 'Configuration' },

        { label: '/index', value: '/index', desc: 'Build AST codebase index', category: 'Code & Intelligence' },
        { label: '/index-ai', value: '/index-ai', desc: 'Run Semantic AI index', category: 'Code & Intelligence' },
        { label: '/check', value: '/check', desc: 'Type check (tsc)', category: 'Code & Intelligence' },
        { label: '/lint', value: '/lint', desc: 'Run ESLint', category: 'Code & Intelligence' },
        { label: '/edit', value: '/edit', desc: 'Search & replace', category: 'Code & Intelligence' },
        { label: '/write', value: '/write', desc: 'Write file to disk', category: 'Code & Intelligence' },
        { label: '/undo', value: '/undo', desc: 'Undo last edit', category: 'Code & Intelligence' },
        { label: '/diff-file', value: '/diff-file', desc: 'Show file diff', category: 'Code & Intelligence' },

        { label: '/git', value: '/git', desc: 'Git status', category: 'Source Control' },
        { label: '/diff', value: '/diff', desc: 'Git diff', category: 'Source Control' },
        { label: '/log', value: '/log', desc: 'Git log', category: 'Source Control' },
        { label: '/backups', value: '/backups', desc: 'List backups', category: 'Source Control' },
      ]
    };
  }
});
