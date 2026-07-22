import * as path from 'path';
import { resolvePath } from '../path.util';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { fileStateCache } from '../../memory/file-state-cache';

interface FreeContextArgs {
  reason: string;
  items: string[];
}

/** Most recent tool results left intact when releasing tool_results (mirrors ContextManager). */
const KEEP_RECENT_TOOL_RESULTS = 6;
const RELEASED_STUB = '[tool result released via FreeContextTool]';

/** Cheap, deterministic token estimate (chars/4) — used only for the before/after report. */
function estimateTokens(messages: Array<{ content?: unknown }>): number {
  let chars = 0;
  for (const m of messages) if (typeof m?.content === 'string') chars += (m.content as string).length;
  return Math.ceil(chars / 4);
}

/**
 * Release eligible HISTORICAL tool-result bodies from the live session context, in place.
 * Preserves atomic assistant-tool-call/tool-result groupings: only the BODY of an old `tool`
 * message is replaced (role + tool_call_id stay), and the most recent results are kept intact.
 * Returns measured before/after estimates so the model's report is truthful.
 */
export function releaseToolResults(messages: Array<{ role?: string; content?: unknown }>): {
  cleared: number; tokensBefore: number; tokensAfter: number;
} {
  const tokensBefore = estimateTokens(messages);
  const toolIdx = messages.map((m, i) => (m?.role === 'tool' ? i : -1)).filter(i => i >= 0);
  let cleared = 0;
  if (toolIdx.length > KEEP_RECENT_TOOL_RESULTS) {
    const clearBefore = toolIdx[toolIdx.length - KEEP_RECENT_TOOL_RESULTS];
    for (const i of toolIdx) {
      if (i >= clearBefore) break;
      const m = messages[i] as { role?: string; content?: unknown };
      if (typeof m.content !== 'string' || m.content === RELEASED_STUB) continue;
      m.content = RELEASED_STUB; // in-place: the loop and the persona share these objects
      cleared++;
    }
  }
  return { cleared, tokensBefore, tokensAfter: estimateTokens(messages) };
}

/**
 * FreeContextTool — model-driven explicit context release (Bimax-unique).
 *
 * When the model is done working with a set of files or tool results and
 * wants to free context window space, it calls this tool instead of waiting
 * for the ContextManager to evict them automatically. Released files are
 * marked in FileStateCache so they are excluded from post-compact restoration,
 * and "tool_results" ACTUALLY clears eligible historical tool-result bodies
 * from the active session context (measured, not merely acknowledged).
 */
export const createFreeContextTool = (governor: IGovernor) => buildTool({
  name: 'FreeContextTool',
  description: `Explicitly releases context items you no longer need, freeing space in the context window.

Call this when you are done with specific files or have processed a tool result and won't need it again. Released files are excluded from automatic post-compaction restoration.

# When to use
- After reviewing a file to understand something (and you won't edit it)
- After processing a large tool result you've already extracted the key info from
- When the context window is getting full and some of your working set is no longer relevant

# Instructions
- Pass file paths as items (relative or absolute)
- Pass "tool_results" to immediately clear old tool-result bodies from this session (the most recent ${KEEP_RECENT_TOOL_RESULTS} are kept)
- Always provide a reason so the session log is interpretable`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why you are releasing this context (e.g. "review complete", "no longer relevant").',
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths to release from context tracking (relative or absolute), and/or "tool_results" to clear old tool-result history now.',
      },
    },
    required: ['reason', 'items'],
  },
  execute: async (args: FreeContextArgs, context?: any) => {
    const cwd = context?.cwd || process.cwd();
    const released: string[] = [];

    for (const item of args.items) {
      if (!item) continue;
      if (item === 'tool_results') {
        const live = context?.sessionMessages;
        if (!Array.isArray(live)) {
          released.push('(tool results — no live session context available to this call)');
          continue;
        }
        const { cleared, tokensBefore, tokensAfter } = releaseToolResults(live);
        released.push(cleared > 0
          ? `${cleared} historical tool result(s) cleared — context estimate ${tokensBefore} → ${tokensAfter} tokens (~${tokensBefore - tokensAfter} freed; newest ${KEEP_RECENT_TOOL_RESULTS} kept intact)`
          : `tool results — nothing eligible to clear (fewer than ${KEEP_RECENT_TOOL_RESULTS + 1} tool results, or already cleared)`);
        continue;
      }

      const absPath = resolvePath(item, cwd);
      fileStateCache.markEvicted(absPath);
      released.push(path.relative(cwd, absPath) || item);
    }

    if (released.length === 0) {
      return 'No items released — nothing matched. Paths must be existing files in the project.';
    }

    const lines = [
      `Released ${released.length} context item(s). Reason: ${args.reason}.`,
      ...released.map(r => `  • ${r}`),
      '',
      'Released files will not be restored after the next compaction. Proceed with the current task.',
    ];

    return lines.join('\n');
  },
}, governor);
