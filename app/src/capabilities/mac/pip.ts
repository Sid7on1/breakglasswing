import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChildProcess, execFileSync, spawn } from 'child_process';
import { capabilityEvents as cliEvents } from './events';

export interface LivePipTarget {
  pid: number;
  windowId: number;
  label: string;
}

export interface LivePipStatus {
  enabled: boolean;
  running: boolean;
  continuous: boolean;
  captureSafe: boolean;
  surface?: string;
  /** Exact window the preview is DESIRED to show. */
  target?: { pid: number; windowId: number };
  frames?: number;
  error?: string;
  /** Measured preview throughput/latency from the capture process — absent until the first report. */
  stats?: {
    fps: number;
    latencyMsP50: number;
    latencyMsP95: number;
    /** Frames superseded before reaching the layer. Healthy at low rates; a rising share means the
     *  main thread cannot keep up with capture. */
    droppedStale: number;
    /** Frames skipped because the layer was not consuming (panel occluded/off-screen). */
    droppedNotReady: number;
    at: number;
  };
}

export interface LivePipPort {
  /** Resolves once the previous preview process is gone and the replacement has been started.
   * Callers that do not participate in an input-target switch may intentionally ignore it. */
  sync(target: LivePipTarget | null, enabled: boolean): void | Promise<void>;
  stop(): Promise<void>;
  status(): LivePipStatus;
  /** The preview process's pid, so a hit test can recognise the panel as the thing under a point. */
  pid?(): number | null;
  /** Ask the panel to move clear of this rectangle (global points, top-left origin). */
  avoid?(rect: { x: number; y: number; w: number; h: number }): void;
}

type DesiredPreview = { target: LivePipTarget | null; enabled: boolean; generation: number };

/**
 * Presentation-only native ScreenCaptureKit preview.
 *
 * This process never provides model pixels or input coordinates. The computer runtime keeps those
 * on its exact per-action precision path; this helper filters directly to the owned window id and
 * renders a clean content-first stream. Compile/spawn failures are isolated from computer actions.
 */
export class NativeLivePip implements LivePipPort {
  private desired: DesiredPreview = { target: null, enabled: false, generation: 0 };
  private child: ChildProcess | null = null;
  private childKey: string | null = null;
  private binaryPath: string | null | undefined;
  private state: LivePipStatus = {
    enabled: false,
    running: false,
    continuous: true,
    captureSafe: false,
  };

  public async sync(target: LivePipTarget | null, enabled: boolean): Promise<void> {
    const clean = target && target.pid > 0 && target.windowId > 0 ? target : null;
    const key = clean ? `${clean.pid}:${clean.windowId}` : null;
    this.desired = { target: clean, enabled, generation: this.desired.generation + 1 };
    this.state = {
      ...this.state,
      enabled,
      captureSafe: !!clean,
      surface: clean?.label,
      target: clean ? { pid: clean.pid, windowId: clean.windowId } : undefined,
      error: undefined,
    };
    if (enabled && key && key === this.childKey && this.child && this.child.exitCode == null) return;
    await this.apply(this.desired);
  }

  /** The preview process's pid — null when no panel is running. */
  public pid(): number | null {
    return this.child && this.child.exitCode == null ? (this.child.pid ?? null) : null;
  }

  /**
   * Ask the panel to step clear of `rect`.
   *
   * The panel floats above every application window and accepts mouse events, so any synthesized
   * click inside it is delivered to the panel instead of the app being driven. Moving it is the
   * only remedy: Apple documents floating windows as remaining above a raised window.
   */
  public avoid(rect: { x: number; y: number; w: number; h: number }): void {
    const child = this.child;
    if (!child || child.exitCode != null || !child.stdin?.writable) return;
    try { child.stdin.write(`avoid ${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.w)} ${Math.round(rect.h)}\n`); }
    catch { /* the preview is cosmetic; never fail an action because it would not move */ }
  }

  public status(): LivePipStatus {
    return { ...this.state };
  }

  public async stop(): Promise<void> {
    this.desired = { target: null, enabled: false, generation: this.desired.generation + 1 };
    this.state = { enabled: false, running: false, continuous: true, captureSafe: false, target: undefined };
    await this.stopChild();
  }

