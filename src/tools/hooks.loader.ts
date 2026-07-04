import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { registerPreHook, registerPostHook } from './hooks';
import { Logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

// A2 — load shell-command hooks from .bimax/hooks.json. A PreToolUse command that exits
// non-zero BLOCKS the tool (its stderr becomes the reason); PostToolUse commands run for
// their side effects (e.g. lint/notify). The tool name + JSON args are passed via env vars
// (BIMAX_TOOL_NAME / BIMAX_TOOL_ARGS) so scripts can branch on them.

interface HookSpec { match: string | string[]; command: string; }
interface HooksConfig { preToolUse?: HookSpec[]; postToolUse?: HookSpec[]; }

function runShell(command: string, toolName: string, args: any) {
  let argsJson = '{}';
  try { argsJson = JSON.stringify(args); } catch { /* circular/oversized args → empty */ }
  return execFileAsync('/bin/sh', ['-c', command], {
    env: { ...process.env, BIMAX_TOOL_NAME: toolName, BIMAX_TOOL_ARGS: argsJson },
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
}

/**
 * Register hooks declared in `<dir>/.bimax/hooks.json`. Returns the number registered.
 * Best-effort: a missing/invalid file registers nothing.
 */
export function loadHooksConfig(dir: string = process.cwd()): number {
  const file = path.join(dir, '.bimax', 'hooks.json');
  let cfg: HooksConfig;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return 0;
  }

  let n = 0;
  for (const h of cfg.preToolUse || []) {
    if (!h.command) continue;
    registerPreHook(h.match || '*', async (toolName, args) => {
      try {
        await runShell(h.command, toolName, args);
      } catch (e: any) {
        const reason = (e.stderr || e.message || 'hook command failed').toString().trim();
        return { block: true, reason };
      }
      return undefined; // command succeeded — don't block
    });
    n++;
  }
  for (const h of cfg.postToolUse || []) {
    if (!h.command) continue;
    registerPostHook(h.match || '*', async (toolName, args) => {
      try {
        await runShell(h.command, toolName, args);
      } catch (e: any) {
        Logger.warn(`[Hooks] PostToolUse command failed for ${toolName}: ${e.message}`);
      }
    });
    n++;
  }
  return n;
}
