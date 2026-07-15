// Built-in engine: the REAL Headroom Kompress proxy (headroomlabs-ai/headroom).
//
// This replaces the old "native heuristic" fallback (a ~50-line log/ANSI deduper that only ever
// shaved ~1%) with Headroom's actual ML compressor: the `chopratejas/kompress-v2-base` ModernBERT
// token classifier, run torch-free via its int8 ONNX backend on onnxruntime. It compresses the
// noisy bulk of an agent's context (tool outputs, logs, file dumps) ~30-40% while its learned
// "must-keep" head protects error/warning/signal lines (verified: ECONNREFUSED & friends survive).
//
// We bake it in the same spirit as codebase-memory: provision on first use, cache under vendor/
// (gitignored), auto-spawn as a localhost sidecar, and expose it to the engine via the standard
// `HEADROOM_PROXY_URL` that `headroom.compress.ts#proxyCompress` already speaks to (POST /v1/compress).
//
// Heavy bits (a Python venv + ~261MB model) live entirely under vendor/headroom and never touch git.
// Opt out with BIMAX_DISABLE_HEADROOM=1. If Python isn't available we degrade silently to the native
// compressor — but the whole point of this module is to make the real engine the default.
//
// See memory [[bake_in_codemem_headroom]].

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import { Logger } from '../utils/logger';

const DEFAULT_PORT = Number(process.env.HEADROOM_PORT_OVERRIDE) || 8788; // 8788 avoids a user-run :8787
// The live port for THIS engine's proxy. Starts at the default but a cross-process singleton may
// bind an ephemeral port instead when 8788 is already taken — so two engines never race for 8788
// (the "address already in use" bug).
let _port = DEFAULT_PORT;
const PIP_SPEC = 'headroom-ai[proxy]';

/** Repo/package root (where vendor/ lives). Works from both dist/ and src (tsx). */
function pkgRoot(): string {
  // dist/memory/headroomProxy.js -> ../.. = repo root ; src/memory/headroomProxy.ts -> ../.. = repo root
  return path.resolve(__dirname, '..', '..');
}
function homeDir(): string { return path.join(pkgRoot(), 'vendor', 'headroom'); }
function venvDir(): string { return path.join(homeDir(), 'venv'); }
function venvBin(name: string): string {
  return path.join(venvDir(), process.platform === 'win32' ? 'Scripts' : 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
}

let _child: ChildProcess | null = null;
let _starting: Promise<boolean> | null = null;
let _ready = false;
let _ownsLock = false;

export function isHeadroomReady(): boolean { return _ready; }

// ---- Cross-process singleton ownership -------------------------------------------------------
// A lockfile records the pid + port of whichever engine owns the sidecar. A second engine reads it,
// health-probes that port, and REUSES the live proxy instead of spawning its own on the same fixed
// port. Stale locks (owner died, proxy unhealthy) are cleaned. This is the deterministic answer to
// two simultaneous starts colliding on :8788.

interface ProxyLock { pid: number; port: number; startedAt: number; }

function lockFile(): string { return path.join(homeDir(), 'proxy.lock'); }

export function readProxyLock(file = lockFile()): ProxyLock | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (typeof raw?.pid === 'number' && typeof raw?.port === 'number') return raw as ProxyLock;
  } catch { /* missing or corrupt */ }
  return null;
}

/** Atomically claim the lock (fails if another live owner holds it). Returns true on success. */
export function acquireProxyLock(port: number, file = lockFile()): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() } as ProxyLock), { flag: 'wx' });
    return true;
  } catch {
    return false; // exists — someone else owns it
  }
}

/** Overwrite the lock unconditionally (used after we confirm the prior owner is stale). */
function writeProxyLock(port: number, file = lockFile()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() } as ProxyLock));
  } catch { /* best-effort */ }
}

/** Remove the lockfile only if THIS process owns it — never yank a sibling engine's lock. */
export function releaseProxyLock(file = lockFile()): void {
  try {
    const lock = readProxyLock(file);
    if (lock && lock.pid === process.pid) fs.rmSync(file, { force: true });
  } catch { /* best-effort */ }
}

