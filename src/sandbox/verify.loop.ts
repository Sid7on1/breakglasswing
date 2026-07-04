import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { IGraphStore } from '../graph/models';
import { PostHookResult } from '../tools/hooks';

const execFileAsync = promisify(execFile);

// B2 — auto edit→verify→fix loop. Implemented as a PostToolUse hook on the edit tools: after
// a successful edit, run a fast check and, on failure, APPEND the diagnostics to the tool
// result so the model self-corrects on its next loop step (no nested LLM call, no
// re-entrancy). Off by default (/governor verify on). Capped per file so a fix the model
// can't make doesn't nag forever.

let enabled = false;
let store: IGraphStore | null = null;
const attempts = new Map<string, number>(); // fullPath -> consecutive failed verifies reported
const MAX_ATTEMPTS = 2;

export function setVerifyEnabled(v: boolean): void { enabled = v; if (!v) attempts.clear(); }
export function isVerifyEnabled(): boolean { return enabled; }
export function registerVerifyGraphStore(s: IGraphStore | null): void { store = s; }

const CHECKABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const EDIT_TOOLS = ['EditFileTool', 'WriteFileTool', 'MultiEditTool'];
export const VERIFY_TOOLS = EDIT_TOOLS;

function editedPath(args: any): string | null {
  if (args?.path) return args.path;
  if (Array.isArray(args?.edits) && args.edits[0]?.path) return args.edits[0].path;
  return null;
}

/** True when no graph store is registered, or the file owns at least one graph node. */
function fileIsRelevant(absPath: string): boolean {
  if (!store) return true;
  const norm = absPath.replace(/\\/g, '/');
  for (const node of store.getGraph().nodes.values()) {
    if (node.filePath && norm.endsWith(node.filePath.replace(/\\/g, '/'))) return true;
  }
  return false;
}

/** Run the fast check for a file: `node --check` for JS, project `tsc --noEmit` (filtered to
 *  the file) for TS. Returns passed=true when there's nothing actionable to report. */
async function runCheck(full: string, cwd: string, ext: string): Promise<{ passed: boolean; logs: string }> {
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    try {
      await execFileAsync('node', ['--check', full], { timeout: 20000 });
      return { passed: true, logs: '' };
    } catch (e: any) {
      return { passed: false, logs: (e.stderr || e.message || '').toString().trim() };
    }
  }
  // TypeScript: a project typecheck is accurate (single-file tsc misreports cross-file
  // imports). Run it, then keep only diagnostics for the edited file.
  if (!fs.existsSync(path.join(cwd, 'tsconfig.json'))) return { passed: true, logs: '' };
  try {
    await execFileAsync('npx', ['tsc', '--noEmit'], { cwd, timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
    return { passed: true, logs: '' };
  } catch (e: any) {
    const out = ((e.stdout || '') + '\n' + (e.stderr || '')).toString();
    const rel = path.relative(cwd, full).replace(/\\/g, '/');
    const mine = out.split('\n').filter(l => l.includes(rel) || l.includes(path.basename(full)));
    if (mine.length === 0) return { passed: true, logs: '' }; // errors are elsewhere, not our edit
    return { passed: false, logs: mine.join('\n') };
  }
}

/** PostToolUse handler implementing the verify loop. */
export async function verifyHook(_toolName: string, args: any, result: any, context: any): Promise<PostHookResult | void> {
  if (!enabled) return undefined;
  if (typeof result === 'string' && /\b(rejected|cancelled|blocked|not found|Error)\b/i.test(result)) return undefined;

  const rel = editedPath(args);
  if (!rel) return undefined;
  const cwd = context?.cwd || process.cwd();
  const full = path.resolve(cwd, rel);
  const ext = path.extname(full).toLowerCase();
  if (!CHECKABLE.has(ext)) return undefined;
  if (!fileIsRelevant(full)) return undefined;

  const { passed, logs } = await runCheck(full, cwd, ext);
  if (passed) { attempts.delete(full); return undefined; }

  const n = (attempts.get(full) || 0) + 1;
  attempts.set(full, n);
  if (n > MAX_ATTEMPTS) {
    return { appendToResult: `⚠️ Auto-verify: ${rel} still fails after ${MAX_ATTEMPTS} fix attempt(s) — pausing auto-verify for it. Fix manually or run /heal.` };
  }
  return { appendToResult: `⚠️ Auto-verify failed for ${rel}. Fix these errors, then continue:\n${logs.slice(0, 1500)}` };
}
