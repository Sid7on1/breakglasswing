import * as fs from 'fs';
import * as path from 'path';

// A3 — MCP client config. Servers are declared in `.bimax/mcp.json`. Two shapes are
// accepted: our `{ servers: [{ name, command, args, env }] }`, and the Claude-style
// `{ mcpServers: { "<name>": { command, args, env } } }` for drop-in compatibility.

export interface McpServerSpec {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function loadMcpServers(dir: string = process.cwd()): McpServerSpec[] {
  const file = path.join(dir, '.bimax', 'mcp.json');
  let cfg: any;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }

  if (Array.isArray(cfg.servers)) {
    return cfg.servers.filter((s: any) => s && s.name && s.command);
  }
  if (cfg.mcpServers && typeof cfg.mcpServers === 'object') {
    return Object.entries(cfg.mcpServers)
      .map(([name, v]: [string, any]) => ({ name, command: v?.command, args: v?.args, env: v?.env }))
      .filter(s => s.name && s.command);
  }
  return [];
}
