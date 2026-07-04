import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolvePath } from '../path.util';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';

const execFileAsync = promisify(execFile);

/** Walk up from `dir` to the nearest directory containing package.json (or null). */
function nearestPackageRoot(dir: string): string | null {
  let cur = dir;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(cur, 'package.json'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

type Runner = { kind: 'jest' | 'vitest'; root: string } | { kind: 'go'; root: string };

/** Pick the test runner that covers this file: jest/vitest from the nearest package.json, go for .go. */
export function detectRunner(fullPath: string): Runner | null {
  if (fullPath.endsWith('.go')) return { kind: 'go', root: path.dirname(fullPath) };
  const root = nearestPackageRoot(path.dirname(fullPath));
  if (!root) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.jest || pkg.jest || fs.existsSync(path.join(root, 'jest.config.js')) || fs.existsSync(path.join(root, 'jest.config.ts'))) {
      return { kind: 'jest', root };
    }
    if (deps.vitest || fs.existsSync(path.join(root, 'vitest.config.ts')) || fs.existsSync(path.join(root, 'vitest.config.js'))) {
      return { kind: 'vitest', root };
    }
  } catch { /* unreadable package.json → no runner */ }
  return null;
}

/** Keep the informative tail of a test run (summaries and failures live at the end). */
function tail(s: string, maxLines = 40): string {
  const lines = s.trim().split('\n');
  return lines.length <= maxLines ? s.trim() : `… (${lines.length - maxLines} lines omitted)\n` + lines.slice(-maxLines).join('\n');
}

/**
 * The verification half of surgical editing: after changing a file, run ONLY the tests that cover
 * it — seconds of signal instead of a full-suite run. Jest's dependency graph (--findRelatedTests),
 * vitest's `related`, or the file's own Go package.
 */
export const createRelatedTestsTool = (governor: IGovernor) => buildTool({
  name: 'RelatedTestsTool',
  description: `Run ONLY the tests related to one just-edited file — surgical verification in seconds instead of a full-suite run.

# How it resolves
- JS/TS file in a jest project → \`jest --findRelatedTests <file>\` (jest's own dependency graph picks the test files).
- JS/TS file in a vitest project → \`vitest related <file> --run\`.
- .go file → \`go test\` on that file's package.

# When to use
- Immediately after EditFileTool / SymbolEditTool / WriteFileTool on source code, to catch regressions while the change is still fresh.
- Prefer this over BashTool test commands: it picks the right runner and the minimal test set for you.
- "No tests found" is a real answer — it means the file has no covering tests (worth telling the user).`,
  isDestructive: false,
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The source file whose related tests should run.' },
    },
    required: ['path'],
  },
  execute: async (rawArgs: any, context?: any) => {
    const cwd = context?.cwd || process.cwd();
    const fullPath = resolvePath(rawArgs.path ?? rawArgs.file_path ?? rawArgs.filePath, cwd);
    if (!fs.existsSync(fullPath)) return `Error: file not found: ${rawArgs.path}`;

    const runner = detectRunner(fullPath);
    if (!runner) {
      return `No test runner detected for ${rawArgs.path} (no jest/vitest in the nearest package.json, not a .go file). Run the project's own test command via BashTool if it uses something else.`;
    }

    const run = async (cmd: string, argv: string[], root: string) => {
      try {
        const { stdout, stderr } = await execFileAsync(cmd, argv, {
          cwd: root, timeout: 180000, maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
        });
        return { ok: true, out: `${stdout}\n${stderr}` };
      } catch (e: any) {
        // Non-zero exit = failing tests (the useful case), not a tool error.
        return { ok: false, out: `${e.stdout || ''}\n${e.stderr || e.message || e}` };
      }
    };

    let res: { ok: boolean; out: string };
    let what: string;
    if (runner.kind === 'jest') {
      what = `jest --findRelatedTests (root: ${path.relative(cwd, runner.root) || '.'})`;
      res = await run('npx', ['jest', '--findRelatedTests', fullPath, '--passWithNoTests', '--silent'], runner.root);
    } else if (runner.kind === 'vitest') {
      what = `vitest related (root: ${path.relative(cwd, runner.root) || '.'})`;
      res = await run('npx', ['vitest', 'related', fullPath, '--run', '--passWithNoTests'], runner.root);
    } else {
      what = `go test (package: ${path.relative(cwd, runner.root) || '.'})`;
      res = await run('go', ['test', './...'], runner.root);
    }

    const body = tail(res.out);
    return res.ok
      ? `✓ Related tests PASSED for ${rawArgs.path} via ${what}.\n${body}`
      : `✗ Related tests FAILED for ${rawArgs.path} via ${what} — fix these before moving on:\n${body}`;
  },
}, governor);