/** True when nothing is listening on `port` (safe to bind). */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/** An OS-assigned free ephemeral port. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : DEFAULT_PORT;
      srv.close(() => resolve(port));
    });
  });
}

export interface ProxyPlan { action: 'reuse' | 'spawn' | 'external'; port: number; }

/**
 * Decide what a starting engine should do, WITHOUT any side effects — the singleton's brain, kept
 * pure so the race logic is unit-testable with fake probes. Order:
 *   1. A user-provided external proxy (not on our port) → use it as-is.
 *   2. A lockfile whose recorded port is actually healthy → reuse that live sidecar.
 *   3. Otherwise spawn — on the default port if free, else on an OS-assigned ephemeral port so we
 *      never collide with whatever already holds 8788.
 */
export async function planProxyStartup(opts: {
  lockFile: string;
  defaultPort: number;
  externalUrl?: string;
  healthy: (port: number) => Promise<boolean>;
  portFree: (port: number) => Promise<boolean>;
  freePort: () => Promise<number>;
}): Promise<ProxyPlan> {
  if (opts.externalUrl && !opts.externalUrl.includes(`:${opts.defaultPort}`)) {
    return { action: 'external', port: opts.defaultPort };
  }
  const lock = readProxyLock(opts.lockFile);
  if (lock && await opts.healthy(lock.port)) return { action: 'reuse', port: lock.port };
  const port = (await opts.portFree(opts.defaultPort)) ? opts.defaultPort : await opts.freePort();
  return { action: 'spawn', port };
}

/**
 * Wait (bounded) for the proxy to become ready. ensureHeadroomProxy() is already racing to bring it up
 * in the background; this lets the first under-pressure compaction give it a beat rather than instantly
 * falling back to native. Returns fast once ready; the cap keeps a still-provisioning fresh machine
 * (minutes of install/download) from hanging the request.
 */
export async function awaitHeadroomReady(timeoutMs: number): Promise<boolean> {
  if (_ready) return true;
  // Nothing is bringing the proxy up (no in-flight ensureHeadroomProxy) — don't burn the caller's
  // budget polling for something that will never arrive: unit tests, provisioning disabled/failed,
  // or a host without python3. Waiting the full timeout here was an 8s stall on the first pressured
  // turn (and a >5s test-timeout). Only wait when a startup is actually in flight.
  if (!_starting) return false;
  const deadline = Date.now() + timeoutMs;
  while (!_ready && Date.now() < deadline) await new Promise(r => setTimeout(r, 300));
  return _ready;
}

type ProcessResult = { status: number | null; stdout: string; stderr: string };

/** Run provisioning commands without ever blocking the engine's protocol/UI event loop. */
function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child: ChildProcess;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ status: -1, stdout, stderr: (error as Error).message });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => resolve({ status: -1, stdout, stderr: error.message }));
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Locate a usable system python3 to bootstrap the venv from. Returns null if none. */
async function findSystemPython(): Promise<string | null> {
  for (const cand of ['python3', 'python']) {
    const r = await runProcess(cand, ['-c', 'import sys; print(sys.version_info[0])']);
    if (r.status === 0 && (r.stdout || '').trim().startsWith('3')) return cand;
  }
  return null;
}

/** True once the venv has headroom-ai[proxy] importable. */
async function venvProvisioned(): Promise<boolean> {
  const py = venvBin('python');
  if (!fs.existsSync(py)) return false;
  const r = await runProcess(py, ['-c', 'import headroom, fastapi, onnxruntime']);
  return r.status === 0;
}

/** Create the venv and pip-install headroom-ai[proxy]. Slow (first run only). Returns success. */
async function provisionVenv(): Promise<boolean> {
  const sys = await findSystemPython();
  if (!sys) { Logger.warn('[Headroom] no python3 found — cannot provision the Kompress proxy; staying on native compressor.'); return false; }
  fs.mkdirSync(homeDir(), { recursive: true });
  if (!fs.existsSync(venvBin('python'))) {
    Logger.info('[Headroom] creating Python venv for the Kompress proxy (vendor/headroom/venv)…');
    const v = await runProcess(sys, ['-m', 'venv', venvDir()]);
    if (v.status !== 0) { Logger.warn(`[Headroom] venv creation failed: ${v.stderr || v.stdout}`); return false; }
  }
  Logger.info(`[Headroom] installing ${PIP_SPEC} (one-time, ~hundreds of MB)…`);
  const pip = await runProcess(venvBin('python'), ['-m', 'pip', 'install', '-q', '--upgrade', 'pip']);
  if (pip.status !== 0) Logger.warn(`[Headroom] pip self-upgrade warning: ${pip.stderr}`);
  const inst = await runProcess(venvBin('python'), ['-m', 'pip', 'install', '-q', PIP_SPEC]);
  if (inst.status !== 0) { Logger.warn(`[Headroom] pip install failed: ${inst.stderr || inst.stdout}`); return false; }
  Logger.info('[Headroom] proxy dependencies installed.');
  return true;
}

