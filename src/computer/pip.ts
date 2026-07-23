import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChildProcess, execFileSync, spawn } from 'child_process';
import { cliEvents } from '../cli/events';

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
  frames?: number;
  error?: string;
}

export interface LivePipPort {
  sync(target: LivePipTarget | null, enabled: boolean): void;
  stop(): Promise<void>;
  status(): LivePipStatus;
}

type DesiredPreview = { target: LivePipTarget | null; enabled: boolean; generation: number };

/**
 * Presentation-only native ScreenCaptureKit preview.
 *
 * This process never provides model pixels or input coordinates. The computer runtime keeps those
 * on its exact per-action PNG path; this helper filters directly to the owned window id and renders
 * the stream in an AppKit floating panel. Compile/spawn failures are isolated from computer actions.
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

  public sync(target: LivePipTarget | null, enabled: boolean): void {
    const clean = target && target.pid > 0 && target.windowId > 0 ? target : null;
    const key = clean ? `${clean.pid}:${clean.windowId}` : null;
    this.desired = { target: clean, enabled, generation: this.desired.generation + 1 };
    this.state = {
      ...this.state,
      enabled,
      captureSafe: !!clean,
      surface: clean?.label,
      error: undefined,
    };
    if (enabled && key && key === this.childKey && this.child && this.child.exitCode == null) return;
    void this.apply(this.desired);
  }

  public status(): LivePipStatus {
    return { ...this.state };
  }

  public async stop(): Promise<void> {
    this.desired = { target: null, enabled: false, generation: this.desired.generation + 1 };
    this.state = { enabled: false, running: false, continuous: true, captureSafe: false };
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
      stdio: ['ignore', 'pipe', 'pipe'],
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
