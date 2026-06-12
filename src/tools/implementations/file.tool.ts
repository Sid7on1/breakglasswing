import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';

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
        const lines = content.split('\n');
        const start = Math.max(1, args.startLine || 1);
        const end = Math.min(lines.length, args.endLine || lines.length);
        
        if (start > end) {
          return `Error: startLine (${start}) cannot be greater than endLine (${end}).`;
        }
        
        return lines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line}`).join('\n');
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
- **Modifying Code:** Do NOT attempt to rewrite entire 1000-line files if you only need to change one line. Instead, use the \`BashTool\` with \`sed\` or wait for the dedicated \`FileEditTool\`.
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
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, args.content, 'utf-8');
    return `Successfully wrote to ${args.path}`;
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
    try {
      await fs.rm(fullPath, { recursive: true, force: true });
      return `Successfully deleted ${args.path}`;
    } catch (e: any) {
      return `Failed to delete ${args.path}: ${e.message}`;
    }
  }
}, governor);
