import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { sandboxArgv } from '../../sandbox/exec.sandbox';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
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
    // Coerce the model-supplied timeout. LLMs frequently emit it as a string,
    // a float, or an out-of-range value, which makes Node's exec throw
    // ERR_OUT_OF_RANGE ("timeout ... must be an unsigned integer") and derails
    // the whole task. Clamp to a finite integer in [0, 600000]ms.
    const rawTimeout = Number(args.timeout);
    const timeoutMs = Number.isFinite(rawTimeout)
      ? Math.min(Math.max(0, Math.floor(rawTimeout)), 600_000)
      : 30_000;
    try {
      const currentCwd = context?.cwd || process.cwd();
      const cmd = args.command.replace(/^~(?=\/|$)/, os.homedir());
      // When sandboxing is on (B3), run the command under sandbox-exec via execFile so the
      // profile + the command pass as discrete argv (no shell re-quoting). Otherwise run it
      // through the shell exactly as before.
      const sbArgv = sandboxArgv(cmd, currentCwd);
      const { stdout, stderr } = sbArgv
        ? await execFileAsync('sandbox-exec', sbArgv, { cwd: currentCwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 })
        : await execAsync(cmd, { cwd: currentCwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
      const out = stdout.trim();
      const err = stderr.trim();
      return {
        stdout: out.length > MAX_OUTPUT_CHARS ? out.slice(0, MAX_OUTPUT_CHARS) + '\n...[truncated]' : out,
        stderr: err.length > MAX_OUTPUT_CHARS ? err.slice(0, MAX_OUTPUT_CHARS) + '\n...[truncated]' : err,
      };
    } catch (e: any) {
      if (e.killed) {
        throw new Error(`Command timed out after ${timeoutMs}ms: ${args.command}`, { cause: e });
      }
      // A NON-ZERO exit is normal and useful for many commands — `tsc` with type errors, a failing
      // `npm test`, `grep` with no match. Node's exec rejects in that case but attaches the captured
      // output (e.stdout / e.stderr) and exit code. Return THAT instead of discarding it as a bare
      // "Command failed", so the model sees the actual errors and can act — no more redirecting to a
      // temp file just to read tsc/test output.
      const out = String(e.stdout || '').trim();
      const err = String(e.stderr || '').trim();
      if (out || err) {
        const tag = e.code != null ? `\n[command exited with code ${e.code}]` : '';
        return {
          stdout: out.length > MAX_OUTPUT_CHARS ? out.slice(0, MAX_OUTPUT_CHARS) + '\n...[truncated]' : out,
          stderr: ((err + tag).length > MAX_OUTPUT_CHARS ? (err + tag).slice(0, MAX_OUTPUT_CHARS) + '\n...[truncated]' : (err + tag)),
        };
      }
      throw new Error(`Bash execution failed: ${e.message}`, { cause: e });
    }
  }
}, governor);
