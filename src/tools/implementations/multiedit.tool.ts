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
  let count = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}

interface SingleEdit {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

/**
 * MultiEditTool — applies a batch of string replacements across one or more files
 * atomically: every edit is validated first, and nothing is written unless all
 * edits would succeed. Edits to the same file are applied in order. Each touched
 * file is governed (FILE_WRITE) and backed up so /undo and /rewind still work.
 */
export const createMultiEditTool = (governor: IGovernor) => buildTool({
  name: 'MultiEditTool',
  description: `Applies a batch of exact-string replacements across one or more files in a single atomic operation. Either every edit applies or none do — use this for coordinated refactors (e.g. rename a symbol across files, change a signature and its callers) instead of many separate EditFileTool calls.

# Instructions
- Provide an \`edits\` array. Each entry: { path, oldString, newString, replaceAll? }.
- Each \`oldString\` must match its file exactly (whitespace included) and be unique unless \`replaceAll: true\`.
- Multiple edits to the same file are applied in array order; write later edits against the result of earlier ones.
- If ANY edit fails validation, the whole batch is rejected and no file is modified.`,
  // Governance is enforced per-file inside execute, so the factory wrapper stays out of the way.
  isDestructive: false,
  isConcurrencySafe: false,
  schema: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        description: 'The list of edits to apply atomically.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File to edit (supports ~/).' },
            oldString: { type: 'string', description: 'Exact text to replace.' },
            newString: { type: 'string', description: 'Replacement text.' },
            replaceAll: { type: 'boolean', description: 'Replace every occurrence (default false).' },
          },
          required: ['path', 'oldString', 'newString'],
        },
      },
    },
    required: ['edits'],
  },
  execute: async (args: { edits: SingleEdit[] }, context?: any) => {
    const cwd = context?.cwd || process.cwd();
    const edits = args.edits || [];
    if (edits.length === 0) return 'Error: edits array is empty.';

    // Phase 1 — load each distinct file once and validate every edit in order against
    // an in-memory working copy. Nothing touches disk until all edits are proven valid.
    const working = new Map<string, string>(); // fullPath -> current (post-edits) content
    const originals = new Map<string, string>(); // fullPath -> on-disk content (for diff preview)
    const order: string[] = []; // distinct fullPaths in first-seen order

    for (let i = 0; i < edits.length; i++) {
      const e = edits[i];
      if (e.oldString === e.newString) return `Error: edit #${i + 1} (${e.path}): newString must differ from oldString.`;
      if (!e.oldString) return `Error: edit #${i + 1} (${e.path}): oldString cannot be empty.`;

      const full = resolvePath(e.path, cwd);
      if (!working.has(full)) {
        try {
          const disk = await fs.readFile(full, 'utf8');
          working.set(full, disk);
          originals.set(full, disk);
          order.push(full);
        } catch (err: any) {
          if (err.code === 'ENOENT') return `Error: edit #${i + 1}: file not found: ${e.path}. Use WriteFileTool to create files.`;
          throw err;
        }
      }
      const content = working.get(full)!;
      const occ = countOccurrences(content, e.oldString);
      if (occ === 0) return `Error: edit #${i + 1} (${e.path}): oldString not found (after preceding edits). Match the file exactly.`;
      if (occ > 1 && !e.replaceAll) return `Error: edit #${i + 1} (${e.path}): oldString appears ${occ} times — add context or set replaceAll: true.`;
      const updated = e.replaceAll ? content.split(e.oldString).join(e.newString) : content.replace(e.oldString, e.newString);
      working.set(full, updated);
    }

    // Blast-radius gate — check every distinct file; a decline anywhere aborts the whole batch.
    for (const full of order) {
      if (!(await checkBlastRadius(full))) {
        return `MultiEdit cancelled — declined at the blast-radius gate for ${path.relative(cwd, full)}. No changes were made.`;
      }
    }

    // Inline diff approval — show the whole batch as one diff; reject is all-or-nothing.
    const combinedDiff = order.map(f => unifiedDiff(originals.get(f)!, working.get(f)!, path.relative(cwd, f))).join('\n');
    const approved = await requestDiffApproval(`MultiEdit: ${edits.length} edit(s) across ${order.length} file(s)`, combinedDiff);
    if (!approved) return `MultiEdit rejected by user. No changes were made.`;

    // Phase 2 — governance approval for every distinct file BEFORE any write, so a
    // veto leaves the workspace untouched (keeps the operation atomic).
    for (const full of order) {
      await governor.approveTaskExecution('FILE_WRITE', { targetPath: full, isDestructive: true });
    }

    // Phase 3 — back up and write every file.
    for (const full of order) {
      await backupFile(full);
      await fs.writeFile(full, working.get(full)!, 'utf8');
    }

    return `Applied ${edits.length} edit(s) across ${order.length} file(s):\n${order.map(f => '- ' + path.relative(cwd, f)).join('\n')}`;
  },
}, governor);
