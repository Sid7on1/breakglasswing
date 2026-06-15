import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { backupFile, unifiedDiff, compactDiff, capDiff } from '../../cli/fileEditor';
import { requestDiffApproval } from '../../cli/diffApproval';
import { checkBlastRadius } from '../../cli/blastGate';
import { sliceLineRange } from '../file-range';
import { detectCorruptWrite } from '../write-guard';

function resolvePath(p: string, cwd: string): string {
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(p[1] === '/' ? 2 : 1));
  return path.resolve(cwd, p);
}

export const createReadFileTool = (governor: IGovernor) => buildTool({
  name: 'ReadFileTool',
  description: `Reads the contents of a file from the local file system.

Use this tool to inspect source code, configuration files, or logs. It natively handles truncation for massive files and is significantly more token-efficient than using \`cat\` in the BashTool.

# Instructions
- **Absolute Paths Required:** You MUST provide the absolute path to the target file.
- **Line Ranges:** If you are working with a massive file (>1000 lines), do NOT attempt to read the entire file at once. Use the \`startLine\` and \`endLine\` parameters to read localized chunks.
- **Context Gathering:** When investigating a bug, do not read files blindly. First, use the \`GraphQueryTool\` to find the exact file paths and class names relevant to the feature.
- **No Directories:** This tool only works on files. If you need to see the contents of a directory, use the \`BashTool\` with \`ls -la\`.`,
  isDestructive: false, // Read-only
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file.'
      },
      startLine: {
        type: 'number',
        description: 'Optional. The 1-indexed start line to read from.'
      },
      endLine: {
        type: 'number',
        description: 'Optional. The 1-indexed end line to read to.'
      }
    },
    required: ['path']
  },
  execute: async (args: any, context?: any) => {
    try {
      const currentCwd = context?.cwd || process.cwd();
      const fullPath = resolvePath(args.path, currentCwd);
      const content = await fs.readFile(fullPath, 'utf8');
      
      if (args.startLine !== undefined || args.endLine !== undefined) {
        const { text, error } = sliceLineRange(content, args.startLine, args.endLine);
        if (error) return `Error: ${error}`;
        return text;
      }
      
      return content;
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return `Error: File not found at ${args.path}`;
      }
      throw e;
    }
  }
}, governor);

export const createWriteFileTool = (governor: IGovernor) => buildTool({
  name: 'WriteFileTool',
  description: `Creates, overwrites, or modifies a file on the local file system.

Use this tool to write new code, update configuration files, or generate artifacts. It is significantly faster, safer, and more reliable than attempting to use \`echo\` or \`cat <<EOF\` via the BashTool.

# Instructions
- **Supports \`~/Desktop/...\` paths** — home directory is automatically resolved.
- **Directory Creation:** If the parent directories do not exist, the tool will automatically create them for you.
- **Do NOT create empty directories:** Do NOT use this tool if you only want to create a new folder/directory. This tool creates FILES. If you need to create an empty directory, use \`BashTool\` with \`mkdir\`.
- **Overwriting:** By default, writing to an existing file will fail to prevent accidental data loss. To explicitly replace an existing file, you must pass \`overwrite: true\`. 
- **Modifying existing code:** Do NOT rewrite a whole file to change part of it. Use \`EditFileTool\` for a surgical oldString→newString replacement — it is safer and avoids accidentally dropping newlines. A full-file overwrite that collapses a multi-line file to one line will be REFUSED.
- **Multi-line content:** Always emit real newline characters between lines. Never flatten code onto a single line.
- **Validation:** After writing a complex script or TypeScript file, immediately use the \`BashTool\` to run a syntax check (e.g., \`npx tsc --noEmit\`) to verify your write didn't introduce syntax errors.`,
  isDestructive: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file (supports ~/ for home dir)' },
      content: { type: 'string', description: 'Content to write' },
      overwrite: { type: 'boolean', description: 'Must be true to overwrite an existing file' }
    },
    required: ['path', 'content']
  },
  execute: async (args: { path: string, content: string, overwrite?: boolean }, context?: any) => {
    const currentCwd = context?.cwd || process.cwd();
    const fullPath = resolvePath(args.path, currentCwd);
    const exists = await fs.access(fullPath).then(() => true).catch(() => false);
    if (exists && !args.overwrite) {
      throw new Error(`File already exists: ${args.path}. Pass overwrite: true to replace it.`);
    }
    // Blast-radius gate — only meaningful when overwriting an existing, indexed file.
    if (exists && !(await checkBlastRadius(fullPath))) {
      return `Write to ${args.path} cancelled — declined at the blast-radius gate. No changes were made.`;
    }
    // Inline diff approval (no-op unless enabled and an interactive approver is registered).
    const prior = exists ? await fs.readFile(fullPath, 'utf-8').catch(() => '') : '';
    const approved = await requestDiffApproval(
      exists ? `Overwrite ${args.path}` : `Create ${args.path}`,
      unifiedDiff(prior, args.content, args.path)
    );
    if (!approved) return `Write to ${args.path} rejected by user. No changes were made.`;
    // Guard against the "flattened file" corruption (model strips newlines on a full-file
    // overwrite). Refuse before touching disk and steer the model to a surgical edit.
    if (exists) {
      const flat = detectCorruptWrite(prior, args.content, fullPath);
      if (flat) {
        return `Write to ${args.path} refused: ${flat}. No changes were made. ` +
          `To modify an existing file use EditFileTool (surgical oldString→newString) and keep real newline characters in multi-line content.`;
      }
    }
    // Snapshot overwrites so /undo and /diff-file can restore the prior version.
    if (exists) await backupFile(fullPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, args.content, 'utf-8');
    const diff = capDiff(compactDiff(prior, args.content, args.path));
    return `${exists ? 'Updated' : 'Created'} ${args.path}${diff ? `:\n${diff}` : ''}`;
  }
}, governor);

