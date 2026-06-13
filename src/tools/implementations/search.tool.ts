import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { minimatch } from 'minimatch';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { walkFiles } from '../../utils/fsWalk';

function resolvePath(p: string, cwd: string): string {
  if (!p) return cwd;
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(p[1] === '/' ? 2 : 1));
  return path.resolve(cwd, p);
}

/** Cheap binary sniff: a NUL byte in the first chunk means "don't grep this". */
function looksBinary(sample: string): boolean {
  return sample.includes('\u0000');
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // skip files larger than 5MB

interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  caseInsensitive?: boolean;
  outputMode?: 'content' | 'files' | 'count';
  contextLines?: number;
  maxResults?: number;
}

export const createGrepTool = (governor: IGovernor) => buildTool({
  name: 'GrepTool',
  description: `Searches file contents across the workspace using a regular expression. This is the right tool for "where is X used / defined / referenced" questions — far faster and more token-efficient than reading files one by one or piping to \`grep\` via BashTool.

# Instructions
- **pattern** is a JavaScript regular expression (e.g. \`function\\s+\\w+\`, \`TODO|FIXME\`). Escape special characters you mean literally.
- Use **glob** to restrict the file set (e.g. \`**/*.ts\`, \`src/**/*.tsx\`).
- **outputMode**: \`content\` returns matching lines with line numbers (default), \`files\` returns just the file paths that contain a match, \`count\` returns the number of matches per file.
- High-traffic directories (node_modules, .git, dist, build, coverage) are skipped automatically.`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The regular expression to search for.' },
      path: { type: 'string', description: 'File or directory to search (default: current working directory).' },
      glob: { type: 'string', description: 'Optional glob to filter files, e.g. "**/*.ts".' },
      caseInsensitive: { type: 'boolean', description: 'Case-insensitive matching (default false).' },
      outputMode: { type: 'string', enum: ['content', 'files', 'count'], description: 'content | files | count. Default content.' },
      contextLines: { type: 'number', description: 'Lines of context to show before/after each match (content mode only).' },
      maxResults: { type: 'number', description: 'Maximum matching lines or files to return (default 200).' },
    },
    required: ['pattern'],
  },
  execute: async (args: GrepArgs, context?: any) => {
    const cwd = context?.cwd || process.cwd();
    const root = resolvePath(args.path || '.', cwd);
    const outputMode = args.outputMode || 'content';
    const maxResults = args.maxResults ?? 200;
    const ctx = Math.max(0, args.contextLines ?? 0);

    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.caseInsensitive ? 'i' : undefined);
    } catch (e: any) {
      return `Error: invalid regular expression: ${e.message}`;
    }

    // Build the candidate file list (a single file path is allowed too).
    const rootStat = await fs.stat(root).catch(() => null);
    if (!rootStat) return `Error: path not found: ${args.path || '.'}`;

    const files: string[] = [];
    if (rootStat.isFile()) {
      files.push(root);
    } else {
      for await (const f of walkFiles(root)) {
        if (args.glob) {
          const rel = path.relative(root, f);
          if (!minimatch(rel, args.glob, { dot: true })) continue;
        }
        files.push(f);
      }
    }

    const contentLines: string[] = [];
    const matchedFiles: string[] = [];
    const counts: { file: string; n: number }[] = [];
    let total = 0;

    outer: for (const file of files) {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || stat.size > MAX_FILE_BYTES) continue;
      let text: string;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      if (looksBinary(text.slice(0, 1024))) continue;

      const lines = text.split('\n');
      let fileMatches = 0;
      for (let i = 0; i < lines.length; i++) {
        // Reset lastIndex defensively in case a global flag is ever added.
        regex.lastIndex = 0;
        if (!regex.test(lines[i])) continue;
        fileMatches++;
        total++;

        if (outputMode === 'content') {
          const rel = path.relative(cwd, file) || path.basename(file);
          const from = Math.max(0, i - ctx);
          const to = Math.min(lines.length - 1, i + ctx);
          for (let j = from; j <= to; j++) {
            const marker = j === i ? ':' : '-';
            contentLines.push(`${rel}${marker}${j + 1}${marker}${lines[j]}`);
          }
          if (ctx > 0) contentLines.push('--');
          if (contentLines.length >= maxResults) break outer;
        } else if (outputMode === 'files') {
          break; // one match is enough to include the file
        }
      }

      if (fileMatches > 0) {
        if (outputMode === 'files') {
          matchedFiles.push(path.relative(cwd, file) || file);
          if (matchedFiles.length >= maxResults) break;
        } else if (outputMode === 'count') {
          counts.push({ file: path.relative(cwd, file) || file, n: fileMatches });
        }
      }
    }

    if (outputMode === 'files') {
      if (matchedFiles.length === 0) return `No files matched /${args.pattern}/.`;
      return `${matchedFiles.length} file(s) matched:\n${matchedFiles.sort().join('\n')}`;
    }
    if (outputMode === 'count') {
      if (counts.length === 0) return `No matches for /${args.pattern}/.`;
      counts.sort((a, b) => b.n - a.n);
      return counts.map(c => `${c.n}\t${c.file}`).join('\n');
    }
    if (contentLines.length === 0) return `No matches for /${args.pattern}/.`;
    const header = `Found ${total} match(es)${total > maxResults ? ` (showing first ${maxResults})` : ''}:`;
    return `${header}\n${contentLines.join('\n')}`;
  },
}, governor);

interface GlobArgs {
  pattern: string;
  path?: string;
  maxResults?: number;
}

export const createGlobTool = (governor: IGovernor) => buildTool({
  name: 'GlobTool',
  description: `Finds files by glob pattern, returned newest-first (by modification time). Use this to locate files by name or extension when you don't know their exact path — e.g. "all test files", "every tsx component".

# Instructions
- **pattern** is a glob such as \`**/*.ts\`, \`src/**/*.tsx\`, or \`**/index.*\`.
- Results are relative to the search directory and exclude node_modules/.git/dist by default.`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts".' },
      path: { type: 'string', description: 'Directory to search from (default: current working directory).' },
      maxResults: { type: 'number', description: 'Maximum file paths to return (default 500).' },
    },
    required: ['pattern'],
  },
  execute: async (args: GlobArgs, context?: any) => {
    const cwd = context?.cwd || process.cwd();
    const root = resolvePath(args.path || '.', cwd);
    const maxResults = args.maxResults ?? 500;

    const matches: { file: string; mtime: number }[] = [];
    for await (const f of walkFiles(root)) {
      const rel = path.relative(root, f);
      if (!minimatch(rel, args.pattern, { dot: true })) continue;
      const stat = await fs.stat(f).catch(() => null);
      matches.push({ file: path.relative(cwd, f) || f, mtime: stat ? stat.mtimeMs : 0 });
    }

    if (matches.length === 0) return `No files matched ${args.pattern}.`;
    matches.sort((a, b) => b.mtime - a.mtime);
    const shown = matches.slice(0, maxResults);
    const suffix = matches.length > maxResults ? `\n...and ${matches.length - maxResults} more` : '';
    return `${matches.length} file(s) matched ${args.pattern}:\n${shown.map(m => m.file).join('\n')}${suffix}`;
  },
}, governor);
