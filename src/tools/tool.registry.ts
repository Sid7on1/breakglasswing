import { BuiltTool } from './tool.factory';
import { Logger } from '../utils/logger';

export type ContextMode = 'smart' | 'full';

/**
 * The core working set — tool schemas that are ALWAYS sent to the model, even in smart mode.
 * Everything else registered (rare/heavy native tools and every MCP tool) is *deferred*: announced
 * by name only and loaded on demand when the model calls ToolSearchTool. This is bimax's analogue
 * of Claude Code's "Tool Search / deferred tools" mechanism — it keeps the per-turn tool payload
 * small without taking any capability away (a deferred tool still runs once discovered, and the
 * text-tool-call recovery path can still invoke it directly as a safety net).
 */
const CORE_TOOLS = new Set<string>([
  'ReadFileTool', 'WriteFileTool', 'EditFileTool', 'MultiEditTool', 'DeleteTool',
  'CreateDirectoryTool', 'BashTool', 'GrepTool', 'GlobTool', 'TodoWriteTool',
  'ChangeDirectoryTool', 'AskUserTool', 'GitTool',
  // Web lookup is a common, lightweight capability the model reaches for constantly (current facts,
  // docs, errors). Deferring it behind ToolSearch made the model flail — call ToolSearch, then guess
  // at a fetch with no URL — instead of just searching. Keep them in the working set (like Claude Code).
  'WebSearchTool', 'WebFetchTool',
  // SkillTool is itself the progressive-disclosure entry point (the prompt's AVAILABLE SKILLS
  // section tells the model to call it), so it must always be loaded — never deferred.
  'SkillTool',
]);

/**
 * Index-gated tools: they only work against a built dependency graph, so we DISABLE them (don't send
 * their schemas, don't let ToolSearch surface them) until the repo is indexed — otherwise the model
 * wastes a turn calling a tool that just answers "the graph is empty." Once the graph has nodes they
 * are PROMOTED: always sent in both modes (so the model reaches for them first), and the prompt steers
 * it to prefer them over reading whole files, since they return exactly the relevant code far cheaper.
 */
const INDEX_GATED_TOOLS = new Set<string>(['GraphQueryTool', 'GraphContextTool']);

const TOOL_SEARCH_TOOL = 'ToolSearchTool';

function toSchema(t: BuiltTool) {
  return { name: t.name, description: t.description, input_schema: t.schema };
}

export class ToolRegistry {
  private tools: Map<string, BuiltTool> = new Map();
  /**
   * Deferred tools the model has surfaced via ToolSearchTool this session. Once discovered, a tool's
   * full schema is sent on every subsequent turn (mirrors Claude Code's `tool_reference` tracking),
   * so the model never has to re-search for it.
   */
  private discovered: Set<string> = new Set();

  /**
   * Live "is the repo indexed?" check. Wired by the container to the graph store (lazy so it always
   * reflects the current graph, including a graph built mid-session). Defaults to "not indexed" so
   * index-gated tools stay disabled until something proves the graph exists.
   */
  private graphReadyFn: () => boolean = () => false;
  public setGraphReadyCheck(fn: () => boolean): void { this.graphReadyFn = fn; }
  public isGraphReady(): boolean {
    try { return !!this.graphReadyFn(); } catch { return false; }
  }

  /** A tool that requires the dependency graph (gated until indexed, then promoted + preferred). */
  public isIndexGated(name: string): boolean { return INDEX_GATED_TOOLS.has(name); }

