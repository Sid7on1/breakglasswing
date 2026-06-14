import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StaticAnalyzer } from '../graph/static.analyzer';
import { GraphStore } from '../graph/graph.store';
import { createGraphMcpServer } from '../mcp/server';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

// A4 — BiMax's graph exposed as an MCP server. Index a fixture, serve it, and drive it as an
// MCP client over an in-memory transport (no subprocess).
describe('Graph MCP server (A4)', () => {
  let proj: string;
  let store: GraphStore;
  let client: any;

  beforeEach(async () => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-mcpsrv-'));
    fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2020', module: 'CommonJS', strict: false }, include: ['*.ts'],
    }));
    fs.writeFileSync(path.join(proj, 'sample.ts'), [
      'export function helper(n: number): number { return n + 1; }',
      'export function greet(name: string): string {',
      '  return `hi ${name}`;',
      '}',
    ].join('\n'));
    store = new GraphStore(':memory:');
    new StaticAnalyzer(proj, store).analyzeProject();

    const server = createGraphMcpServer(store, proj);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('advertises the graph tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search_nodes', 'read_symbol', 'plan_context', 'blast_radius']));
  });

  it('read_symbol returns just that symbol over MCP', async () => {
    const res = await client.callTool({ name: 'read_symbol', arguments: { symbol: 'func:sample.ts:greet' } });
    const text = res.content.map((c: any) => c.text).join('\n');
    expect(text).toContain('return `hi ${name}`;');
    expect(text).not.toContain('helper');
  });

  it('search_nodes finds a symbol by keyword over MCP', async () => {
    const res = await client.callTool({ name: 'search_nodes', arguments: { keyword: 'greet' } });
    const text = res.content.map((c: any) => c.text).join('\n');
    expect(text).toContain('greet');
  });
});
