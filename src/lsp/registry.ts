import * as path from 'path';
import { execSync } from 'child_process';

// C1 — language-server registry. Maps a file extension to the command that launches its LSP
// server over stdio. Mirrors the tree-sitter language map: adding a language is one entry +
// the user installing that server. Servers are NOT bundled — they are detected at runtime,
// so the LSP tool degrades cleanly when one isn't installed.

export interface LspServerSpec {
  command: string;
  args: string[];
}

const LSP_SERVERS: Record<string, LspServerSpec> = {
  '.ts': { command: 'typescript-language-server', args: ['--stdio'] },
  '.tsx': { command: 'typescript-language-server', args: ['--stdio'] },
  '.js': { command: 'typescript-language-server', args: ['--stdio'] },
  '.jsx': { command: 'typescript-language-server', args: ['--stdio'] },
  '.py': { command: 'pyright-langserver', args: ['--stdio'] },
};

export function lspSpecFor(file: string): LspServerSpec | null {
  return LSP_SERVERS[path.extname(file).toLowerCase()] || null;
}

const availability = new Map<string, boolean>();
/** True if the server's command is on PATH (cached per command). */
export function isServerAvailable(spec: LspServerSpec): boolean {
  if (availability.has(spec.command)) return availability.get(spec.command)!;
  let ok = false;
  try {
    execSync(`command -v ${spec.command}`, { stdio: 'ignore' });
    ok = true;
  } catch {
    // command not on PATH — stays false
  }
  availability.set(spec.command, ok);
  return ok;
}
