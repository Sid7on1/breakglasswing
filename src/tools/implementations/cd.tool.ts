import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { cliEvents } from '../../cli/events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CODEBASE_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Makefile'];

export const createCdTool = (governor: IGovernor) => buildTool({
  name: 'ChangeDirectoryTool',
  description: `Changes the working directory for this session. Use when the user says "cd" or when you need to work from a different location. After changing, the new CWD persists for all subsequent tool calls.`,
  isDestructive: false,
  isConcurrencySafe: false,
  schema: {
    type: 'object',
    properties: {
      targetPath: { type: 'string', description: 'Path to cd into (supports ~)' }
    },
    required: ['targetPath']
  },
  execute: async (args: { targetPath: string }, context?: any) => {
    const currentCwd = context?.cwd || process.cwd();
    const resolvedPath = args.targetPath.replace(/^~(?=\/|$)/, os.homedir());
    const absolutePath = path.resolve(currentCwd, resolvedPath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Directory does not exist: ${absolutePath}`);
    }

    const stats = fs.statSync(absolutePath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${absolutePath}`);
    }

    // Isolate state by mutating the agent context, not the global process
    if (context && typeof context.cwd !== 'undefined') {
      context.cwd = absolutePath;
    } else {
      process.chdir(absolutePath); // Fallback if no context provided
    }

    // Tell the UI the project changed so it reloads the per-project graph / map panel — otherwise
    // the panel keeps showing whatever was indexed at launch (e.g. a stale home-dir map).
    cliEvents.emit('cwd_changed', absolutePath);

    // Return a single concise line (not a 23-line JSON blob) — enough for the model to know where it
    // landed and roughly what's there; it can `ls` for the full listing if it actually needs it.
    const all = fs.readdirSync(absolutePath).filter(n => n !== '.DS_Store');
    const isCodebase = CODEBASE_MARKERS.some(m => fs.existsSync(path.join(absolutePath, m)));
    const preview = all.slice(0, 12).join(', ');
    const more = all.length > 12 ? ` …(+${all.length - 12} more)` : '';
    return `Now in ${absolutePath}${isCodebase ? ' (codebase)' : ''}. Contains: ${preview}${more}`;
  }
}, governor);
