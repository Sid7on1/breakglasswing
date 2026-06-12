import { globalCommandRegistry } from './registry';
import { runTypeCheck, runLint, formatErrors } from '../lintFixLoop';

globalCommandRegistry.register({
  name: '/index',
  description: 'Build AST codebase index',
  category: 'Code & Intelligence',
  execute: async (args, context) => {
    if (args[0] !== 'force') {
      return {
        type: 'menu',
        title: 'Build AST Codebase Index?',
        options: [
          { label: '[ Start Indexing ]', value: '/index force', desc: 'Parse all workspace files' },
          { label: '[ Cancel ]', value: 'cancel', desc: 'Do nothing' }
        ]
      };
    }
    
    if (!context.codebaseIndexer) {
      return { type: 'message', level: 'error', content: 'Codebase indexer not available' };
    }

    context.addSystemMessage('info', 'Building AST codebase index...');
    try {
      const count = await context.codebaseIndexer.buildAstIndex();
      return { type: 'message', level: 'success', content: `AST Indexing complete! Extracted ${count} nodes.` };
    } catch (err: any) {
      return { type: 'message', level: 'error', content: `Indexing failed: ${err.message}` };
    }
  }
});

globalCommandRegistry.register({
  name: '/index-ai',
  description: 'Run Semantic AI index',
  category: 'Code & Intelligence',
  execute: async (args, context) => {
    if (args[0] !== 'force') {
      return {
        type: 'menu',
        title: 'Run Semantic AI Index?',
        options: [
          { label: '[ Start AI Indexing ]', value: '/index-ai force', desc: 'Uses tokens to semantically process AST nodes' },
          { label: '[ Cancel ]', value: 'cancel', desc: 'Do nothing' }
        ]
      };
    }

    if (!context.codebaseIndexer) {
      return { type: 'message', level: 'error', content: 'Codebase indexer not available' };
    }

    context.addSystemMessage('info', 'Running Semantic AI index...');
    try {
      await context.codebaseIndexer.buildSemanticIndex();
      return { type: 'message', level: 'success', content: 'Semantic AI Indexing complete! The graph now has full semantic intelligence.' };
    } catch (err: any) {
      return { type: 'message', level: 'error', content: `Semantic indexing failed: ${err.message}` };
    }
  }
});

globalCommandRegistry.register({
  name: '/check',
  description: 'Type check (tsc)',
  category: 'Code & Intelligence',
  execute: async (args, context) => {
    if (args[0] !== 'force') {
      return {
        type: 'menu',
        title: 'Run TypeScript Type Check?',
        options: [
          { label: '[ Run Type Check ]', value: '/check force', desc: 'Runs tsc in the current workspace' },
          { label: '[ Cancel ]', value: 'cancel', desc: 'Do nothing' }
        ]
      };
    }

    context.addSystemMessage('info', 'Running type check...');
    try {
      const tc = await runTypeCheck(context.cwd);
      return { type: 'message', level: tc.success ? 'success' : 'error', content: formatErrors(tc) };
    } catch (err: any) {
      return { type: 'message', level: 'error', content: `Type check failed: ${err.message}` };
    }
  }
});

globalCommandRegistry.register({
  name: '/lint',
  description: 'Run ESLint',
  category: 'Code & Intelligence',
  execute: async (args, context) => {
    if (args[0] !== 'force') {
      return {
        type: 'menu',
        title: 'Run ESLint?',
        options: [
          { label: '[ Run Linter ]', value: '/lint force', desc: 'Runs eslint in the current workspace' },
          { label: '[ Cancel ]', value: 'cancel', desc: 'Do nothing' }
        ]
      };
    }

    context.addSystemMessage('info', 'Running linter...');
    try {
      const lint = await runLint(context.cwd);
      return { type: 'message', level: lint.success ? 'success' : 'error', content: formatErrors(lint) };
    } catch (err: any) {
      return { type: 'message', level: 'error', content: `Lint failed: ${err.message}` };
    }
  }
});
