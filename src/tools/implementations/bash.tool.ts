import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';

const execAsync = promisify(exec);
const MAX_OUTPUT_CHARS = 50_000;

export const createBashTool = (governor: IGovernor) => buildTool({
  name: 'BashTool',
  description: `Executes a bash command and returns stdout/stderr.

Runs in the agent's current working directory (changeable via ChangeDirectoryTool).
Prefer dedicated tools over BashTool: ReadFileTool for reading, WriteFileTool for writing.
Reserve BashTool for actual shell operations (installs, builds, git, processes, deleting files or folders with rm, moving files with mv).

# Directory Creation & Verification Rules:
- When asked to create a directory, ALWAYS use \`mkdir -p\`. 
- If \`mkdir\` fails with "File exists", it means a FILE (not a folder) with that name already exists. DO NOT tell the user "the folder already exists". Instead, use \`ls -la\` to inspect the conflicting file, and ask the user if they want to delete/rename it.
- Before creating a deeply nested directory (e.g., \`mkdir -p foo/bar/baz\`), use \`ls\` on the parent to verify you are in the correct location.

- Chain dependent commands with \`&&\`. Each call is a fresh subshell.
- Use \`~\` for home directory — it will be resolved.
- Quote paths with spaces using double quotes.
- Git: never force-push or reset --hard unless explicitly asked.`,
  isDestructive: true,
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' }
    },
    required: ['command']
  },
  execute: async (args: { command: string, timeout?: number }, context?: any) => {
    try {
      const currentCwd = context?.cwd || process.cwd();
      const cmd = args.command.replace(/^~(?=\/|$)/, os.homedir());
      const timeoutMs = args.timeout ?? 30_000;
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: currentCwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      const out = stdout.trim();
      const err = stderr.trim();
      return {
        stdout: out.length > MAX_OUTPUT_CHARS ? out.slice(0, MAX_OUTPUT_CHARS) + '\n...[truncated]' : out,
        stderr: err.length > MAX_OUTPUT_CHARS ? err.slice(0, MAX_OUTPUT_CHARS) + '\n...[truncated]' : err,
      };
    } catch (e: any) {
      if (e.killed) {
        throw new Error(`Command timed out after ${args.timeout ?? 30_000}ms: ${args.command}`);
      }
      throw new Error(`Bash execution failed: ${e.message}`);
    }
  }
}, governor);
