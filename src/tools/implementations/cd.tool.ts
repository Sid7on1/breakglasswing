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

    // Return useful context about the new directory
    const entries = fs.readdirSync(absolutePath).slice(0, 30);
    const isCodebase = CODEBASE_MARKERS.some(m => fs.existsSync(path.join(absolutePath, m)));

    return {
      success: true,
      newCwd: absolutePath,
      isCodebase,
      contents: entries,
    };
  }
}, governor);
