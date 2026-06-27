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
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { Logger } from '../utils/logger';

const PORT = Number(process.env.HEADROOM_PORT_OVERRIDE) || 8788; // 8788 to avoid clashing with a user-run :8787
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

export function isHeadroomReady(): boolean { return _ready; }

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

/** Locate a usable system python3 to bootstrap the venv from. Returns null if none. */
function findSystemPython(): string | null {
  for (const cand of ['python3', 'python']) {
    const r = spawnSync(cand, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim().startsWith('3')) return cand;
  }
  return null;
}

/** True once the venv has headroom-ai[proxy] importable. */
function venvProvisioned(): boolean {
  const py = venvBin('python');
  if (!fs.existsSync(py)) return false;
  const r = spawnSync(py, ['-c', 'import headroom, fastapi, onnxruntime'], { encoding: 'utf8' });
  return r.status === 0;
}

/** Create the venv and pip-install headroom-ai[proxy]. Slow (first run only). Returns success. */
function provisionVenv(): boolean {
  const sys = findSystemPython();
  if (!sys) { Logger.warn('[Headroom] no python3 found — cannot provision the Kompress proxy; staying on native compressor.'); return false; }
  fs.mkdirSync(homeDir(), { recursive: true });
  if (!fs.existsSync(venvBin('python'))) {
    Logger.info('[Headroom] creating Python venv for the Kompress proxy (vendor/headroom/venv)…');
    const v = spawnSync(sys, ['-m', 'venv', venvDir()], { encoding: 'utf8' });
    if (v.status !== 0) { Logger.warn(`[Headroom] venv creation failed: ${v.stderr || v.stdout}`); return false; }
  }
  Logger.info(`[Headroom] installing ${PIP_SPEC} (one-time, ~hundreds of MB)…`);
  const pip = spawnSync(venvBin('python'), ['-m', 'pip', 'install', '-q', '--upgrade', 'pip'], { encoding: 'utf8' });
  if (pip.status !== 0) Logger.warn(`[Headroom] pip self-upgrade warning: ${pip.stderr}`);
  const inst = spawnSync(venvBin('python'), ['-m', 'pip', 'install', '-q', PIP_SPEC], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (inst.status !== 0) { Logger.warn(`[Headroom] pip install failed: ${inst.stderr || inst.stdout}`); return false; }
  Logger.info('[Headroom] proxy dependencies installed.');
  return true;
}

function httpGetOk(pathname: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout: timeoutMs }, res => {
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
  const child = spawn(venvBin('headroom'), ['proxy', '--port', String(PORT), '--no-cache', '--no-rate-limit', '--no-ccr-inject-tool'], {
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
  // Respect a user-provided external proxy — don't spawn our own.
  if (process.env.HEADROOM_PROXY_URL && !process.env.HEADROOM_PROXY_URL.includes(`:${PORT}`)) { _ready = true; return true; }
  if (_ready) return true;
  if (_starting) return _starting;

  _starting = (async () => {
    try {
      if (!venvProvisioned() && !provisionVenv()) return false;

      // If our port is already serving (a prior session's sidecar), reuse it.
      if (!(await httpGetOk('/readyz', 800))) {
        _child = spawnProxy();
        if (!(await waitReady(60_000))) { Logger.warn('[Headroom] proxy did not become ready in time.'); return false; }
      }
      process.env.HEADROOM_PROXY_URL = `http://127.0.0.1:${PORT}`;
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
    { host: '127.0.0.1', port: PORT, path: '/v1/compress', method: 'POST', timeout: 120_000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
    res => { res.resume(); res.on('end', () => Logger.info('[Headroom] Kompress model warmed.')); },
  );
  req.on('error', () => { /* warmup is best-effort */ });
  req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}

/** Best-effort shutdown of the spawned sidecar. */
export function stopHeadroomProxy(): void {
  if (_child && !_child.killed) { try { _child.kill('SIGTERM'); } catch { /* ignore */ } }
  _child = null; _ready = false;
}

process.once('exit', stopHeadroomProxy);
process.once('SIGINT', () => { stopHeadroomProxy(); });
process.once('SIGTERM', () => { stopHeadroomProxy(); });