  public register(tool: BuiltTool) {
    if (this.tools.has(tool.name)) {
      Logger.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    Logger.info(`[ToolRegistry] Registered tool: ${tool.name} (Destructive: ${tool.isDestructive})`);
  }

  public getTool(name: string): BuiltTool | undefined {
    return this.tools.get(name);
  }

  /** Remove a tool (e.g. when an MCP server is disconnected). No-op if absent. */
  public unregister(name: string): boolean {
    this.discovered.delete(name);
    return this.tools.delete(name);
  }

  /** All registered tool names — used to advertise dynamic (MCP) tools in the prompt. */
  public getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Is this tool deferred in smart mode? Deferred = registered, not part of the core working set,
   * and not ToolSearch itself. All MCP tools (`mcp__*`) fall through to deferred automatically since
   * they are never in CORE_TOOLS.
   */
  public isDeferred(name: string): boolean {
    // Index-gated tools are never "deferred" (load-on-demand): they're either fully sent (indexed) or
    // fully hidden (not indexed), never advertised in the LOAD-ON-DEMAND list.
    return this.tools.has(name) && !CORE_TOOLS.has(name) && name !== TOOL_SEARCH_TOOL && !INDEX_GATED_TOOLS.has(name);
  }

  /**
   * Whether a tool's full schema is sent to the model this turn — the single source of truth shared by
   * getSchemas (what goes on the wire) and the persona prompt (what it lists), so they never drift.
   */
  public isSent(name: string, mode: ContextMode): boolean {
    // Gated tools ride entirely on index readiness, in BOTH modes.
    if (INDEX_GATED_TOOLS.has(name)) return this.isGraphReady();
    if (mode === 'full') return name !== TOOL_SEARCH_TOOL;
    // smart: the core working set + ToolSearch + anything already discovered this session.
    return CORE_TOOLS.has(name) || name === TOOL_SEARCH_TOOL || this.discovered.has(name);
  }

  /** Mark deferred tools as surfaced so their schemas are sent on subsequent turns. */
  public markDiscovered(names: string[]): void {
    for (const n of names) if (this.tools.has(n)) this.discovered.add(n);
  }

  public isDiscovered(name: string): boolean {
    return this.discovered.has(name);
  }

  /**
   * Deferred tools not yet discovered — `{ name, summary }` for the "load on demand" prompt section
   * and for ToolSearch's "nothing matched" hint.
   */
  public deferredSummary(): { name: string; summary: string }[] {
    return Array.from(this.tools.values())
      .filter(t => this.isDeferred(t.name) && !this.discovered.has(t.name))
      .map(t => ({ name: t.name, summary: (t.description || '').split('\n')[0] }));
  }

  /**
   * Search across tools that are already callable (core set + already-discovered deferred tools).
   * Used by ToolSearchTool to detect when the model is looping — asking for a tool it already has.
   * Returns matching tool names (not schemas — the model already has them).
   */
  public findCallable(query: string, max = 5): string[] {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    if (q.startsWith('select:')) {
      const wanted = new Set(q.slice('select:'.length).split(',').map(s => s.trim()).filter(Boolean));
      return Array.from(this.tools.keys()).filter(name =>
        wanted.has(name) && (CORE_TOOLS.has(name) || this.discovered.has(name) || name === TOOL_SEARCH_TOOL)
      ).slice(0, max);
    }
    const terms = q.split(/[\s,+]+/).filter(Boolean);
    return Array.from(this.tools.values())
      .filter(t => CORE_TOOLS.has(t.name) || this.discovered.has(t.name))
      .filter(t => {
        const hay = `${t.name} ${t.description}`.toLowerCase();
        return terms.some(term => hay.includes(term));
      })
      .slice(0, max)
      .map(t => t.name);
  }

  /**
   * Resolve a ToolSearch query to deferred tools and mark them discovered. Supports
   * `select:Name1,Name2` for exact lookup, otherwise keyword-ranks across names + descriptions.
   * Returns the matched tools' schemas (also surfaced as text by ToolSearchTool).
   */
  public searchDeferred(query: string, max = 8): any[] {
    const q = (query || '').trim();
    const deferred = Array.from(this.tools.values()).filter(t => this.isDeferred(t.name));

    let matched: BuiltTool[];
    if (q.toLowerCase().startsWith('select:')) {
      const wanted = new Set(q.slice('select:'.length).split(',').map(s => s.trim()).filter(Boolean));
      matched = deferred.filter(t => wanted.has(t.name));
    } else {
      const terms = q.toLowerCase().split(/[\s,+]+/).filter(Boolean);
      const score = (t: BuiltTool) => {
        const hay = `${t.name} ${t.description}`.toLowerCase();
        return terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
      };
      matched = terms.length
        ? deferred.map(t => ({ t, s: score(t) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.t)
        : deferred;
    }

    matched = matched.slice(0, max);
    this.markDiscovered(matched.map(t => t.name));
    return matched.map(toSchema);
  }

  /**
   * The tool schemas to send to the model this turn.
   *   - 'full'  → every registered tool (minus ToolSearch, which is pointless without deferral).
   *   - 'smart' → core working set + ToolSearch + any deferred tools already discovered this session.
   */
  public getSchemas(opts?: { mode?: ContextMode }): any[] {
    const mode = opts?.mode ?? 'full';
    return Array.from(this.tools.values())
      .filter(t => this.isSent(t.name, mode))
      .map(toSchema);
  }

  /** Back-compat: the full, unfiltered schema list. */
  public getAllSchemas(): any[] {
    return this.getSchemas({ mode: 'full' });
  }
}
