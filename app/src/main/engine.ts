import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { app } from 'electron';
import { existsSync, mkdirSync, createWriteStream, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { EngineHandle, SpawnCallbacks } from './supervisor/supervisor';

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
 * Engine process adapter — spawns and pipes the headless Bimax engine (BIMAX_HEADLESS=1), the
 * exact process the Go TUI drives (see tui/engine.go, which this ports). Outbound messages arrive
 * as NDJSON on the child's stdout; inbound commands go out as NDJSON on its stdin. Engine stderr
 * (boot logs) is diverted to <userData>/engine.log so it can never corrupt the protocol stream.
 *
 * Lifecycle policy lives in supervisor/supervisor.ts — this file is deliberately dumb: resolve
 * the command, spawn, decode lines, report exits. It never restarts anything itself.
 *
 * Command resolution, in order (mirrors StartEngine in tui/engine.go):
 *   1. $BIMAX_ENGINE_CMD                  — explicit override (dev escape hatch)
 *   2. <resources>/engine/bimax-engine    — the bun-compiled standalone binary bundled by
 *                                           electron-builder (packaged app path)
 *   3. node <repo>/dist/index.js          — dev with a fresh compiled build (~3× faster boot)
 *   4. npx tsx <repo>/src/index.ts        — dev from source
 */

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

// Desktop-owned rolling log: the last few hundred engine stderr / lifecycle lines, in memory,
// ACROSS launches — this is the crash journal's evidence when a SIGKILLed child couldn't flush
// anything. The on-disk engine.log keeps the full history (append mode) for deep dives.
const LOG_RING_MAX = 400;
const logRing: string[] = [];
function ringWrite(line: string): void {
  logRing.push(line.length > 500 ? line.slice(0, 500) + '…' : line);
  if (logRing.length > LOG_RING_MAX) logRing.splice(0, logRing.length - LOG_RING_MAX);
}

/** The bounded recent engine log — injected into the supervisor as its `logTail` dependency. */
export function recentEngineLog(maxChars = 6000): string {
  return logRing.join('\n').slice(-maxChars);
}

/**
 * Spawn one engine child for `projectDir`. Fits the supervisor's `deps.spawn` contract: callbacks
 * fire exactly once per event, the handle only exposes write/end/kill (no raw process access ever
 * reaches the renderer), and cleanup of streams + listeners happens on exit here.
 */
export function spawnEngineProcess(projectDir: string, extraEnv: Record<string, string>, cb: SpawnCallbacks): EngineHandle {
  const { cmd, args, cwd } = resolveCommand(projectDir);
  const startedAt = Date.now();
  const command = `${cmd} ${args.join(' ')}`.trim();

  const logDir = path.join(app.getPath('userData'));
  mkdirSync(logDir, { recursive: true });
  // Append instead of truncating: a force-killed child cannot flush a final message, so retaining
  // the previous boot and the desktop-owned lifecycle lines is essential crash evidence.
  const logStream = createWriteStream(path.join(logDir, 'engine.log'), { flags: 'a' });
  const logLine = (line: string): void => {
    ringWrite(line);
    logStream.write(line + '\n');
  };
  logLine(`[desktop] ${new Date().toISOString()} starting engine for ${projectDir}: ${command}`);

  // The engine must START where its runtime resolves (repo root in dev), but the user's project
  // is projectDir — BIMAX_CWD tells the engine to chdir there (same contract as the Go TUI).
  const child = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      ...extraEnv, // the supervisor's capability plan (headroom/codemem/autoIndex/drives gates)
      PATH: userShellPath(),
      BIMAX_HEADLESS: '1',
      BIMAX_CWD: projectDir,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // stderr → engine.log + the in-memory ring (journal evidence), never the protocol stream.
  let stderrBuf = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf8');
    let nl: number;
    while ((nl = stderrBuf.indexOf('\n')) !== -1) {
      logLine(stderrBuf.slice(0, nl));
      stderrBuf = stderrBuf.slice(nl + 1);
    }
  });

  // NDJSON decode. readline handles arbitrarily long lines (command menus serialize to one very
  // long line), unlike a fixed-size scanner buffer.
  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      if (msg && typeof msg === 'object') cb.onMessage(msg as Record<string, unknown>);
      else cb.onMalformed(trimmed);
    } catch {
      // Never silently drop a malformed line — a desync is invisible otherwise.
      logLine(`[app] dropped malformed line (${trimmed.length} chars)`);
      cb.onMalformed(trimmed);
    }
  });

  let settled = false;
  child.on('exit', (code, signal) => {
    if (settled) return;
    settled = true;
    if (stderrBuf) logLine(stderrBuf); // flush a final partial stderr line
    logLine(`[desktop] engine exited after ${Date.now() - startedAt}ms: ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`);
    rl.close();
    logStream.end();
    cb.onExit(code, signal);
  });
  child.on('error', (err) => {
    if (settled) return;
    settled = true;
    logLine(`[desktop] engine process error after ${Date.now() - startedAt}ms: ${err.message}`);
    rl.close();
    logStream.end();
    cb.onError(err);
  });

  return {
    pid: child.pid,
    command,
    write: (line: string) => {
      const stdin = child.stdin;
      if (stdin && stdin.writable) stdin.write(line);
    },
    endStdin: () => { try { child.stdin?.end(); } catch { /* already gone */ } },
    kill: (signal) => { try { child.kill(signal); } catch { /* already gone */ } },
  };
}
