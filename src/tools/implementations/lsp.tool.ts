import * as fs from 'fs';
import * as path from 'path';
import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { GraphStore } from '../../graph/graph.store';
import { resolveNodeId } from '../../graph/node.search';
import { lspSpecFor, isServerAvailable } from '../../lsp/registry';
import { LspClient } from '../../lsp/client';

// C1 — expose Language-Server enrichments to the agent: compiler-grade DIAGNOSTICS and
// precise REFERENCES (better than the graph's name-based CALLS). Graph-fused: REFERENCES
// resolves its symbol through the graph (node.search), so the agent names a symbol, not a
// line/column. Degrades cleanly when the relevant server isn't installed.

// One client per (server command, project root), reused across calls within the process.
const clients = new Map<string, LspClient>();
function getClient(spec: { command: string; args: string[] }, root: string): LspClient {
  const key = `${spec.command}|${root}`;
  let c = clients.get(key);
  if (!c) { c = new LspClient(spec, root); clients.set(key, c); }
  return c;
}

export const createLspQueryTool = (governor: IGovernor, graphStore: GraphStore) => buildTool({
  name: 'LspQueryTool',
  description: `Query an installed Language Server for precise, compiler-grade code info — complements the structural graph.

# Verbs (pass as \`query\`)
- \`DIAGNOSTICS <file>\` — real type/lint errors for a file from its language server.
- \`REFERENCES <symbol>\` — every precise reference to a graph symbol (node id or keyword).

Requires the language server installed (typescript-language-server for TS/JS, pyright for Python). Returns a clear note if it isn't.`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'DIAGNOSTICS <file> | REFERENCES <symbol>' } },
    required: ['query'],
  },
  execute: async (args: { query: string }, context?: any) => {
    const raw = (args.query || '').trim();
    if (!raw) return 'Usage: DIAGNOSTICS <file> | REFERENCES <symbol>';
    const cwd = context?.cwd || process.cwd();
    const sp = raw.indexOf(' ');
    const verb = (sp === -1 ? raw : raw.slice(0, sp)).toUpperCase();
    const target = sp === -1 ? '' : raw.slice(sp + 1).trim();

    if (verb === 'DIAGNOSTICS') {
      if (!target) return 'Usage: DIAGNOSTICS <file>';
      const file = path.isAbsolute(target) ? target : path.resolve(cwd, target);
      if (!fs.existsSync(file)) return `File not found: ${target}`;
      const spec = lspSpecFor(file);
      if (!spec) return `No language server configured for ${path.extname(file) || 'this file type'}.`;
      if (!isServerAvailable(spec)) {
        return `Language server '${spec.command}' is not installed — install it to enable LSP diagnostics (e.g. \`npm i -g ${spec.command}\`).`;
      }
      const diags = await getClient(spec, cwd).diagnose(file);
      if (diags.length === 0) return `No diagnostics for ${target}. ✅`;
      return `${diags.length} diagnostic(s) for ${target}:\n` +
        diags.map(d => `- [${d.severity}] ${d.line + 1}:${d.character + 1} ${d.message}`).join('\n');
    }

    if (verb === 'REFERENCES') {
      if (!target) return 'Usage: REFERENCES <symbol>';
      const resolved = resolveNodeId(graphStore, target);
      if (resolved.ambiguous) return `"${target}" is ambiguous — be more specific or use GraphQueryTool SEARCH_NODES.`;
      if (!resolved.id) return `No graph node found for "${target}".`;
      const node = graphStore.getNode(resolved.id)!;
      if (!node.filePath || node.startLine == null) return `${node.id} has no recorded location — re-run /index.`;
      const file = path.isAbsolute(node.filePath) ? node.filePath : path.resolve(cwd, node.filePath);
      const spec = lspSpecFor(file);
      if (!spec) return `No language server configured for ${path.extname(file)}.`;
      if (!isServerAvailable(spec)) return `Language server '${spec.command}' is not installed.`;
      // Point the request at the symbol's name on its declaration line.
      const simpleName = node.name.split('.').pop() || node.name;
      const lineText = (fs.readFileSync(file, 'utf8').split('\n')[node.startLine - 1]) || '';
      const col = Math.max(0, lineText.indexOf(simpleName));
      const refs = await getClient(spec, cwd).references(file, node.startLine - 1, col);
      if (refs.length === 0) return `No references found for ${node.name}.`;
      return `${refs.length} reference(s) to ${node.name}:\n` +
        refs.map(r => `- ${decodeURIComponent(r.uri.replace(/^file:\/\//, ''))}:${r.line + 1}:${r.character + 1}`).join('\n');
    }

    return 'Usage: DIAGNOSTICS <file> | REFERENCES <symbol>';
  },
}, governor);
