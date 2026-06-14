import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadMcpServers } from '../mcp/config';
import { registerMcpTools } from '../mcp/client';
import { ToolRegistry } from '../tools/tool.registry';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;
const FIXTURE = path.join(__dirname, 'fixtures', 'mcp-echo-server.js');

describe('loadMcpServers (A3, config)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-mcp-')); fs.mkdirSync(path.join(dir, '.bimax')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads the { servers: [...] } shape', () => {
    fs.writeFileSync(path.join(dir, '.bimax', 'mcp.json'), JSON.stringify({ servers: [{ name: 'echo', command: 'node', args: [FIXTURE] }] }));
    expect(loadMcpServers(dir)).toEqual([{ name: 'echo', command: 'node', args: [FIXTURE] }]);
  });

  it('reads the Claude-style { mcpServers: {...} } shape', () => {
    fs.writeFileSync(path.join(dir, '.bimax', 'mcp.json'), JSON.stringify({ mcpServers: { echo: { command: 'node', args: [FIXTURE] } } }));
    expect(loadMcpServers(dir)).toEqual([{ name: 'echo', command: 'node', args: [FIXTURE], env: undefined }]);
  });

  it('absent config returns []', () => {
    expect(loadMcpServers(dir)).toEqual([]);
  });
});

describe('registerMcpTools (A3, integration)', () => {
  it('connects to a stdio MCP server, registers its tool, and calls it', async () => {
    const registry = new ToolRegistry();
    const connected = await registerMcpTools(
      [{ name: 'echo', command: 'node', args: [FIXTURE] }],
      registry,
      governor
    );

    expect(connected).toHaveLength(1);
    expect(connected[0].toolNames).toContain('mcp__echo__echo');

    const tool = registry.getTool('mcp__echo__echo');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ text: 'hello' }, {});
    expect(result).toBe('echo: hello');

    // Clean up the spawned subprocess.
    await connected[0].client.close();
  }, 20000);

  it('skips a server that fails to start without throwing', async () => {
    const registry = new ToolRegistry();
    const connected = await registerMcpTools(
      [{ name: 'broken', command: 'node', args: ['/no/such/file.js'] }],
      registry,
      governor
    );
    expect(connected).toHaveLength(0);
  }, 20000);
});