  private async apply(request: DesiredPreview): Promise<void> {
    if (!request.enabled || !request.target || process.platform !== 'darwin') {
      await this.stopChild();
      return;
    }

    const binary = this.resolveBinary();
    if (request.generation !== this.desired.generation) return;
    if (!binary) {
      this.state = {
        enabled: true,
        running: false,
        continuous: true,
        captureSafe: true,
        surface: request.target.label,
        target: { pid: request.target.pid, windowId: request.target.windowId },
        error: 'native ScreenCaptureKit PiP helper is unavailable',
      };
      cliEvents.emit('status', 'Continuous computer-use PiP is unavailable; desktop control remains active');
      return;
    }

    await this.stopChild();
    if (request.generation !== this.desired.generation) return;

    const target = request.target;
    const key = `${target.pid}:${target.windowId}`;
    const child = spawn(binary, [
      '--pid', String(target.pid),
      '--window-id', String(target.windowId),
      '--label', target.label,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.child = child;
    this.childKey = key;
    this.state = {
      enabled: true,
      running: false,
      continuous: true,
      captureSafe: true,
      surface: target.label,
      target: { pid: target.pid, windowId: target.windowId },
    };

    let stderr = '';
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-1000);
    });
    let stdout = '';
    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
      const lines = stdout.split('\n');
      stdout = lines.pop() || '';
      for (const line of lines) {
        let event: any;
        try { event = JSON.parse(line); } catch { continue; }
        if (this.child !== child || this.childKey !== key) return;
        if (event?.event === 'first_frame') {
          this.state = { ...this.state, running: true, frames: 1, error: undefined };
          cliEvents.emit('status', `Live PiP streaming ${target.label}`);
        } else if (event?.event === 'frame_progress' && Number(event.frames) > 0) {
          this.state = { ...this.state, running: true, frames: Number(event.frames), error: undefined };
        } else if (event?.event === 'pip_stats') {
          // Measured once a second by the capture process. Kept on the port so "the preview is
          // real-time" is a readable number rather than an assertion.
          this.state = {
            ...this.state, running: true, frames: Number(event.frames) || this.state.frames, error: undefined,
            stats: {
              fps: Number(event.fps) || 0,
              latencyMsP50: Number(event.latency_ms_p50) || 0,
              latencyMsP95: Number(event.latency_ms_p95) || 0,
              droppedStale: Number(event.dropped_stale) || 0,
              droppedNotReady: Number(event.dropped_not_ready) || 0,
              at: Date.now(),
            },
          };
        }
      }
    });
    child.once('error', error => {
      if (this.child !== child) return;
      this.child = null;
      this.childKey = null;
      this.state = { ...this.state, running: false, error: String(error.message || error).slice(0, 500) };
    });
    child.once('exit', code => {
      if (this.child !== child) return;
      this.child = null;
      this.childKey = null;
      if (request.generation !== this.desired.generation || !this.desired.enabled) return;
      const detail = stderr.trim() || `native PiP exited with code ${code ?? 'unknown'}`;
      this.state = { ...this.state, running: false, error: detail.slice(0, 500) };
      cliEvents.emit('status', `Continuous computer-use PiP stopped: ${detail.slice(0, 180)}`);
    });
  }

  private resolveBinary(): string | null {
    if (this.binaryPath !== undefined) return this.binaryPath;
    this.binaryPath = null;
    if (process.platform !== 'darwin') return null;

    const packaged = process.env.BIMAX_LIVE_PIP_HELPER?.trim();
    if (packaged) {
      if (fs.existsSync(packaged)) this.binaryPath = packaged;
      return this.binaryPath;
    }

    const source = [
      path.resolve(__dirname, '../../native/BimaxLivePip.swift'),
      path.resolve(__dirname, '../../../native/BimaxLivePip.swift'),
      path.resolve(process.cwd(), 'native/BimaxLivePip.swift'),
    ].find(candidate => fs.existsSync(candidate));
    if (!source) return null;

    try {
      const bytes = fs.readFileSync(source);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      const dir = path.join(os.homedir(), '.bimax', 'native');
      const binary = path.join(dir, `bimax-live-pip-${hash}`);
      if (!fs.existsSync(binary)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const moduleCache = path.join(os.tmpdir(), `bimax-swift-modules-${process.pid}`);
        fs.mkdirSync(moduleCache, { recursive: true });
        try {
          const cltSdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk';
          const sdkArgs = fs.existsSync(cltSdk) ? ['-sdk', cltSdk] : [];
          const architecture = process.arch === 'x64' ? 'x86_64' : 'arm64';
          execFileSync('xcrun', [
            'swiftc', '-O', '-parse-as-library', ...sdkArgs,
            '-target', `${architecture}-apple-macos12.3`,
            '-o', binary, source,
            '-framework', 'AppKit',
            '-framework', 'AVFoundation',
            '-framework', 'ScreenCaptureKit',
          ], {
            timeout: 120_000,
            stdio: 'pipe',
            env: {
              ...process.env,
              CLANG_MODULE_CACHE_PATH: moduleCache,
              SWIFT_MODULECACHE_PATH: moduleCache,
            },
          });
        } finally {
          fs.rmSync(moduleCache, { recursive: true, force: true });
        }
        fs.chmodSync(binary, 0o700);
      }
      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith('bimax-live-pip-') && file !== path.basename(binary)) {
          fs.rmSync(path.join(dir, file), { force: true });
        }
      }
      this.binaryPath = binary;
    } catch (error: any) {
      this.state = { ...this.state, error: String(error?.stderr || error?.message || error).slice(0, 500) };
    }
    return this.binaryPath;
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.childKey = null;
    this.state = { ...this.state, running: false };
    if (!child || child.exitCode != null) return;
    child.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (child.exitCode == null) child.kill('SIGKILL');
        resolve();
      }, 1000);
      timer.unref?.();
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
