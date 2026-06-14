import * as path from 'path';
import { GraphStore } from '../graph/graph.store';
import { createGraphQueryTool, createGraphContextTool } from '../tools/implementations/graph.tool';
import { IGovernor } from '../core/interfaces';

// A4 — expose BiMax's code graph as an MCP server, so OTHER agents (Claude Code, etc.) can
// query our graph: search symbols, read a single symbol's source, assemble a context pack,
// and compute blast radius. Reuses the exact GraphQueryTool/GraphContextTool execute logic
// (no duplicated graph code); a no-op governor since these are read-only.
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const NOOP_GOVERNOR: IGovernor = { approveTaskExecution: async () => {} } as any;

interface GraphMcpTool {
  name: string;
  description: string;
  schema: any;
  engine: 'query' | 'context';
  toQuery: (args: any) => string;
}

const SYMBOL_ARG = { type: 'object', properties: { symbol: { type: 'string', description: 'Node id or keyword.' } }, required: ['symbol'] };

const GRAPH_TOOLS: GraphMcpTool[] = [
  { name: 'search_nodes', description: 'Search the BiMax code graph for symbols by keyword (matches name, purpose, path).',
    schema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] },
    engine: 'query', toQuery: a => `SEARCH_NODES ${a.keyword}` },
  { name: 'read_symbol', description: "Read just one symbol's source (its exact line range), instead of a whole file.",
    schema: SYMBOL_ARG, engine: 'query', toQuery: a => `READ_SYMBOL ${a.symbol}` },
  { name: 'plan_context', description: 'Assemble a minimal context pack: the target symbol body + its callers/callees signatures.',
    schema: SYMBOL_ARG, engine: 'context', toQuery: a => `PLAN_CONTEXT ${a.symbol}` },
  { name: 'blast_radius', description: 'Downstream impact (dependents + criticality) of changing a symbol.',
    schema: SYMBOL_ARG, engine: 'query', toQuery: a => `BLAST_RADIUS ${a.symbol}` },
];

/** Build (but do not connect) an MCP server exposing the graph verbs against `store`. */
export function createGraphMcpServer(store: GraphStore, cwd: string = process.cwd()): any {
  const query = createGraphQueryTool(NOOP_GOVERNOR, store);
  const context = createGraphContextTool(NOOP_GOVERNOR, store);

  const server = new Server({ name: 'bimax-graph', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: GRAPH_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.schema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    const def = GRAPH_TOOLS.find(t => t.name === req.params.name);
    if (!def) return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    const runner = def.engine === 'context' ? context : query;
    const text = await runner.execute({ query: def.toQuery(req.params.arguments || {}) }, { cwd });
    return { content: [{ type: 'text', text: String(text) }] };
  });

  return server;
}

/** Load the project graph and serve it over stdio (used by `bimax mcp`). */
export async function runGraphMcpStdioServer(cwd: string = process.cwd()): Promise<void> {
  // stdout is the JSON-RPC channel — redirect stray logging to stderr so it can't corrupt it.
  console.log = console.error.bind(console);
  const store = new GraphStore(path.join(cwd, '.breakglass/graph', 'playground.json'));
  await store.loadFromDisk();
  const server = createGraphMcpServer(store, cwd);
  await server.connect(new StdioServerTransport());
  // The stdio transport keeps the process alive until the client disconnects.
}
