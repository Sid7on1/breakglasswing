import { globalCommandRegistry } from './registry';
import { getGitStatus, gitDiff, gitLog } from '../git';

globalCommandRegistry.register({
  name: '/git',
  description: 'Git status',
  category: 'Source Control',
  execute: async (args, context) => {
    const status = getGitStatus(context.cwd);
    if (!status) return { type: 'message', level: 'info', content: 'Not a git repository' };
    
    return {
      type: 'message',
      level: 'info',
      content: ` ${status.branch} · +${status.added.length} ~${status.modified.length} -${status.deleted.length} ?${status.unstaged.length} ${status.ahead > 0 ? `↑${status.ahead}` : ''}${status.behind > 0 ? `↓${status.behind}` : ''}`
    };
  }
});

globalCommandRegistry.register({
  name: '/diff',
  description: 'Git diff',
  category: 'Source Control',
  execute: async (args, context) => {
    const file = args[0];
    if (!file) {
      return {
        type: 'prompt',
        title: 'Diff - Enter File Path (or leave empty for all)',
        onResolve: (fileStr: string) => {
          context.addSystemMessage('info', 'Running /diff...');
          // Using redirect to re-trigger the command once resolved
          return `/diff ${fileStr.trim() || '.'}`;
        }
      };
    }
    
    const diff = gitDiff(context.cwd, file === '.' ? undefined : file);
    return {
      type: 'message',
      level: 'info',
      content: diff ? `Diff${file ? ` (${file})` : ''}:\n${diff.slice(0, 1000)}` : 'No changes'
    };
  }
});

globalCommandRegistry.register({
  name: '/log',
  description: 'Git log',
  category: 'Source Control',
  execute: async (args, context) => {
    const log = gitLog(context.cwd, 10);
    return { type: 'message', level: 'info', content: log };
  }
});
