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
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

/** Reject if a promise doesn't settle within `ms` — so a hung server never blocks boot/add. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Open a transport+client for a spec. Local (stdio) specs launch a command; remote specs
 * connect to a URL — trying Streamable HTTP first, then falling back to SSE (older hosted
 * servers only speak SSE). Returns a connected client or throws.
 */
async function openClient(spec: McpServerSpec): Promise<any> {
  const client = new Client({ name: 'bimax', version: '1.0.0' }, { capabilities: {} });

  if (spec.url) {
    const url = new URL(spec.url);
    const headers = spec.headers || undefined;
    const reqInit = headers ? { requestInit: { headers } } : undefined;
    // Honor an explicit transport choice; otherwise prefer HTTP and fall back to SSE.
    if (spec.type === 'sse') {
      await withTimeout(client.connect(new SSEClientTransport(url, reqInit)), 30000, `MCP '${spec.name}' (SSE)`);
      return client;
    }
    try {
      await withTimeout(client.connect(new StreamableHTTPClientTransport(url, reqInit)), 30000, `MCP '${spec.name}' (HTTP)`);
      return client;
    } catch (httpErr: any) {
      Logger.warn(`[MCP] '${spec.name}' HTTP transport failed (${httpErr.message}); trying SSE.`);
      const sseClient = new Client({ name: 'bimax', version: '1.0.0' }, { capabilities: {} });
      await withTimeout(sseClient.connect(new SSEClientTransport(url, reqInit)), 30000, `MCP '${spec.name}' (SSE)`);
      return sseClient;
    }
  }

  // `stderr: 'pipe'` is critical: the SDK default is 'inherit', which dumps the child server's
  // stderr straight into our Ink TUI (corrupting the display). Piping keeps it off the terminal,
  // and we drain it into the logger — and into the failure reason when a server exits on startup.
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args || [],
    env: { ...process.env, ...(spec.env || {}) },
    stderr: 'pipe',
  });

  const stderrChunks: string[] = [];
  const drainStderr = () => {
    try {
      const s: any = (transport as any).stderr;
      if (s && typeof s.on === 'function') {
        s.on('data', (d: Buffer) => {
          const text = d.toString();
          stderrChunks.push(text);
          Logger.warn(`[MCP:${spec.name}] ${text.trim()}`);
        });
      }
    } catch { /* best-effort */ }
  };

  try {
    await withTimeout(client.connect(transport), 30000, `MCP '${spec.name}' (stdio)`);
    drainStderr(); // keep future stderr out of the terminal and in the log
    return client;
  } catch (e: any) {
    drainStderr();
    await new Promise(r => setTimeout(r, 50)); // let buffered stderr flush
    const detail = stderrChunks.join('').trim();
    if (detail) {
      const lastLines = detail.split('\n').filter(Boolean).slice(-3).join(' ');
      throw new Error(`${e?.message || e} — server said: ${lastLines}`);
    }
    throw e;
  }
}

/**
 * Coerce a single value to the type its JSON Schema declares. Only converts the safe, common cases
 * a weak model gets wrong — string→number/integer and string→boolean — and recurses into arrays and
 * nested objects. Anything that doesn't cleanly convert is left untouched so we never corrupt input.
 */
function coerceValueToSchema(value: any, schema: any): any {
  if (!schema || value == null) return value;
  // JSON Schema `type` may be a string or an array of allowed types; normalize to a set.
  const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

  if ((types.includes('number') || types.includes('integer')) && typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '' && !isNaN(Number(trimmed))) {
      const n = Number(trimmed);
      return types.includes('integer') && !types.includes('number') ? Math.trunc(n) : n;
    }
  }
  if (types.includes('boolean') && typeof value === 'string') {
    const l = value.trim().toLowerCase();
    if (l === 'true') return true;
    if (l === 'false') return false;
  }
  if (types.includes('array') && Array.isArray(value) && schema.items) {
    return value.map((v) => coerceValueToSchema(v, schema.items));
  }
  if (types.includes('object') && value && typeof value === 'object' && schema.properties) {
    return coerceArgsToSchema(value, schema);
  }
  return value;
}

/** Coerce each property of an args object to the types its tool input schema declares. */
export function coerceArgsToSchema(args: any, schema: any): any {
  if (!schema || !schema.properties || !args || typeof args !== 'object' || Array.isArray(args)) return args;
  const out: any = { ...args };
  for (const [key, propSchema] of Object.entries<any>(schema.properties)) {
    if (key in out) out[key] = coerceValueToSchema(out[key], propSchema);
  }
  return out;
}

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
  governor: IGovernor,
  onError?: (message: string) => void,
): Promise<ConnectedMcp | null> {
  try {
    const client = await openClient(spec);

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
          // Weak models routinely emit numbers/booleans as strings ("1", "true"). MCP servers
          // validate strictly (zod) and reject those, so coerce each arg to its declared schema
          // type first. Native tools tolerate strings already; MCP is where strict validation bites.
          const coerced = coerceArgsToSchema(args || {}, t.inputSchema);
          const res = await client.callTool({ name: t.name, arguments: coerced });
          const text = contentToString(res);
          return res?.isError ? `MCP tool ${t.name} reported an error: ${text}` : text;
        },
      }, governor));
      toolNames.push(toolName);
    }

    Logger.info(`[MCP] Connected '${spec.name}' — registered ${toolNames.length} tool(s).`);
    return { name: spec.name, client, toolNames };
  } catch (e: any) {
    const msg = e?.message || String(e);
    Logger.warn(`[MCP] Failed to connect '${spec.name}': ${msg}`);
    onError?.(msg);
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
