// Translating a Bimax tool call into the effects it declares — S28-A step 2.
//
// Tier S28-0 (docs/product-reset/11_SECTIONS_28_29_RESEARCH_AND_DELIVERY_PLAN.md §4) is the one
// observation tier that needs no permission at all, because "Bimax already owns both intent and
// receipt". This file is the intent half: it turns `(toolName, args)` into a `DeclaredEffects`.
//
// The hard part is honesty about what we do NOT know. A `Write` tool call names its target and that
// is a fact. A `Bash` call names a shell string, and the actual filesystem and network effects of
// that string are not observable from Terminal without the process-provenance sensor that S28-D
// gates behind an Apple entitlement. So Bash returns a *static reading*, flagged as such, and the
// guard attaches an evidence gap to it. A finding built on a static reading says so, and no
// verification built on one can ever report `satisfied: true`.

import * as path from 'path';
import { DeclaredEffects, Subsystem, noEffects } from './schema';

export interface MappedOperation {
  subsystem: Subsystem;
  /** Display name for the operation, e.g. `Bash(npm test)`. */
  operation: string;
  effects: DeclaredEffects;
  /**
   * Set when the effects were inferred rather than declared — a shell string read statically, an
   * MCP tool whose schema does not describe its side effects. The guard turns this into an
   * `Observation` with an explicit completeness gap.
   */
  staticReading: string | null;
}

const READ_ONLY_TOOLS = new Set([
  'ReadFileTool', 'GrepTool', 'GlobTool', 'ListDirectoryTool', 'GraphQueryTool', 'GraphContextTool',
  'LspQueryTool', 'RelatedTestsTool', 'ToolSearchTool', 'SkillTool', 'TodoWriteTool', 'AskUserTool',
]);

const WRITE_TOOLS = new Set(['WriteFileTool', 'EditFileTool', 'SymbolEditTool', 'NotebookEditTool']);

const resolve = (candidate: unknown, cwd: string): string | null => {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  const expanded = candidate.startsWith('~/') ? path.join(process.env.HOME || '~', candidate.slice(2)) : candidate;
  return path.resolve(cwd, expanded);
};

/**
 * Path-shaped tokens in a shell command. Deliberately narrow: only tokens that contain a separator
 * or start with `~`, so a bare word like `id_rsa` — which is a *string*, not a path — never becomes
 * a claim that a credential store was touched.
 */
