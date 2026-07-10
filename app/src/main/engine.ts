import { spawn, execFileSync, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { app } from 'electron';
import { existsSync, mkdirSync, createWriteStream, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Finder-launched macOS apps inherit launchd's minimal PATH (/usr/bin:/bin:...), not the user's
 * shell PATH — so the engine child can't find npx/node/git-hooks and every node-based MCP server
 * fails with "Executable not found in $PATH". Resolve the real PATH once from the user's login
 * shell and merge in the usual tool dirs as a fallback (shell probe can fail in odd setups).
 */
let resolvedPath: string | null = null;
function userShellPath(): string {
  if (resolvedPath) return resolvedPath;
  const parts = new Set((process.env.PATH || '').split(':').filter(Boolean));
  if (process.platform !== 'win32') {
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const out = execFileSync(shell, ['-ilc', 'echo -n "$PATH"'], { encoding: 'utf8', timeout: 5000 });
      out.split(':').filter(Boolean).forEach((p) => parts.add(p));
    } catch { /* fall through to static dirs */ }
    const home = os.homedir();
    ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`, `${home}/.bun/bin`, `${home}/bin`]
      .forEach((p) => { if (existsSync(p)) parts.add(p); });
  }
  resolvedPath = [...parts].join(':');
  return resolvedPath;
}

/**
 * Engine host — spawns and talks to the headless Bimax engine (BIMAX_HEADLESS=1), the exact
 * process the Go TUI drives (see tui/engine.go, which this ports). Outbound messages arrive as
 * NDJSON on the child's stdout; inbound commands go out as NDJSON on its stdin. Engine stderr
 * (boot logs) is diverted to <userData>/engine.log so it can never corrupt the protocol stream.
 *
 * Command resolution, in order (mirrors StartEngine in tui/engine.go):
 *   1. $BIMAX_ENGINE_CMD                  — explicit override (dev escape hatch)
 *   2. <resources>/engine/bimax-engine    — the bun-compiled standalone binary bundled by
 *                                           electron-builder (packaged app path)
 *   3. node <repo>/dist/index.js          — dev with a fresh compiled build (~3× faster boot)
 *   4. npx tsx <repo>/src/index.ts        — dev from source
 */

export type EngineState = 'starting' | 'ready' | 'exited';

export interface EngineEvents {
  onMessage: (msg: unknown) => void;
  onState: (state: EngineState, detail?: string) => void;
}

// In dev the app lives at <repo>/app, so the engine repo is one level up from the app package.
// electron-vite bundles main to app/out/main/index.js — walk up to app/, then to the repo.
function devRepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function packagedEngineBinary(): string {
  const name = process.platform === 'win32' ? 'bimax-engine.exe' : 'bimax-engine';
  return path.join(process.resourcesPath, 'engine', name);
}

function resolveCommand(projectDir: string): { cmd: string; args: string[]; cwd: string } {
  const override = process.env.BIMAX_ENGINE_CMD;
  if (override && override.trim()) {
    const parts = override.trim().split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1), cwd: projectDir };
  }
  const bundled = packagedEngineBinary();
  if (app.isPackaged && existsSync(bundled)) {
    return { cmd: bundled, args: [], cwd: projectDir };
  }
  const repo = devRepoRoot();
  const dist = path.join(repo, 'dist', 'index.js');
  if (existsSync(dist) && distFresh(repo)) {
    return { cmd: process.execPath, args: [dist], cwd: repo };
  }
  return { cmd: 'npx', args: ['tsx', path.join('src', 'index.ts')], cwd: repo };
}

// A compiled build older than any source file is a trap: the app would silently run stale code.
// Cheap freshness probe (mtime of dist/index.js vs the newest of a handful of src entry files) —
// the Go TUI does a full walk; a sample is enough here since dev builds go through `npm run build`.
function distFresh(repo: string): boolean {
  try {
    const distM = statSync(path.join(repo, 'dist', 'index.js')).mtimeMs;
    const probes = ['src/index.ts', 'src/protocol/headless.entry.ts', 'src/protocol/protocol.ts'];
    return probes.every((p) => {
      try { return statSync(path.join(repo, p)).mtimeMs <= distM; } catch { return true; }
    });
  } catch {
    return false;
  }
}

export class Engine {
  private child: ChildProcess | null = null;
  private events: EngineEvents;
  public projectDir: string;

  constructor(projectDir: string, events: EngineEvents) {
    this.projectDir = projectDir;
    this.events = events;
  }

  start(): void {
    const { cmd, args, cwd } = resolveCommand(this.projectDir);
    this.events.onState('starting', `${cmd} ${args.join(' ')}`.trim());

    const logDir = path.join(app.getPath('userData'));
    mkdirSync(logDir, { recursive: true });
    const logStream = createWriteStream(path.join(logDir, 'engine.log'));

    // The engine must START where its runtime resolves (repo root in dev), but the user's project
    // is projectDir — BIMAX_CWD tells the engine to chdir there (same contract as the Go TUI).
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, PATH: userShellPath(), BIMAX_HEADLESS: '1', BIMAX_CWD: this.projectDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stderr?.pipe(logStream);

    // NDJSON decode. readline handles arbitrarily long lines (command menus serialize to one very
    // long line), unlike a fixed-size scanner buffer.
    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg && msg.t === 'ready') this.events.onState('ready', String(msg.protocol ?? ''));
        this.events.onMessage(msg);
      } catch (err) {
        // Never silently drop a malformed line — a desync is invisible otherwise.
        logStream.write(`[app] dropped malformed line: ${String(err)}\n`);
      }
    });

    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.events.onState('exited', signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`);
    });
    child.on('error', (err) => {
      if (this.child === child) this.child = null;
      this.events.onState('exited', err.message);
    });
  }

  send(msg: unknown): void {
    const stdin = this.child?.stdin;
    if (!stdin || !stdin.writable) return;
    stdin.write(JSON.stringify(msg) + '\n');
  }

  get running(): boolean {
    return this.child !== null;
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try { child.stdin?.end(); } catch { /* already gone */ }
    // The engine exits on stdin close / SIGTERM (headless.entry shutdown hooks); escalate if not.
    const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000);
    child.once('exit', () => clearTimeout(killTimer));
    try { child.kill('SIGTERM'); } catch { /* gone */ }
  }
}
