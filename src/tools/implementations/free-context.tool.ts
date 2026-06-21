import * as path from 'path';
import { resolvePath } from '../path.util';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { fileStateCache } from '../../memory/file-state-cache';

interface FreeContextArgs {
  reason: string;
  items: string[];
}

/**
 * FreeContextTool — model-driven explicit context release (Bimax-unique).
 *
 * When the model is done working with a set of files or tool results and
 * wants to free context window space, it calls this tool instead of waiting
 * for the ContextManager to evict them automatically. Released files are
 * marked in FileStateCache so they are excluded from post-compact restoration
 * (they won't be re-injected after the next compaction).
 *
 * The model should call this when:
 *   - A file review is complete and the file won't be needed again this session
 *   - A long tool result has been processed and can be dropped
 *   - Context pressure is high and some working set is no longer relevant
 */
export const createFreeContextTool = (governor: IGovernor) => buildTool({
  name: 'FreeContextTool',
  description: `Explicitly releases context items you no longer need, freeing space in the context window.

Call this when you are done with specific files or have processed a tool result and won't need it again. Released files are excluded from automatic post-compaction restoration.

# When to use
- After reviewing a file to understand something (and you won't edit it)
- After processing a large tool result you've already extracted the key info from
- When the context window is getting full and some of your working set is no longer relevant

# Instructions
- Pass file paths as items (relative or absolute)
- Pass "tool_results" to release old tool result history
- Always provide a reason so the session log is interpretable`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why you are releasing this context (e.g. "review complete", "no longer relevant").',
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths to release from context tracking. Use relative paths (e.g. "src/auth.ts") or absolute paths.',
      },
    },
    required: ['reason', 'items'],
  },
  execute: async (args: FreeContextArgs, context?: any) => {
    const cwd = context?.cwd || process.cwd();
    const released: string[] = [];

    for (const item of args.items) {
      if (!item || item === 'tool_results') {
        // Requesting tool_result eviction — handled by ContextManager automatically,
        // but ack it so the model knows it was understood
        released.push('(tool results — eviction delegated to ContextManager)');
        continue;
      }

      const absPath = resolvePath(item, cwd);
      fileStateCache.markEvicted(absPath);
      released.push(path.relative(cwd, absPath) || item);
    }

    if (released.length === 0) {
      return 'No items released — nothing matched. Paths must be existing files in the project.';
    }

    const lines = [
      `Released ${released.length} context item(s). Reason: ${args.reason}.`,
      `These files will not be restored after the next compaction:`,
      ...released.map(r => `  • ${r}`),
      '',
      'Context window has been updated. Proceed with the current task.',
    ];

    return lines.join('\n');
  },
}, governor);
