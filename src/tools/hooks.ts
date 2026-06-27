import { minimatch } from 'minimatch';
import { Logger } from '../utils/logger';

// A2 — Tool hooks. Run user/built-in handlers around every tool call, at the single
// chokepoint (buildTool). A PreToolUse hook may block the call (surfaced like a governor
// veto); a PostToolUse hook reacts to the result (e.g. the B2 verify loop). Hooks are
// opt-in (nothing runs unless registered/loaded) and always non-fatal — a throwing hook is
// logged and skipped, never breaking the agent.

export interface PreHookResult {
  block?: boolean;   // true → the tool does not run
  reason?: string;   // shown to the model as the blocked tool result
}

export type PreHook = (toolName: string, args: any, context: any) => Promise<PreHookResult | void> | PreHookResult | void;

export interface PostHookResult {
  appendToResult?: string; // appended to the tool's result string (e.g. verify diagnostics)
}
export type PostHook = (toolName: string, args: any, result: any, context: any) => Promise<PostHookResult | void> | PostHookResult | void;

interface PreReg { match: (name: string) => boolean; handler: PreHook; }
interface PostReg { match: (name: string) => boolean; handler: PostHook; }

const preHooks: PreReg[] = [];
const postHooks: PostReg[] = [];

/** Build a tool-name matcher from a glob string, a list of globs, or `'*'` (all tools). */
function toMatcher(pattern: string | string[]): (name: string) => boolean {
  const pats = Array.isArray(pattern) ? pattern : [pattern];
  return (name: string) => pats.some(p => p === '*' || p === name || minimatch(name, p));
}

/** Register a PreToolUse hook. Returns an unregister function. */
export function registerPreHook(pattern: string | string[], handler: PreHook): () => void {
  const reg: PreReg = { match: toMatcher(pattern), handler };
  preHooks.push(reg);
  return () => { const i = preHooks.indexOf(reg); if (i >= 0) preHooks.splice(i, 1); };
}

/** Register a PostToolUse hook. Returns an unregister function. */
export function registerPostHook(pattern: string | string[], handler: PostHook): () => void {
  const reg: PostReg = { match: toMatcher(pattern), handler };
  postHooks.push(reg);
  return () => { const i = postHooks.indexOf(reg); if (i >= 0) postHooks.splice(i, 1); };
}

/** Remove all hooks (used by tests and re-init). */
export function clearHooks(): void {
  preHooks.length = 0;
  postHooks.length = 0;
}

export function hookCounts(): { pre: number; post: number } {
  return { pre: preHooks.length, post: postHooks.length };
}

/**
 * Run matching PreToolUse hooks. Returns the first blocking result, or void to proceed.
 * Hook errors are logged and treated as non-blocking.
 */
export async function runPreHooks(toolName: string, args: any, context: any): Promise<PreHookResult | void> {
  for (const h of preHooks) {
    if (!h.match(toolName)) continue;
    try {
      const r = await h.handler(toolName, args, context);
      if (r && r.block) return r;
    } catch (e: any) {
      Logger.warn(`[Hooks] PreToolUse hook for ${toolName} errored (ignored): ${e.message}`);
    }
  }
}

/**
 * Run matching PostToolUse hooks. Returns any text the hooks asked to append to the tool
 * result (joined), or '' if none. Errors are logged and swallowed (never break the turn).
 */
export async function runPostHooks(toolName: string, args: any, result: any, context: any): Promise<string> {
  const appended: string[] = [];
  for (const h of postHooks) {
    if (!h.match(toolName)) continue;
    try {
      const r = await h.handler(toolName, args, result, context);
      if (r && r.appendToResult) appended.push(r.appendToResult);
    } catch (e: any) {
      Logger.warn(`[Hooks] PostToolUse hook for ${toolName} errored (ignored): ${e.message}`);
    }
  }
  return appended.join('\n\n');
}