export const createDeleteTool = (governor: IGovernor) => buildTool({
  name: 'DeleteTool',
  description: `Deletes files or directories from the local file system.

Use this tool whenever the user explicitly asks you to delete, remove, or trash a file or folder. Do NOT use the BashTool for this.

# Instructions
- **Supports \`~/\` paths** — home directory is automatically resolved.
- **Directories:** It will recursively delete the directory and all of its contents.`,
  isDestructive: true,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file or directory to delete' }
    },
    required: ['path']
  },
  execute: async (args: { path: string }, context?: any) => {
    const currentCwd = context?.cwd || process.cwd();
    const fullPath = resolvePath(args.path, currentCwd);
    // Verify the target actually exists BEFORE deleting. fs.rm with `force: true`
    // silently treats a missing path as success, which would let us report
    // "Successfully deleted" for a path that never existed (e.g. a bare name
    // resolved against the wrong cwd). Fail loudly instead so the caller can retry.
    const exists = await fs.access(fullPath).then(() => true).catch(() => false);
    if (!exists) {
      return `Error: Nothing to delete — no file or directory found at ${fullPath} (resolved from "${args.path}" relative to ${currentCwd}). Nothing was changed. If the target lives elsewhere, pass its absolute path.`;
    }
    try {
      await fs.rm(fullPath, { recursive: true, force: true });
      return `Successfully deleted ${fullPath}`;
    } catch (e: any) {
      return `Failed to delete ${args.path}: ${e.message}`;
    }
  }
}, governor);

export const createMakeDirTool = (governor: IGovernor) => buildTool({
  name: 'CreateDirectoryTool',
  description: `Creates a new, empty directory (folder) on the local file system.

Use this tool whenever the user asks you to create, make, or add a new *folder* or *directory*. Do NOT use WriteFileTool for this — that tool writes FILES, not folders.

# Instructions
- **Supports \`~/\` and \`~/Desktop/...\` paths** — the home directory is resolved automatically.
- **Recursive:** Parent directories are created automatically if they are missing (like \`mkdir -p\`).
- **Idempotent:** If the directory already exists, this succeeds without error.`,
  isDestructive: false,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path of the directory to create (supports ~/ for home dir)' }
    },
    required: ['path']
  },
  execute: async (args: { path: string }, context?: any) => {
    const currentCwd = context?.cwd || process.cwd();
    const fullPath = resolvePath(args.path, currentCwd);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat && stat.isFile()) {
      return `Error: A file already exists at ${fullPath}, so a directory with that name cannot be created. Delete the file first if you meant to replace it with a folder.`;
    }
    await fs.mkdir(fullPath, { recursive: true });
    return `Successfully created directory ${fullPath}`;
  }
}, governor);
