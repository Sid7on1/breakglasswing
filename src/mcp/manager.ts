import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolRegistry } from '../tools/tool.registry';
import { IGovernor } from '../core/interfaces';
import { Logger } from '../utils/logger';
import { McpServerSpec, loadMcpServers, normalizeArgs, missingPathArgs } from './config';
import { connectAndRegister, ConnectedMcp } from './client';
import { cliEvents } from '../cli/events';

/** Defend every entry point: a model may pass `args` as a JSON string — coerce it to a real array. */
function cleanSpec(spec: McpServerSpec): McpServerSpec {
  return { ...spec, args: normalizeArgs(spec.args) };
}

// Runtime manager for MCP servers: holds the live connections so they can be listed, tested,
// added, and removed at runtime (the boot path, the /mcp command, and the agent's McpManageTool
// all go through here). Config lives in `.bimax/mcp.json`.

export class McpManager {
  private connections: Map<string, ConnectedMcp> = new Map();
  /** The reason the most recent connect attempt failed (for surfacing to the user/agent). */
  public lastError: string | null = null;

  // MCP servers are stored GLOBALLY by default (~/.bimax/mcp.json) so a server added in any
  // directory persists everywhere — just like API keys. Passing an explicit `cwd` targets that
  // project's `.bimax/mcp.json` instead (used by tests and project-local team configs).
  private configRoot(cwd?: string): string {
    return cwd ?? os.homedir();
  }

  private configPath(cwd?: string): string {
    return path.join(this.configRoot(cwd), '.bimax', 'mcp.json');
  }

  /** Connect one server and retain the connection. Returns the live connection or null. */
  public async connectSpec(
    spec: McpServerSpec,
    registry: ToolRegistry,
    governor: IGovernor,
  ): Promise<ConnectedMcp | null> {
    this.lastError = null;
    const conn = await connectAndRegister(cleanSpec(spec), registry, governor, (msg) => { this.lastError = msg; });
    if (conn) this.connections.set(conn.name, conn);
    return conn;
  }

  /**
   * Connect every configured server. Merges the GLOBAL store (~/.bimax/mcp.json) with the
   * project-local one (<projectRoot>/.bimax/mcp.json) — project entries override globals of the
   * same name. Best-effort. Used at boot.
   */
  public async connectAll(registry: ToolRegistry, governor: IGovernor, projectRoot?: string): Promise<number> {
    const byName = new Map<string, McpServerSpec>();
    for (const s of loadMcpServers(os.homedir())) byName.set(s.name, s);
    if (projectRoot && projectRoot !== os.homedir()) {
      for (const s of loadMcpServers(projectRoot)) byName.set(s.name, s);
    }
    let n = 0;
    for (const spec of byName.values()) {
      // Skip servers the user turned off — they stay in config until re-enabled.
      if (spec.disabled) {
        Logger.info(`[MCP] Skipping disabled server '${spec.name}'.`);
        continue;
      }
      // Skip servers whose path args don't exist — they would just fail and slow the others.
      const missing = missingPathArgs(normalizeArgs(spec.args));
      if (missing.length) {
        Logger.warn(`[MCP] Skipping '${spec.name}': path(s) do not exist: ${missing.join(', ')}`);
        cliEvents.emit('status', `MCP '${spec.name}' skipped — missing path(s): ${missing.join(', ')}`);
        continue;
      }
      const c = await this.connectSpec(spec, registry, governor);
      if (c) {
        n++;
        cliEvents.emit('status', `MCP '${spec.name}' connected — ${c.toolNames.length} tool(s)`);
      } else if (this.lastError) {
        cliEvents.emit('status', `MCP '${spec.name}' failed: ${this.lastError}`);
      }
    }
    if (n > 0) cliEvents.emit('mcp_changed');
    return n;
  }

  /** Enable or disable a server in config. Disconnects it live when disabling. */
  public async setEnabled(name: string, enabled: boolean, registry?: ToolRegistry, cwd?: string): Promise<boolean> {
    const root = this.configRoot(cwd);
    const specs = loadMcpServers(root);
    const spec = specs.find(s => s.name === name);
    if (!spec) return false;
    spec.disabled = !enabled;
    const file = this.configPath(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ servers: specs }, null, 2), 'utf8');
    if (!enabled) await this.disconnect(name, registry);
    return true;
  }

  /** Is a configured server currently turned off? */
  public isDisabled(name: string, cwd?: string): boolean {
    return !!loadMcpServers(this.configRoot(cwd)).find(s => s.name === name)?.disabled;
  }

  public list(): ConnectedMcp[] {
    return Array.from(this.connections.values());
  }

  public get(name: string): ConnectedMcp | undefined {
    return this.connections.get(name);
  }

  /** Live tool names contributed by all connected servers. */
  public toolNames(): string[] {
    return this.list().flatMap(c => c.toolNames);
  }

  /** Disconnect a server, drop its tools from the registry, and forget the connection. */
  public async disconnect(name: string, registry?: ToolRegistry): Promise<boolean> {
    const conn = this.connections.get(name);
    if (!conn) return false;
    try { await conn.client?.close?.(); } catch { /* best-effort */ }
    if (registry) for (const t of conn.toolNames) registry.unregister(t);
    this.connections.delete(name);
    return true;
  }

  /** Persist a server into `.bimax/mcp.json` (normalized `{ servers: [...] }` shape). Global by default. */
  public addToConfig(spec: McpServerSpec, cwd?: string): void {
    const file = this.configPath(cwd);
    const specs = loadMcpServers(this.configRoot(cwd)).filter(s => s.name !== spec.name);
    specs.push(cleanSpec(spec));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ servers: specs }, null, 2), 'utf8');
    Logger.info(`[McpManager] Saved server '${spec.name}' to ${file}`);
  }

  /** Remove a server from `.bimax/mcp.json`. Returns true if it was present. Global by default. */
  public removeFromConfig(name: string, cwd?: string): boolean {
    const file = this.configPath(cwd);
    const specs = loadMcpServers(this.configRoot(cwd));
    const next = specs.filter(s => s.name !== name);
    if (next.length === specs.length) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ servers: next }, null, 2), 'utf8');
    return true;
  }

  /** Names of servers declared in config (whether or not currently connected). Global by default. */
  public configuredNames(cwd?: string): string[] {
    return loadMcpServers(this.configRoot(cwd)).map(s => s.name);
  }
}

export const globalMcpManager = new McpManager();