export function pathTokens(command: string, cwd: string): string[] {
  const tokens = command.match(/(?:"[^"]*"|'[^']*'|[^\s;|&<>()]+)/g) ?? [];
  const paths: string[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/^['"]|['"]$/g, '');
    if (!token || token.startsWith('-')) continue;
    if (!token.includes('/') && !token.startsWith('~')) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue; // a URL, handled by hostTokens
    const resolved = resolve(token, cwd);
    if (resolved) paths.push(resolved);
  }
  return [...new Set(paths)];
}

/** Hosts named literally in a command. A host Bimax cannot see is simply not claimed. */
export function hostTokens(command: string): string[] {
  const hosts = new Set<string>();
  for (const match of command.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^/\s'"]+)/gi)) {
    hosts.add(match[1].replace(/:\d+$/, '').toLowerCase());
  }
  return [...hosts];
}

/** The executables a command launches, by the first word of each pipeline segment. */
export function processTokens(command: string): string[] {
  const segments = command.split(/(?:\|\||&&|[;|&])/);
  const processes = new Set<string>();
  for (const segment of segments) {
    const first = segment.trim().split(/\s+/)[0];
    if (!first || first.startsWith('-')) continue;
    // `FOO=bar cmd` — skip the assignment and take the real command.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) continue;
    processes.add(first.replace(/^['"]|['"]$/g, ''));
  }
  return [...processes];
}

const INSTALL_PATTERN =
  /\b(npm|pnpm|yarn|bun)\s+(i|in|install|add|ci)\b|\bpip3?\s+install\b|\bbrew\s+(install|upgrade)\b|\bcargo\s+(install|add)\b|\bgem\s+install\b|\bgo\s+install\b/;

/** Commands that only inspect. Kept small and literal — a guess here would be a false silence. */
const READ_ONLY_COMMAND = /^\s*(cat|less|head|tail|ls|pwd|echo|grep|rg|find|which|type|file|stat|wc|diff|git\s+(status|log|diff|show|branch))\b/;

/**
 * Path- and URL-shaped values in an MCP call's arguments.
 *
 * These come from the model's own tool call, not from the server, so reading them is not the same
 * as trusting server-authored metadata (§17). They are recorded as reads for the same reason a
 * shell command's path tokens are: it is the weaker, truthful claim, and the credential and
 * manifest rules apply to reads as well as writes.
 */
export function mcpArgumentEffects(args: Record<string, unknown>, cwd: string): DeclaredEffects {
  const reads = new Set<string>();
  const hosts = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4) return;
    if (typeof value === 'string') {
      for (const host of hostTokens(value)) hosts.add(host);
      if (value.startsWith('/') || value.startsWith('~/') || value.startsWith('./') || value.startsWith('../')) {
        const resolved = resolve(value, cwd);
        if (resolved) reads.add(resolved);
      }
      return;
    }
    if (Array.isArray(value)) { value.slice(0, 32).forEach(item => walk(item, depth + 1)); return; }
    if (value && typeof value === 'object') {
      for (const nested of Object.values(value as Record<string, unknown>)) walk(nested, depth + 1);
    }
  };
  walk(args, 0);
  return noEffects({ reads: [...reads], hosts: [...hosts] });
}

export function mapToolCall(toolName: string, args: Record<string, unknown>, cwd: string): MappedOperation {
  if (toolName === 'BashTool') {
    const command = String(args.command ?? '');
    const short = command.length > 80 ? `${command.slice(0, 77)}…` : command;
    return {
      subsystem: 'engine-tool',
      operation: `Bash(${short})`,
      effects: noEffects({
        // A static reading cannot tell a read from a write, and claiming "write" would fabricate a
        // mutation that may never happen. Path tokens are recorded as reads: that is the weaker,
        // truthful claim, and the credential/persistence invariants apply to reads as well.
        reads: pathTokens(command, cwd),
        hosts: hostTokens(command),
        processes: processTokens(command),
        installsDependencies: INSTALL_PATTERN.test(command),
        readOnly: READ_ONLY_COMMAND.test(command) && !INSTALL_PATTERN.test(command),
      }),
      staticReading: 'the effects of this shell command were read from its text, not observed',
    };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const target = resolve(args.path ?? args.file_path ?? args.target, cwd);
    return {
      subsystem: 'engine-tool',
      operation: `${toolName}(${target ?? 'unknown'})`,
      effects: noEffects({ writes: target ? [target] : [] }),
      staticReading: target ? null : 'the tool call named no resolvable target path',
    };
  }

  if (toolName === 'MultiEditTool') {
    const edits = Array.isArray(args.edits) ? args.edits : [];
    const writes = [...new Set(edits
      .map(edit => resolve((edit as Record<string, unknown>)?.path, cwd))
      .filter((p): p is string => Boolean(p)))];
    return {
      subsystem: 'engine-tool',
      operation: `MultiEdit(${writes.length} file${writes.length === 1 ? '' : 's'})`,
      effects: noEffects({ writes }),
      staticReading: null,
    };
  }

  if (toolName === 'DeleteTool') {
    const target = resolve(args.path, cwd);
    return {
      subsystem: 'engine-tool',
      operation: `Delete(${target ?? 'unknown'})`,
      effects: noEffects({ deletes: target ? [target] : [] }),
      staticReading: null,
    };
  }

  if (READ_ONLY_TOOLS.has(toolName)) {
    const target = resolve(args.path ?? args.file_path ?? args.dir ?? args.pattern, cwd);
    return {
      subsystem: 'engine-tool',
      operation: `${toolName}(${target ?? ''})`,
      effects: noEffects({ reads: target ? [target] : [], readOnly: true }),
      staticReading: null,
    };
  }

  // `mcp__<server>__<tool>` is how the MCP client names every registered tool (src/mcp/client.ts).
  // Matching it here is what puts real MCP traffic on the causal timeline rather than a placeholder.
  const mcpName = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(toolName);
  if (mcpName || toolName === 'McpTool' || toolName.startsWith('mcp:')) {
    const server = mcpName ? mcpName[1] : String(args.server ?? 'unknown');
    const tool = mcpName ? mcpName[2] : String(args.tool ?? 'unknown');
    return {
      subsystem: 'mcp',
      operation: toolName.startsWith('mcp:') ? toolName : `mcp:${server}/${tool}`,
      // Paths and URLs that appear in the *arguments* are the one thing about an MCP call that is
      // knowable before it runs, and they are exactly what a manifest bounds. Argument values are
      // supplied by the model, not by the server, so reading them is not trusting server metadata.
      effects: mcpArgumentEffects(args, cwd),
      // MCP tool descriptions are untrusted input (§17) and do not declare side effects, so what an
      // MCP call actually did is only knowable from its receipt.
      staticReading: 'an MCP tool does not declare its side effects; only its receipt is evidence',
    };
  }

  if (toolName === 'BrowserTool') {
    const url = typeof args.url === 'string' ? args.url : '';
    const host = hostTokens(url)[0];
    return {
      subsystem: 'browser',
      operation: `Browser(${String(args.action ?? 'navigate')})`,
      effects: noEffects({ hosts: host ? [host] : [], readOnly: true }),
      staticReading: null,
    };
  }

  if (toolName === 'WebFetchTool' || toolName === 'WebSearchTool') {
    const host = hostTokens(String(args.url ?? ''))[0];
    return {
      subsystem: 'browser',
      operation: toolName,
      effects: noEffects({ hosts: host ? [host] : [], readOnly: true }),
      staticReading: null,
    };
  }

  return {
    subsystem: 'engine-tool',
    operation: toolName,
    effects: noEffects(),
    staticReading: `${toolName} does not declare its effects`,
  };
}
