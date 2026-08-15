/**
 * The Desktop macOS capability provider's identity, shared by everything that has to agree on it.
 *
 * The engine's MCP client registers every provider tool under `mcp__<server>__<tool>`
 * (`src/mcp/client.ts`), so the names that actually appear in production `tool_call` events are
 * `mcp__bimax-mac__mac_control` and `mcp__bimax-mac__Bimax…Tool` — NOT the bare names the provider
 * declares over stdio. A renderer that recognised only the bare names would never light up the Mac
 * lane on a real run, which is exactly the defect this module exists to prevent.
 *
 * `main/runtime.paths.ts` builds the descriptor from `MAC_PROVIDER_SERVER_NAME`, and the renderer
 * matches against the same constant, so the two can never drift.
 *
 * Deliberately dependency-free: it is imported by the Electron main process, by the capability
 * provider and by the sandboxed renderer bundle.
 */

/** The `name` Electron main gives the provider in the host-capability descriptor. */
export const MAC_PROVIDER_SERVER_NAME = 'bimax-mac';

/** The compatibility tool the provider always exposes. */
export const MAC_CONTROL_TOOL = 'mac_control';

/** Native specialist tools are `BimaxActionTool`, `BimaxTransactionTool`, `BimaxWorkspaceTool`, … */
const NATIVE_TOOL = /^Bimax\w*Tool$/;

/** `mcp__<server>__<tool>`; the server name may contain the same characters the engine allows. */
const QUALIFIED = /^mcp__(.+?)__(.+)$/;

export interface MacToolIdentity {
  /** True only for a tool this Desktop build's own provider exposes. */
  isMac: boolean;
  /** The provider-declared tool name, with any `mcp__server__` prefix removed. */
  bare: string;
  /** The MCP server the name named, when it was fully qualified. */
  server: string | null;
}

/**
 * Classify one tool name.
 *
 * Two shapes are legitimate and both are accepted by this one function — there is deliberately no
 * second recognizer:
 *
 *  - **fully qualified** (`mcp__bimax-mac__mac_control`) — what the engine emits in production;
 *  - **bare** (`mac_control`) — what the provider itself, the stdio contract probe and the packaged
 *    conformance harness use, because they talk to the provider directly with no MCP client in
 *    between.
 *
 * A qualified name must name THIS server exactly. Another server that happens to expose a tool
 * called `mac_control` is not Bimax's Mac provider, and treating it as one would put a third party's
 * output into the Live Target and the receipt.
 */
export function macToolIdentity(toolName: string): MacToolIdentity {
  const name = typeof toolName === 'string' ? toolName : '';
  const qualified = QUALIFIED.exec(name);
  if (qualified) {
    const [, server, bare] = qualified;
    // Anything our own provider exposes counts, so a native tool added later does not silently
    // vanish from the Mac lane. Any other server is not ours, whatever its tool is called.
    return { isMac: server === MAC_PROVIDER_SERVER_NAME, bare, server };
  }
  return {
    isMac: name === MAC_CONTROL_TOOL || NATIVE_TOOL.test(name),
    bare: name,
    server: null,
  };
}

/** Is this tool call one the Desktop macOS provider owns? */
export function isMacProviderTool(toolName: string): boolean {
  return macToolIdentity(toolName).isMac;
}
