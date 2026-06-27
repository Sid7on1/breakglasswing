import { buildTool, BuiltTool } from '../tool.factory';
import { IGovernor } from '../../core/interfaces';
import { ToolRegistry } from '../tool.registry';
import * as os from 'os';
import { McpManager } from '../../mcp/manager';
import { normalizeArgs, missingPathArgs, loadMcpServers } from '../../mcp/config';
import { discoverServers, catalogEntry } from '../../mcp/catalog';

/**
 * Lets the agent set up MCP servers for itself. `isDestructive` is true, so the Governor prompts
 * the user for confirmation before any external server is started (the "gated self-setup" model).
 * On approval, `add` writes `.bimax/mcp.json` and connects live, so the new `mcp__<name>__*` tools
 * become available in the same session.
 */
export function createMcpManageTool(governor: IGovernor, registry: ToolRegistry, manager: McpManager): BuiltTool {
  return buildTool({
    name: 'McpManageTool',
    description: `Manage MCP (Model Context Protocol) servers, which add external tool sets (filesystem, GitHub, databases, …).

# Actions
- list: show configured + connected MCP servers and their tools.
- discover: find a server by CAPABILITY when you don't know the package. Pass { query } in plain language ("query a postgres database", "search the web", "drive a browser") and get back ranked matches from a built-in catalog, each with an "id". Then call add with that { id } — no need to know the npx package. Use this WHENEVER a task needs an external capability you don't already have a tool for.
- add: register and connect a new server. Three ways to specify it:
  • BY CATALOG ID (easiest): { id } from a discover result — e.g. { action:"add", id:"postgres", args:["postgresql://…"] }. The command/package is filled in for you; pass argHint values via args and any needsEnv keys via env.
  • LOCAL OR REMOTE (manual), if it's not in the catalog:
  • LOCAL (stdio): { name, command, args?, env? } — e.g. name="github", command="npx", args=["-y","@modelcontextprotocol/server-github"].
  • REMOTE (a hosted URL, e.g. an mcpmarket/Smithery "https://…/mcp" link): { name, url, headers? } — e.g. name="magic", url="https://link.mcpmarket.com/…/mcp". Do NOT invent an npx command for a URL — pass it as "url".
  The user is asked to confirm before the server starts. After it connects, its tools appear as mcp__<name>__<tool>.
- remove: disconnect a server and delete it from .bimax/mcp.json. Needs { name }. Its mcp__<name>__* tools are unregistered.
- remove-all: disconnect and delete EVERY configured MCP server. Use this when the user says "delete/remove all MCP servers". Do NOT try to delete files by path — use this action.
- disable: keep a server in config but stop it and prevent it starting at boot. Needs { name }.
- enable: re-enable a disabled server and connect it now. Needs { name }.

# When to use
- The user asks to install/add/set up an MCP server, or a task needs a capability an MCP server provides.
- If the user gives you a URL, add it with "url". If they give a package/command, use "command"+"args".
- The user asks to remove/delete/uninstall a server → use remove (one) or remove-all (everything).

# CRITICAL — adding from a pasted config
- If the user PASTES an MCP config and says "add this" — a JSON like {"mcpServers":{"<name>":{"command":"npx","args":[...]}}}, or {command,args}, or a bare URL — read the name/command/args/url OUT of it and call THIS tool with action="add". For the example above: name="<name>", command="npx", args=[...].
- NEVER write that config to a file (do NOT use WriteFileTool / create mcpServers.json). bimax stores MCP config itself in .bimax/mcp.json — your only job is to call McpManageTool add.`,
    isDestructive: true, // Governor confirms before an external process is started
    isConcurrencySafe: false,
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'discover', 'add', 'remove', 'remove-all', 'enable', 'disable'], description: 'What to do.' },
        query: { type: 'string', description: 'For discover: a plain-language capability you need (e.g. "search the web", "query postgres").' },
        id: { type: 'string', description: 'For add: a catalog id from a discover result (e.g. "github", "postgres"). Resolves command/args automatically.' },
        name: { type: 'string', description: 'Server name (for add/remove/enable/disable). Defaults to the catalog id when adding by id.' },
        command: { type: 'string', description: 'Executable to launch a LOCAL server (for add), e.g. "npx". Omit for remote URL servers.' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the command.' },
        env: { type: 'object', description: 'Extra environment variables for the server process.' },
        url: { type: 'string', description: 'URL of a REMOTE (hosted) MCP server, e.g. "https://…/mcp". Use instead of command.' },
        headers: { type: 'object', description: 'Extra HTTP headers for a remote server (e.g. auth tokens).' },
      },
      required: ['action'],
    },
    execute: async (args: { action: string; query?: string; id?: string; name?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }) => {
      if (args.action === 'discover') {
        const matches = discoverServers(args.query || '', 6);
        if (matches.length === 0) {
          return `No catalog match for "${args.query}". You can still add a server manually with action="add" + command/args or url, ` +
            `or search mcpmarket.com / Smithery for a hosted URL.`;
        }
        const lines = matches.map(m => {
          const how = m.url ? `remote URL` : `${m.command} ${(m.args || []).join(' ')}`;
          const extras = [
            m.argHint ? `needs arg: ${m.argHint}` : '',
            m.needsEnv?.length ? `needs env: ${m.needsEnv.join(', ')}` : '',
          ].filter(Boolean).join(' · ');
          return `- ${m.id} — ${m.title}: ${m.description}\n    install: action="add" id="${m.id}"  (${how})${extras ? `\n    ${extras}` : ''}`;
        });
        return `Matching MCP servers (add with action="add" and the id):\n${lines.join('\n')}`;
      }

      if (args.action === 'list') {
        const connected = manager.list();
        const configured = manager.configuredNames();
        if (configured.length === 0 && connected.length === 0) {
          return 'No MCP servers configured. Use action="add" to set one up.';
        }
        const lines = configured.map(n => {
          const conn = manager.get(n);
          if (manager.isDisabled(n)) return `- ${n} (disabled — won't start until enabled)`;
          return conn ? `- ${n} (connected, ${conn.toolNames.length} tools)` : `- ${n} (configured, not connected)`;
        });
        return `MCP servers:\n${lines.join('\n')}`;
      }

      if (args.action === 'add') {
        // Resolve a catalog id → fill in command/args/url/env, letting the agent add a discovered
        // server without knowing its package. Extra args the model passes (a DB URL, a folder) are
        // APPENDED after the catalog base args (which end at the package/flag that takes them).
        if (args.id && !args.command && !args.url) {
          const entry = catalogEntry(args.id);
          if (!entry) return `No catalog server with id "${args.id}". Run action="discover" first to see valid ids.`;
          args.name = args.name || entry.id;
          args.command = entry.command;
          args.url = entry.url;
          args.headers = args.headers;
          args.args = [...(entry.args || []), ...(normalizeArgs(args.args) || [])];
          const missingEnv = (entry.needsEnv || []).filter(k => !process.env[k] && !(args.env && args.env[k]));
          if (missingEnv.length) {
            return `'${entry.id}' needs credential(s): ${missingEnv.join(', ')}. ` +
              `Ask the user for them, then call add again with env={${missingEnv.map(k => `"${k}":"…"`).join(', ')}}.`;
          }
        }
        if (!args.name || (!args.command && !args.url)) {
          return 'add requires "name" and either "command" (local), "url" (remote), or a catalog "id" (run discover first).';
        }
        // The model often passes `args` as a JSON string or a single string — coerce to a real array.
        const cleanArgs = normalizeArgs(args.args) || [];

        // Pre-flight: a local server given path args that don't exist will always exit on startup
        // (classic when a docs template's /path/to/... placeholders are pasted). Catch it here so
        // we never save a broken entry, and the message is actionable instead of a cryptic ENOENT.
        if (!args.url) {
          const missing = missingPathArgs(cleanArgs);
          if (missing.length) {
            return `Did not add '${args.name}': these path arguments don't exist on disk:\n` +
              missing.map(m => `  - ${m}`).join('\n') +
              `\nThey look like placeholders. Re-run "add" with REAL folders you want to expose, e.g. "${process.cwd()}".`;
          }
        }

        const spec = args.url
          ? { name: args.name, url: args.url, headers: args.headers }
          : { name: args.name, command: args.command, args: cleanArgs, env: args.env };
        manager.addToConfig(spec);
        const conn = await manager.connectSpec(spec, registry, governor);
        if (!conn) {
          const reason = manager.lastError ? ` Reason: ${manager.lastError}.` : '';
          if (args.url) {
            return `Saved '${args.name}' to .bimax/mcp.json, but the remote URL '${args.url}' failed to connect.${reason} It may be unreachable, need auth headers, or speak a different transport.`;
          }
          return `Saved '${args.name}' to .bimax/mcp.json, but the command 'npx'/'${args.command} ${cleanArgs.join(' ')}' exited before connecting.${reason} ` +
            `Common causes: the package name is wrong, or a required PATH argument points at a folder that does not exist. ` +
            `For the filesystem server, pass REAL absolute paths you want to expose (e.g. args ["-y","@modelcontextprotocol/server-filesystem","${process.cwd()}"]) — not placeholders like /path/to/folder.`;
        }
        return `Connected MCP server '${args.name}' — added ${conn.toolNames.length} tool(s): ${conn.toolNames.join(', ') || '(none)'}.`;
      }

      if (args.action === 'remove') {
        if (!args.name) return 'remove requires "name". Use action="list" to see configured servers, or "remove-all".';
        await manager.disconnect(args.name, registry);
        const removed = manager.removeFromConfig(args.name);
        return removed
          ? `Removed MCP server '${args.name}' — disconnected and deleted from .bimax/mcp.json.`
          : `No MCP server named '${args.name}' was configured.`;
      }

      if (args.action === 'remove-all') {
        const names = manager.configuredNames();
        const live = manager.list().map(c => c.name);
        const all = Array.from(new Set([...names, ...live]));
        if (all.length === 0) return 'No MCP servers configured — nothing to remove.';
        for (const n of all) {
          await manager.disconnect(n, registry);
          manager.removeFromConfig(n);
        }
        return `Removed all MCP servers (${all.length}): ${all.join(', ')}. .bimax/mcp.json is now empty.`;
      }

      if (args.action === 'enable' || args.action === 'disable') {
        if (!args.name) return `${args.action} requires "name".`;
        const enabling = args.action === 'enable';
        const ok = await manager.setEnabled(args.name, enabling, registry);
        if (!ok) return `No MCP server named '${args.name}' was configured.`;
        if (enabling) {
          const full = loadMcpServers(os.homedir()).find(s => s.name === args.name);
          const conn = full ? await manager.connectSpec(full, registry, governor) : null;
          return conn
            ? `Enabled & connected '${args.name}' (${conn.toolNames.length} tools).`
            : `Enabled '${args.name}', but it failed to start.${manager.lastError ? ' Reason: ' + manager.lastError : ''}`;
        }
        return `Disabled '${args.name}' — it stays in config but won't start until re-enabled.`;
      }

      return `Unknown action "${args.action}". Use "list", "add", "remove", or "remove-all".`;
    },
  }, governor);
}
