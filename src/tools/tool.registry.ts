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
  'ChangeDirectoryTool', 'AskUserTool', 'GraphContextTool', 'GitTool',
  // SkillTool is itself the progressive-disclosure entry point (the prompt's AVAILABLE SKILLS
  // section tells the model to call it), so it must always be loaded — never deferred.
  'SkillTool',
]);

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
    return this.tools.has(name) && !CORE_TOOLS.has(name) && name !== TOOL_SEARCH_TOOL;
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
    const all = Array.from(this.tools.values());
    if (mode === 'full') {
      return all.filter(t => t.name !== TOOL_SEARCH_TOOL).map(toSchema);
    }
    return all
      .filter(t => CORE_TOOLS.has(t.name) || t.name === TOOL_SEARCH_TOOL || this.discovered.has(t.name))
      .map(toSchema);
  }

  /** Back-compat: the full, unfiltered schema list. */
  public getAllSchemas(): any[] {
    return this.getSchemas({ mode: 'full' });
  }
}
