import { ToolRegistry } from '../tools/tool.registry';
import { buildTool } from '../tools/tool.factory';
import { IGovernor } from '../core/interfaces';
import { Logger } from '../utils/logger';
import { McpServerSpec } from './config';

// The MCP SDK ships package "exports" maps that our classic TS moduleResolution can't follow
// for types; the dual-published CJS build resolves fine at runtime, so we require() it at the
// boundary and keep the SDK objects loosely typed inside this module only.
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

export interface ConnectedMcp {
  name: string;
  client: any;
  toolNames: string[];
}

/** Flatten an MCP tool result's content array into a plain string for the agent. */
function contentToString(result: any): string {
  if (!result) return '';
  const content = result.content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (c?.type === 'text' ? c.text : c?.type ? `[${c.type} content]` : ''))
      .filter(Boolean)
      .join('\n');
  }
  return typeof result === 'string' ? result : JSON.stringify(result);
}

/**
 * Connect to one MCP server (stdio) and register each of its tools into the registry as a
 * native-looking `mcp__<server>__<tool>` tool, governed like any other. Returns the
 * connection (for later close), or null if the server failed to start — never throws, so a
 * bad server never blocks boot.
 */
export async function connectAndRegister(
  spec: McpServerSpec,
  registry: ToolRegistry,
  governor: IGovernor
): Promise<ConnectedMcp | null> {
  try {
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args || [],
      env: { ...process.env, ...(spec.env || {}) },
    });
    const client = new Client({ name: 'bimax', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    const listed = await client.listTools();
    const toolNames: string[] = [];
    for (const t of listed?.tools || []) {
      const toolName = `mcp__${spec.name}__${t.name}`;
      registry.register(buildTool({
        name: toolName,
        description: `[MCP:${spec.name}] ${t.description || t.name}`,
        schema: t.inputSchema || { type: 'object', properties: {} },
        isDestructive: true, // external tools are fail-closed under the Governor
        execute: async (args: any) => {
          const res = await client.callTool({ name: t.name, arguments: args || {} });
          const text = contentToString(res);
          return res?.isError ? `MCP tool ${t.name} reported an error: ${text}` : text;
        },
      }, governor));
      toolNames.push(toolName);
    }

    Logger.info(`[MCP] Connected '${spec.name}' — registered ${toolNames.length} tool(s).`);
    return { name: spec.name, client, toolNames };
  } catch (e: any) {
    Logger.warn(`[MCP] Failed to connect '${spec.name}': ${e.message}`);
    return null;
  }
}

/** Connect every configured server and register its tools. Returns the live connections. */
export async function registerMcpTools(
  specs: McpServerSpec[],
  registry: ToolRegistry,
  governor: IGovernor
): Promise<ConnectedMcp[]> {
  const connected: ConnectedMcp[] = [];
  for (const spec of specs) {
    const c = await connectAndRegister(spec, registry, governor);
    if (c) connected.push(c);
  }
  return connected;
}
