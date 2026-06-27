import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { spawn, ChildProcess } from 'child_process';
import { LspServerSpec } from './registry';
import { Logger } from '../utils/logger';
import { withTimeoutOr } from '../utils/withTimeout';

// C1 — a minimal LSP client over stdio (vscode-jsonrpc). Spawns a language server, performs
// the initialize handshake, opens documents, and exposes the two enrichments the agent
// actually benefits from: DIAGNOSTICS (pushed by the server after didOpen) and REFERENCES
// (precise, better than the graph's name-based CALLS). One client per (server, root); kept
// alive and reused across calls. Everything degrades to [] on failure — never throws upward.
const rpc = require('vscode-jsonrpc/node');

const SEVERITY: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'information', 4: 'hint' };

export interface LspDiagnostic { line: number; character: number; severity: string; message: string; }
export interface LspLocation { uri: string; line: number; character: number; }

export class LspClient {
  private proc: ChildProcess | null = null;
  private connection: any = null;
  private opened = new Map<string, number>();      // uri -> document version
  private diagnostics = new Map<string, any[]>();    // uri -> latest diagnostics
  private initialized = false;
  private startFailed = false;

  constructor(private spec: LspServerSpec, private rootPath: string) {}

  private uriFor(file: string): string { return url.pathToFileURL(file).toString(); }
  private langId(file: string): string {
    const e = path.extname(file).toLowerCase();
    return e === '.py' ? 'python' : e.startsWith('.ts') ? 'typescript' : 'javascript';
  }

  /** Lazily spawn + initialize the server. Returns false (cached) if it can't start. */
  async start(): Promise<boolean> {
    if (this.initialized) return true;
    if (this.startFailed) return false;
    try {
      this.proc = spawn(this.spec.command, this.spec.args, { cwd: this.rootPath, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e: any) {
      Logger.warn(`[LSP] spawn failed for ${this.spec.command}: ${e.message}`);
      this.startFailed = true;
      return false;
    }
    if (!this.proc.pid || !this.proc.stdout || !this.proc.stdin) { this.startFailed = true; return false; }
    this.proc.on('error', () => { this.startFailed = true; });

    const reader = new rpc.StreamMessageReader(this.proc.stdout);
    const writer = new rpc.StreamMessageWriter(this.proc.stdin);
    this.connection = rpc.createMessageConnection(reader, writer);
    this.connection.onError(() => { /* non-fatal */ });
    this.connection.onNotification('textDocument/publishDiagnostics', (params: any) => {
      this.diagnostics.set(params.uri, params.diagnostics || []);
    });
    this.connection.listen();

    try {
      await this.connection.sendRequest('initialize', {
        processId: process.pid,
        rootUri: url.pathToFileURL(this.rootPath).toString(),
        capabilities: { textDocument: { publishDiagnostics: {}, references: {} } },
      });
      this.connection.sendNotification('initialized', {});
      this.initialized = true;
      return true;
    } catch (e: any) {
      Logger.warn(`[LSP] initialize failed for ${this.spec.command}: ${e.message}`);
      this.startFailed = true;
      return false;
    }
  }

  /** didOpen on first sight of a file, didChange thereafter (so the server sees latest text). */
  private syncDocument(file: string): string {
    const uri = this.uriFor(file);
    const text = fs.readFileSync(file, 'utf8');
    if (!this.opened.has(uri)) {
      this.opened.set(uri, 1);
      this.connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId: this.langId(file), version: 1, text },
      });
    } else {
      const version = this.opened.get(uri)! + 1;
      this.opened.set(uri, version);
      this.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
    return uri;
  }

  async diagnose(file: string, timeoutMs = 8000): Promise<LspDiagnostic[]> {
    if (!(await this.start())) return [];
    const uri = this.syncDocument(file);
    this.diagnostics.delete(uri); // wait for a fresh publish for this version
    const deadline = Date.now() + timeoutMs;
    while (!this.diagnostics.has(uri) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    return (this.diagnostics.get(uri) || []).map((d: any) => ({
      line: d.range.start.line,
      character: d.range.start.character,
      severity: SEVERITY[d.severity] || 'info',
      message: d.message,
    }));
  }

  async references(file: string, line0: number, char0: number, timeoutMs = 8000): Promise<LspLocation[]> {
    if (!(await this.start())) return [];
    const uri = this.syncDocument(file);
    try {
      const locs = await withTimeoutOr<any>(
        this.connection.sendRequest('textDocument/references', {
          textDocument: { uri }, position: { line: line0, character: char0 }, context: { includeDeclaration: true },
        }),
        timeoutMs,
        null,
      );
      if (!Array.isArray(locs)) return [];
      return locs.map((l: any) => ({ uri: l.uri, line: l.range.start.line, character: l.range.start.character }));
    } catch {
      return [];
    }
  }

  dispose(): void {
    try { this.connection?.dispose(); } catch { /* ignore */ }
    try { this.proc?.kill(); } catch { /* ignore */ }
    this.initialized = false;
  }
}
