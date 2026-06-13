import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { backupFile, unifiedDiff } from '../../cli/fileEditor';
import { requestDiffApproval } from '../../cli/diffApproval';
import { checkBlastRadius } from '../../cli/blastGate';

function resolvePath(p: string, cwd: string): string {
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(p[1] === '/' ? 2 : 1));
  return path.resolve(cwd, p);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/** Render a compact unified-style preview of the change for the transcript. */
function diffPreview(oldStr: string, newStr: string): string {
  const removed = oldStr.split('\n').map(l => `- ${l}`);
  const added = newStr.split('\n').map(l => `+ ${l}`);
  const MAX = 20;
  const lines = [...removed, ...added];
  const shown = lines.slice(0, MAX);
  const suffix = lines.length > MAX ? `\n  ...(${lines.length - MAX} more lines)` : '';
  return shown.join('\n') + suffix;
}

interface EditArgs {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export const createEditFileTool = (governor: IGovernor) => buildTool({
  name: 'EditFileTool',
  description: `Performs an exact string replacement inside an existing file. This is the correct tool for modifying code: it is surgical, reviewable, and never rewrites the rest of the file. Prefer it over WriteFileTool (full overwrite) and over \`sed\` via BashTool.

# Instructions
- **oldString** must match the file content EXACTLY, including indentation and line breaks.
- **oldString must be unique** in the file, or the edit fails — include more surrounding lines to disambiguate. Alternatively pass \`replaceAll: true\` to replace every occurrence.
- **newString** must differ from oldString.
- The file must already exist; use WriteFileTool to create new files.`,
  isDestructive: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit (supports ~/ for home dir).' },
      oldString: { type: 'string', description: 'The exact text to replace (must match the file verbatim).' },
      newString: { type: 'string', description: 'The replacement text.' },
      replaceAll: { type: 'boolean', description: 'Replace every occurrence instead of requiring uniqueness (default false).' },
    },
    required: ['path', 'oldString', 'newString'],
  },
  execute: async (args: EditArgs, context?: any) => {
    const cwd = context?.cwd || process.cwd();
    const fullPath = resolvePath(args.path, cwd);

    if (args.oldString === args.newString) {
      return 'Error: newString must be different from oldString.';
    }
    if (!args.oldString) {
      return 'Error: oldString cannot be empty. To create a file, use WriteFileTool.';
    }

    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf8');
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return `Error: File not found: ${args.path}. Use WriteFileTool to create new files.`;
      }
      throw e;
    }

    const occurrences = countOccurrences(content, args.oldString);
    if (occurrences === 0) {
      return `Error: oldString not found in ${args.path}. Make sure it matches the file content exactly (including whitespace and indentation).`;
    }
    if (occurrences > 1 && !args.replaceAll) {
      return `Error: oldString appears ${occurrences} times in ${args.path}. Add more surrounding context to make it unique, or pass replaceAll: true.`;
    }

    const updated = args.replaceAll
      ? content.split(args.oldString).join(args.newString)
      : content.replace(args.oldString, args.newString);

    // Blast-radius gate (no-op unless enabled + interactive + the file owns a HIGH/CRITICAL symbol).
    if (!(await checkBlastRadius(fullPath))) {
      return `Edit to ${args.path} cancelled — declined at the blast-radius gate. No changes were made.`;
    }

    // Inline diff approval (no-op unless enabled and an interactive approver is registered).
    const approved = await requestDiffApproval(`Edit ${args.path}`, unifiedDiff(content, updated, args.path));
    if (!approved) return `Edit to ${args.path} rejected by user. No changes were made.`;

    // Snapshot first so /undo and /diff-file work on every agent edit.
    await backupFile(fullPath);
    await fs.writeFile(fullPath, updated, 'utf8');

    const n = args.replaceAll ? occurrences : 1;
    return `Edited ${args.path} (${n} replacement${n === 1 ? '' : 's'}):\n${diffPreview(args.oldString, args.newString)}`;
  },
}, governor);
