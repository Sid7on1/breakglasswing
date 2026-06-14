import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpManager } from '../mcp/manager';
import { loadMcpServers, normalizeArgs, missingPathArgs } from '../mcp/config';
import { ToolRegistry } from '../tools/tool.registry';
import { IGovernor } from '../core/interfaces';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;
const FIXTURE = path.join(__dirname, 'fixtures', 'mcp-echo-server.js');

describe('McpManager config persistence', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-mcpmgr-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('missingPathArgs flags non-existent path args but ignores flags/packages and real paths', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-real-'));
    try {
      const args = ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/folder/one', real];
      expect(missingPathArgs(args)).toEqual(['/path/to/allowed/folder/one']);
      // Flags and package names are never treated as paths.
      expect(missingPathArgs(['-y', '@scope/pkg'])).toEqual([]);
    } finally {
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  it('setEnabled toggles the disabled flag in config and isDisabled reflects it', async () => {
    const mgr = new McpManager();
    mgr.addToConfig({ name: 'seq', command: 'node', args: [FIXTURE] }, dir);
    expect(mgr.isDisabled('seq', dir)).toBe(false);

    expect(await mgr.setEnabled('seq', false, undefined, dir)).toBe(true);
    expect(mgr.isDisabled('seq', dir)).toBe(true);
    expect(loadMcpServers(dir)[0].disabled).toBe(true);

    expect(await mgr.setEnabled('seq', true, undefined, dir)).toBe(true);
    expect(mgr.isDisabled('seq', dir)).toBe(false);

    expect(await mgr.setEnabled('nope', false, undefined, dir)).toBe(false);
  });

  it('addToConfig then removeFromConfig round-trips .bimax/mcp.json', () => {
    const mgr = new McpManager();
    mgr.addToConfig({ name: 'echo', command: 'node', args: [FIXTURE] }, dir);
    expect(loadMcpServers(dir)).toEqual([{ name: 'echo', command: 'node', args: [FIXTURE], env: undefined }]);
    expect(mgr.configuredNames(dir)).toContain('echo');

    expect(mgr.removeFromConfig('echo', dir)).toBe(true);
    expect(loadMcpServers(dir)).toEqual([]);
    expect(mgr.removeFromConfig('echo', dir)).toBe(false); // already gone
  });

  it('persists and loads a remote URL server (no command)', () => {
    const mgr = new McpManager();
    mgr.addToConfig({ name: 'magic', url: 'https://link.mcpmarket.com/x/mcp' }, dir);
    expect(loadMcpServers(dir)).toEqual([{ name: 'magic', url: 'https://link.mcpmarket.com/x/mcp' }]);
    expect(mgr.configuredNames(dir)).toContain('magic');
  });

  it('loads Claude-style { mcpServers: { name: { url } } } remote shape', () => {
    fs.mkdirSync(path.join(dir, '.bimax'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.bimax', 'mcp.json'),
      JSON.stringify({ mcpServers: { magic: { url: 'https://example.com/mcp', type: 'sse' } } }),
    );
    const specs = loadMcpServers(dir);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ name: 'magic', url: 'https://example.com/mcp', type: 'sse' });
  });

  it('coerces a JSON-string args field back into an array (corrupt-config tolerance)', () => {
    fs.mkdirSync(path.join(dir, '.bimax'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.bimax', 'mcp.json'),
      JSON.stringify({ servers: [{ name: 'gh', command: 'npx', args: '["-y", "@modelcontextprotocol/server-github"]' }] }),
    );
    const specs = loadMcpServers(dir);
    expect(specs[0].args).toEqual(['-y', '@modelcontextprotocol/server-github']);
  });

  it('coerces a single-quoted (Python/JS-literal) args string into an array', () => {
    expect(normalizeArgs("['-y', '@modelcontextprotocol/server-sequential-thinking']"))
      .toEqual(['-y', '@modelcontextprotocol/server-sequential-thinking']);
    expect(normalizeArgs('-y some-package')).toEqual(['-y', 'some-package']);
    expect(normalizeArgs(['-y', 'pkg'])).toEqual(['-y', 'pkg']);
    expect(normalizeArgs(undefined)).toBeUndefined();
  });

  it('drops a spec that has neither command nor url', () => {
    fs.mkdirSync(path.join(dir, '.bimax'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.bimax', 'mcp.json'), JSON.stringify({ servers: [{ name: 'broken' }] }));
    expect(loadMcpServers(dir)).toEqual([]);
  });

  it('addToConfig stores a clean array even when given a JSON-string args (model mistake)', () => {
    const mgr = new McpManager();
    mgr.addToConfig({ name: 'seq', command: 'npx', args: '["-y", "@modelcontextprotocol/server-sequential-thinking"]' as any }, dir);
    expect(loadMcpServers(dir)[0].args).toEqual(['-y', '@modelcontextprotocol/server-sequential-thinking']);
  });

  it('addToConfig replaces an existing server of the same name (no duplicates)', () => {
    const mgr = new McpManager();
    mgr.addToConfig({ name: 'echo', command: 'node', args: ['a.js'] }, dir);
    mgr.addToConfig({ name: 'echo', command: 'node', args: ['b.js'] }, dir);
    const specs = loadMcpServers(dir);
    expect(specs).toHaveLength(1);
    expect(specs[0].args).toEqual(['b.js']);
  });
});

describe('McpManager runtime connection', () => {
  it('connects a stdio server, retains it, then disconnects + unregisters its tools', async () => {
    const mgr = new McpManager();
    const registry = new ToolRegistry();
    const conn = await mgr.connectSpec({ name: 'echo', command: 'node', args: [FIXTURE] }, registry, governor);

    expect(conn).not.toBeNull();
    expect(mgr.list().map(c => c.name)).toContain('echo');
    expect(registry.getTool('mcp__echo__echo')).toBeDefined();
    expect(mgr.toolNames()).toContain('mcp__echo__echo');

    await mgr.disconnect('echo', registry);
    expect(mgr.get('echo')).toBeUndefined();
    expect(registry.getTool('mcp__echo__echo')).toBeUndefined();
  }, 20000);
});
