import { buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { ToolRegistry } from '../tool.registry';

/**
 * ToolSearchTool — bimax's deferred-tool loader (smart context mode).
 *
 * In smart mode only the core working-set of tools is sent to the model each turn; rarer/heavier
 * tools and every MCP tool are *deferred* — announced by name but not given full schemas. When a
 * task needs one, the model calls ToolSearchTool with a name or keyword; this resolves the matching
 * deferred tools, marks them discovered in the registry (so their real schemas are sent on the next
 * turn and become callable), and returns their definitions as text so the model sees the parameters.
 *
 * This tool is itself never deferred, and in 'full' context mode it is simply not sent.
 */
export function createToolSearchTool(governor: IGovernor, registry: ToolRegistry): BuiltTool {
  return buildTool({
    name: 'ToolSearchTool',
    description: `Load the full definition of a DEFERRED tool so you can call it.

Some tools are not sent to you up front to keep the context small — they appear by NAME only in the "LOAD-ON-DEMAND TOOLS" list (and all MCP tools are deferred). You cannot call a deferred tool until you load it here first.

Query forms:
- "select:GraphQueryTool,WebFetchTool" — load these exact tools by name.
- "search the web" / "mcp filesystem" — keyword search; the best-matching deferred tools are loaded.

After you call this, the matched tools' schemas are returned to you AND become available to call directly on your next step. Only load a deferred tool when a task actually needs it.`,
    isDestructive: false,
    isConcurrencySafe: true,
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Tool name(s) via "select:Name1,Name2", or keywords describing the capability you need.' },
      },
      required: ['query'],
    },
    execute: async (args: { query: string }) => {
      const matched = registry.searchDeferred(args.query || '');
      if (matched.length === 0) {
        const available = registry.deferredSummary();
        if (available.length === 0) {
          return `No deferred tools matched "${args.query}", and none are currently deferred — the tools you already have are everything available.`;
        }
        return `No deferred tools matched "${args.query}". Deferred tools you can load:\n` +
          available.map(t => `- ${t.name}: ${t.summary}`).join('\n');
      }
      const block = matched
        .map(s => `<function>${JSON.stringify({ name: s.name, description: s.description, input_schema: s.input_schema })}</function>`)
        .join('\n');
      return `Loaded ${matched.length} tool(s) — now callable directly:\n<functions>\n${block}\n</functions>`;
    },
  }, governor);
}