function httpGetOk(pathname: string, timeoutMs: number, port: number = _port): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: timeoutMs }, res => {
      res.resume();
      resolve((res.statusCode || 500) < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitReady(totalMs: number): Promise<boolean> {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (await httpGetOk('/readyz', 1000)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/** Spawn `headroom proxy` with the Kompress ONNX backend forced. */
function spawnProxy(): ChildProcess {
  // CoreML on macOS (ANE/GPU) where available, else CPU ONNX — both torch-free. 'auto' picks the best.
  // NB: we deliberately leave HF_HOME alone so the ~261MB Kompress model lands in the user's standard
  // HuggingFace cache (downloaded once, reused across sessions/tools) rather than duplicated per-repo.
  // Backend pinned to CPU `onnx` (NOT CoreML `auto`): CoreML compiles the ONNX graph to the ANE on the
  // first non-trivial inference, which can stall or error mid-request (the cold first compaction then
  // times out → native fallback). CPU ONNX is a predictable ~1-9s with no compile step. Override with
  // HEADROOM_KOMPRESS_BACKEND if you want to opt into CoreML.
  const env = {
    ...process.env,
    HEADROOM_HOME: homeDir(),
    HF_HUB_DISABLE_TELEMETRY: '1',
    HEADROOM_KOMPRESS_BACKEND: process.env.HEADROOM_KOMPRESS_BACKEND || 'onnx',
    HEADROOM_DISABLE_KOMPRESS: '0',
    HEADROOM_MODE: 'token',                            // prioritize compression
  };
  const child = spawn(venvBin('headroom'), ['proxy', '--port', String(_port), '--no-cache', '--no-rate-limit', '--no-ccr-inject-tool'], {
    env, stdio: ['ignore', 'ignore', 'pipe'], detached: false,
  });
  child.stderr?.on('data', (b: Buffer) => {
    const s = b.toString().trim();
    if (/error|traceback|failed/i.test(s)) Logger.warn(`[Headroom proxy] ${s.slice(0, 300)}`);
  });
  child.on('exit', code => { _ready = false; if (code) Logger.warn(`[Headroom] proxy exited (code ${code}).`); });
  return child;
}

/**
 * Ensure the real Headroom Kompress proxy is provisioned, running, and wired into the engine via
 * HEADROOM_PROXY_URL. Idempotent and safe to fire-and-forget at startup — provisioning/model download
 * happen in the background and never block the request path. The engine only *calls* the proxy when a
 * turn is under token pressure (see context.manager), so a slow first boot costs nothing.
 */
export async function ensureHeadroomProxy(): Promise<boolean> {
  if (process.env.BIMAX_DISABLE_HEADROOM === '1') return false;
  // Compression disabled ⇒ the proxy would never be used — don't provision a Python venv +
  // hundreds of MB of pip installs for nothing (this bit hard in benchmark containers).
  if (process.env.BIMAX_DISABLE_COMPRESSION === '1') return false;
  // Respect a user-provided external proxy — don't spawn our own.
  if (process.env.HEADROOM_PROXY_URL && !process.env.HEADROOM_PROXY_URL.includes(`:${DEFAULT_PORT}`)) { _ready = true; return true; }
  if (_ready) return true;
  if (_starting) return _starting;

  _starting = (async () => {
    try {
      const plan = await planProxyStartup({
        lockFile: lockFile(),
        defaultPort: DEFAULT_PORT,
        externalUrl: process.env.HEADROOM_PROXY_URL,
        healthy: (port) => httpGetOk('/readyz', 800, port),
        portFree: isPortFree,
        freePort: findFreePort,
      });

      if (plan.action === 'external') { _ready = true; return true; }

      if (plan.action === 'reuse') {
        // Another engine already owns a healthy sidecar — wire to it, spawn nothing.
        _port = plan.port;
        process.env.HEADROOM_PROXY_URL = `http://127.0.0.1:${_port}`;
        _ready = true;
        Logger.info(`[Headroom] reusing existing Kompress proxy at ${process.env.HEADROOM_PROXY_URL} (singleton).`);
        return true;
      }

      // plan.action === 'spawn'. Claim ownership atomically BEFORE spawning so two engines can't both
      // start on the same port. If the claim loses the race, a sibling is coming up — reuse it.
      _port = plan.port;
      if (!acquireProxyLock(_port)) {
        const other = readProxyLock();
        if (other && await waitReady(15_000)) { // sibling on our default port came up
          _port = other.port; process.env.HEADROOM_PROXY_URL = `http://127.0.0.1:${_port}`; _ready = true;
          Logger.info(`[Headroom] reusing sibling Kompress proxy at ${process.env.HEADROOM_PROXY_URL}.`);
          return true;
        }
        // Sibling never came up (stale claim) — take over the port ourselves.
        writeProxyLock(_port);
      }
      _ownsLock = true;

      if (!(await venvProvisioned()) && !(await provisionVenv())) { releaseProxyLock(); _ownsLock = false; return false; }

      if (!(await httpGetOk('/readyz', 800))) {
        _child = spawnProxy();
        if (!(await waitReady(60_000))) {
          Logger.warn('[Headroom] proxy did not become ready in time.');
          releaseProxyLock(); _ownsLock = false;
          return false;
        }
      }
      writeProxyLock(_port); // record the confirmed-live port for the next engine to reuse
      process.env.HEADROOM_PROXY_URL = `http://127.0.0.1:${_port}`;
      _ready = true;
      Logger.info(`[Headroom] Kompress proxy live at ${process.env.HEADROOM_PROXY_URL} — real ML context compression enabled.`);
      warmModel(); // load/download the Kompress model now so the first under-pressure compaction is warm
      return true;
    } catch (e) {
      Logger.warn(`[Headroom] could not start proxy: ${(e as Error).message}`);
      return false;
    } finally {
      _starting = null;
    }
  })();
  return _starting;
}

/**
 * Fire a throwaway /v1/compress to force the Kompress ONNX model to load/download (~261MB on a fresh
 * machine) off the request path, so the first real under-pressure compaction returns savings instead
 * of a cold-start no-op. Best-effort; failures are ignored.
 */
function warmModel(): void {
  // Warm with a representative agent backlog (code read + logs across several turns) so the Kompress
  // model actually LOADS and runs an inference now — not on the user's first real compaction. A
  // trivial one-liner doesn't exercise the kompress path, leaving the first real call to pay the cold
  // load. Unique-ish content avoids the proxy's content cache short-circuiting the warmup.
  const stamp = Date.now();
  const code = Array.from({ length: 90 }, (_, i) => `export function warm_${stamp}_${i}(a, b) { return a + b + ${i}; }`).join('\n');
  const logs = Array.from({ length: 80 }, (_, i) => `[${stamp}:${i}] INFO compiled ./src/m${i}.ts in ${i * 3}ms`).join('\n');
  const body = JSON.stringify({
    messages: [
      { role: 'system', content: 'warmup' },
      { role: 'user', content: 'warmup' },
      { role: 'tool', content: 'FILE warm.ts:\n' + code },
      { role: 'tool', content: '$ npm run build\n' + logs + '\nBuild succeeded.' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'ok' },
    ],
    model: 'claude-sonnet-4-5-20250929',
    config: { protect_recent: 2, target_ratio: 0.5 },
  });
  const req = http.request(
    { host: '127.0.0.1', port: _port, path: '/v1/compress', method: 'POST', timeout: 120_000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
    res => { res.resume(); res.on('end', () => Logger.info('[Headroom] Kompress model warmed.')); },
  );
  req.on('error', () => { /* warmup is best-effort */ });
  req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}

/** Best-effort, deterministic shutdown of the spawned sidecar. Releases the singleton lock we own. */
export function stopHeadroomProxy(): void {
  if (_child && !_child.killed) { try { _child.kill('SIGTERM'); } catch { /* ignore */ } }
  _child = null; _ready = false;
  if (_ownsLock) { releaseProxyLock(); _ownsLock = false; }
}

process.once('exit', stopHeadroomProxy);
process.once('SIGINT', () => { stopHeadroomProxy(); });
process.once('SIGTERM', () => { stopHeadroomProxy(); });
