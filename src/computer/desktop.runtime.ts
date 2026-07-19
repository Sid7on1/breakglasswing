import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { DESKTOP_HELPER_SOURCE, DESKTOP_HELPER_VERSION } from './helper.source';
import { openClient, isDeadConnectionError } from '../mcp/client';
import { withTimeout } from '../utils/withTimeout';
import { cliEvents } from '../cli/events';
import { loadConfig } from '../cli/config';
import { normalizedToPixel, screenshotToGlobal, elementCenterToScreenshot } from './coordinates';
import { SurfaceRegistry, ExecutionSurface, InputOwner, chooseMechanism, AutomationMechanism } from './surface';
import { DragMachine } from './drag';
import { pointInFrame } from './coordinates';
import { classifyVerification, VerificationResult } from './verification';
import { RecoveryController, RecoveryDecision } from './recovery';
import { ActionHistory, ActionHistorySummary, ComputerSessionState, sweepRecordings, writeSessionState, readSessionState } from './durability';

/**
 * Offline/development fallback for Bimax Computer Use.
 *
 * On macOS this is a small in-repo Swift helper (helper.source.ts), compiled once with the system
 * toolchain and cached under ~/.bimax/native by source hash. Degradation ladder when swiftc is
 * absent: cliclick → AppleScript System Events. On Linux the fallback is xdotool. Shipped builds
 * normally use BimaxComputerRuntime below, backed by the pinned native sidecar.
 *
 * Coordinate contract: everything is GLOBAL SCREEN POINTS. Retina screenshots are downscaled to
 * point resolution before the model sees them, so "click where the pixel is" is always correct.
 * click/move/drag/scroll also accept the 0–1000 normalized space VLMs emit (Gemini convention),
 * scaled against the main display.
 */

export type DesktopAction =
  | 'status' | 'request_access' | 'apps' | 'windows' | 'observe' | 'screenshot'
  | 'cursor' | 'frontmost' | 'open' | 'close' | 'move' | 'click' | 'drag'
  | 'scroll' | 'type' | 'key' | 'set_value' | 'wait'
  | 'hover' | 'hold' | 'mouse_down' | 'mouse_up'
  | 'record_start' | 'record_status' | 'record_stop';

export interface DesktopCommand {
  action: DesktopAction;
  x?: number; y?: number;
  toX?: number; toY?: number;
  dx?: number; dy?: number;
  button?: 'left' | 'right' | 'middle';
  modifier?: Array<'cmd' | 'shift' | 'alt' | 'ctrl' | 'fn'>;
  count?: number;
  text?: string;
  combo?: string;
  app?: string;
  bundleId?: string;
  pid?: number;
  windowId?: number;
  elementIndex?: number;
  elementToken?: string;
  query?: string;
  maxElements?: number;
  includeScreenshot?: boolean;
  value?: string;
  deliveryMode?: 'background' | 'foreground';
  session?: string;
  newInstance?: boolean;
  display?: number;
  ms?: number;
  /** Interpret coordinates in the 0–1000 normalized space and scale to the main display. */
  normalized?: boolean;
  /** Internal/manual smoke aid: ask the native driver to save a click crosshair image. */
  debugImageOut?: string;
  /** Backward-compatible no-op: screenshot pixels are first-class in the native runtime. */
  pixelFallback?: boolean;
  /** record_start: include a native ScreenCaptureKit/ffmpeg MP4 in addition to turn artifacts. */
  recordVideo?: boolean;
  /** record_start: optional output directory; defaults under .bimax/computer/recordings. */
  outputDir?: string;
}

export interface DesktopDisplay { index: number; width: number; height: number; scale: number; main: boolean }

export interface DesktopResult {
  ok: boolean;
  action: DesktopAction;
  driver: string;
  error?: string;
  screenshot?: string;
  width?: number; height?: number;
  /** Stable digest of captured pixels, used to measure actual visual progress. */
  frameHash?: string;
  /** The input landed, but the automatic post-action screenshot could not be captured. */
  visualEvidenceError?: string;
  /** Set when an app was opened but did not actually become frontmost — reported, never hidden. */
  frontmostWarning?: string;
  /** Typed verification of whether THIS action actually changed the screen (Stage 6): the runtime
   * judges the action by the fresh frame, not by the driver's success return. */
  progressCheck?: VerificationResult;
  /** Nudge attached after several consecutive no-effect actions — re-observe / retarget / wait. */
  recoveryHint?: string;
  /** The bounded recovery controller's decision for THIS action (Stage 6): continue / retry /
   * recover / escalate / stop-success / stop-failure. Once it latches stop-failure, the runtime
   * refuses further acting verbs until the agent re-observes. */
  recoveryDecision?: RecoveryDecision;
  screenWidth?: number; screenHeight?: number;
  x?: number; y?: number;
  app?: string;
  accessibility?: boolean | null;
  screenRecording?: boolean | null;
  displays?: DesktopDisplay[];
  pid?: number;
  windowId?: number;
  elements?: unknown[];
  tree?: string;
  degraded?: boolean;
  verification?: { query: string; matched: boolean; matchCount: number };
  recording?: { enabled: boolean; outputDir?: string; videoPath?: string; error?: string;
    /** What the recording captures (Stage 8): a specific agent window vs the whole display. */
    scope?: string;
    /** True when the recording is scoped to a capture-safe agent surface (no unrelated windows). */
    captureSafe?: boolean };
  details?: unknown;
  summary: string;
}

export interface DesktopRuntimePort {
  run(cmd: DesktopCommand, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<DesktopResult>;
  /** Cheap, non-spawning snapshot for the /computer hub: driver tier + last-known permissions. */
  quickStatus(): { driver: string; ready: boolean; accessibility: boolean | null; screenRecording: boolean | null };
  frontmostApp(): Promise<string>;
  /** Value-safe label/role for the fresh semantic handle an action is about to use. */
  describeTarget?(cmd: DesktopCommand): { label?: string; role?: string; value?: string } | null;
  dispose?(): Promise<void>;
  /** Best-effort: start any lazy cold-start work now so it overlaps with human decision time. */
  warm?(): void;
  /** The surface the agent is currently operating on (Stage 1), when the runtime tracks surfaces. */
  activeSurface?(): ExecutionSurface | null;
  /** User takeover (Stage 3): hand input to the user; acting verbs are refused until resume(). */
  pauseForUser?(): { ok: boolean; surface?: string };
  resume?(): { ok: boolean; surface?: string };
  /** Long-run durability (Stage 7): the bounded, compressed action history for this session. */
  history?(): ActionHistorySummary;
  /** Long-run durability (Stage 7): current bounded-state footprint (nothing accumulates unbounded). */
  memoryFootprint?(): { historyKept: number; observedElements: number; indexedElements: number; surfaces: number };
  /** PiP presentation status (Stage 2): enabled? which surface? is it capture-safe (window-scoped)? */
  pipStatus?(): Promise<{ enabled: boolean; surface?: string; captureSafe: boolean }>;
}

/** Pure: 0–1000 normalized → screen points (clamped). Retained name; the canonical implementation
 * now lives in the coordinate-transform layer (coordinates.ts) so all conversions share one audited
 * source. Still exported here for existing callers/tests. */
export const scaleNormalizedPoint = normalizedToPixel;

/** Read PNG IHDR dimensions without decoding the image. The native driver can report logical
 * macOS points alongside a Retina PNG; click coordinates must follow the actual PNG pixels. */
export function pngDimensionsFromBytes(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function exec(bin: string, args: string[], timeoutMs = 15_000, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, signal }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin} ${args[0] || ''}: ${String(stderr || err.message).trim().slice(0, 400)}`));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function binExists(name: string): boolean {
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(['/usr/bin', '/usr/sbin', '/opt/homebrew/bin', '/usr/local/bin']);
  return dirs.some(d => { try { fs.accessSync(path.join(d, name), fs.constants.X_OK); return true; } catch { return false; } });
}

const WAIT_MIN = 50, WAIT_MAX = 5000;

/** Keep .bimax/computer from growing unbounded during hours-long runs: this Mac's APFS gets
 * flaky under disk pressure, and screenshots are only evidence for the CURRENT few steps. */
export function sweepShots(dir: string, keep = 30): void {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
  } catch { /* hygiene is best-effort */ }
}

/** App names vary slightly between APIs ("Calculator" vs "Calculator.app"). */
export function appNamesMatch(actual: string, expected: string): boolean {
  const clean = (s: string) => s.trim().toLowerCase().replace(/\.app$/, '');
  return !!clean(actual) && clean(actual) === clean(expected);
}

export class DesktopRuntime implements DesktopRuntimePort {
  private helperPath: string | null | undefined; // undefined = not resolved yet, null = unavailable
  private lastStatus: { accessibility: boolean | null; screenRecording: boolean | null } = { accessibility: null, screenRecording: null };
  private displaysCache: DesktopDisplay[] | null = null;

  // ---- driver resolution ----------------------------------------------------------------------

  /** Compile (once) and return the Swift helper path, or null when the toolchain is unavailable. */
  private resolveHelper(): string | null {
    if (this.helperPath !== undefined) return this.helperPath;
    this.helperPath = null;
    if (process.platform !== 'darwin') return null;
    const override = process.env.BIMAX_DESKTOP_HELPER;
    if (override) { this.helperPath = fs.existsSync(override) ? override : null; return this.helperPath; }
    try {
      const hash = crypto.createHash('sha256').update(`${DESKTOP_HELPER_VERSION}\n${DESKTOP_HELPER_SOURCE}`).digest('hex').slice(0, 8);
      const dir = path.join(os.homedir(), '.bimax', 'native');
      const bin = path.join(dir, `bimax-desktop-${hash}`);
      if (fs.existsSync(bin)) { this.helperPath = bin; return bin; }
      if (!binExists('swiftc')) return null;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const src = path.join(dir, `bimax-desktop-${hash}.swift`);
      fs.writeFileSync(src, DESKTOP_HELPER_SOURCE, { mode: 0o600 });
      const { execFileSync } = require('child_process');
      execFileSync('swiftc', ['-O', '-o', bin, src], { timeout: 120_000, stdio: 'pipe' });
      fs.chmodSync(bin, 0o700);
      fs.rmSync(src, { force: true });
      // Sweep superseded builds so ~/.bimax/native never accumulates stale binaries.
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith('bimax-desktop-') && !f.includes(hash)) fs.rmSync(path.join(dir, f), { force: true });
      }
      this.helperPath = bin;
      return bin;
    } catch {
      this.helperPath = null;
      return null;
    }
  }

  private driverName(): string {
    if (process.platform === 'darwin') {
      if (this.resolveHelper()) return 'native-helper';
      if (binExists('cliclick')) return 'cliclick';
      return 'applescript';
    }
    if (process.platform === 'linux') return binExists('xdotool') ? 'xdotool' : 'unavailable';
    return 'unavailable';
  }

  public quickStatus() {
    // Never compiles: report the tier we WOULD use, plus permissions from the last real probe.
    let driver: string;
    if (process.platform === 'darwin') {
      if (this.helperPath) driver = 'native-helper';
      else if (this.helperPath === null && binExists('cliclick')) driver = 'cliclick';
      else if (this.helperPath === null) driver = 'applescript';
      else driver = binExists('swiftc') ? 'native-helper (compiles on first use)' : (binExists('cliclick') ? 'cliclick' : 'applescript');
    } else {
      driver = this.driverName();
    }
    return { driver, ready: driver !== 'unavailable', ...this.lastStatus };
  }

  private async helper(args: string[], signal?: AbortSignal, timeoutMs = 15_000): Promise<any> {
    const bin = this.resolveHelper();
    if (!bin) throw new Error('native helper unavailable');
    const { stdout } = await exec(bin, args, timeoutMs, signal);
    return JSON.parse(stdout.trim());
  }

  public async frontmostApp(): Promise<string> {
    try {
      if (process.platform === 'darwin') {
        if (this.resolveHelper()) return String((await this.helper(['frontmost'])).app || '');
        const { stdout } = await exec('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true']);
        return stdout.trim();
      }
      if (process.platform === 'linux' && binExists('xdotool')) {
        const { stdout } = await exec('xdotool', ['getactivewindow', 'getwindowname']);
        return stdout.trim();
      }
    } catch { /* observation is best-effort */ }
    return '';
  }

  private async waitForApp(app: string, shouldMatch: boolean, signal?: AbortSignal): Promise<string> {
    let actual = '';
    for (let i = 0; i < 20; i++) {
      if (signal?.aborted) throw new Error('desktop action aborted');
      actual = await this.frontmostApp();
      if (appNamesMatch(actual, app) === shouldMatch) return actual;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(shouldMatch
      ? `could not focus ${app}; frontmost app is ${actual || '(unknown)'}`
      : `${app} did not close; it is still frontmost`);
  }

  private async activateApp(app: string, signal?: AbortSignal): Promise<string> {
    if (!app.trim()) throw new Error('keyboard action needs an intended app; open the app first or pass app');
    if (process.platform === 'darwin') {
      await exec('open', ['-a', app.trim()], 20_000, signal);
      return this.waitForApp(app, true, signal);
    }
    if (process.platform === 'linux' && binExists('xdotool')) {
      const { stdout } = await exec('xdotool', ['search', '--name', app.trim()], 15_000, signal);
      const id = stdout.trim().split(/\s+/)[0];
      if (!id) throw new Error(`could not find a window for ${app}`);
      await exec('xdotool', ['windowactivate', '--sync', id], 15_000, signal);
      return this.frontmostApp();
    }
    throw new Error(`app activation is not supported on ${process.platform}`);
  }

  // ---- geometry -------------------------------------------------------------------------------

  private async displays(signal?: AbortSignal): Promise<DesktopDisplay[]> {
    if (this.displaysCache) return this.displaysCache;
    if (process.platform === 'darwin') {
      if (this.resolveHelper()) {
        const st = await this.helper(['status'], signal);
        this.lastStatus = { accessibility: !!st.accessibility, screenRecording: !!st.screenRecording };
        this.displaysCache = st.displays as DesktopDisplay[];
        return this.displaysCache!;
      }
      // Finder bounds used to trigger an unrelated Apple Events permission dialog that could cover
      // the very app being controlled. Probe a disposable OS screenshot instead. macOS captures
      // Retina displays at 2x; infer that common scale conservatively so screenshot pixels remain
      // aligned with global screen points even when the compiled helper is unavailable.
      const probe = path.join(os.tmpdir(), `bimax-display-${process.pid}-${Date.now()}.png`);
      try {
        await exec('/usr/sbin/screencapture', ['-x', '-D', '1', '-t', 'png', probe], 20_000, signal);
        const { stdout } = await exec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', probe], 15_000, signal);
        const pixelW = parseInt((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1] || '0', 10);
        const pixelH = parseInt((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1] || '0', 10);
        if (!pixelW || !pixelH) throw new Error('could not read fallback display dimensions');
        const scale = pixelW >= 2500 && pixelH >= 1400 ? 2 : 1;
        this.displaysCache = [{ index: 1, width: Math.round(pixelW / scale), height: Math.round(pixelH / scale), scale, main: true }];
      } finally {
        try { fs.rmSync(probe, { force: true }); } catch { /* disposable probe */ }
      }
      return this.displaysCache;
    }
    if (process.platform === 'linux' && binExists('xdotool')) {
      const { stdout } = await exec('xdotool', ['getdisplaygeometry'], 15_000, signal);
      const [w, h] = stdout.trim().split(/\s+/).map(n => parseInt(n, 10));
      this.displaysCache = [{ index: 1, width: w || 0, height: h || 0, scale: 1, main: true }];
      return this.displaysCache;
    }
    throw new Error('cannot determine display geometry on this platform');
  }

  private async denormalize(cmd: DesktopCommand, signal?: AbortSignal): Promise<DesktopCommand> {
    if (!cmd.normalized) return cmd;
    const main = (await this.displays(signal)).find(d => d.main) || (await this.displays(signal))[0];
    if (!main || !main.width || !main.height) throw new Error('normalized coordinates need a known main display');
    const out = { ...cmd };
    if (out.x != null) out.x = scaleNormalizedPoint(out.x, main.width);
    if (out.y != null) out.y = scaleNormalizedPoint(out.y, main.height);
    if (out.toX != null) out.toX = scaleNormalizedPoint(out.toX, main.width);
    if (out.toY != null) out.toY = scaleNormalizedPoint(out.toY, main.height);
    return out;
  }

  // ---- screenshot -----------------------------------------------------------------------------

  private async screenshot(cmd: DesktopCommand, cwd: string, signal?: AbortSignal): Promise<DesktopResult> {
    const dir = path.join(cwd, '.bimax', 'computer');
    fs.mkdirSync(dir, { recursive: true });
    sweepShots(dir);
    const file = path.join(dir, `shot-${Date.now()}.png`);
    const displayIndex = Math.max(1, Math.floor(cmd.display || 1));

    if (process.platform === 'darwin') {
      try {
        await exec('/usr/sbin/screencapture', ['-x', '-D', String(displayIndex), '-t', 'png', file], 20_000, signal);
      } catch (err: any) {
        // Without Screen Recording permission newer macOS refuses the capture outright.
        if (/could not create image/i.test(String(err?.message))) {
          throw new Error('screen capture refused — Screen Recording permission is missing. Run action=request_access, approve the terminal running BiMax in System Settings → Privacy & Security → Screen Recording, then retry.', { cause: err });
        }
        throw err;
      }
      let screenW = 0, screenH = 0;
      try {
        const all = await this.displays(signal);
        const d = all[displayIndex - 1] || all.find(x => x.main) || all[0];
        if (d) { screenW = d.width; screenH = d.height; }
      } catch { /* dims stay unknown; image ships at capture size */ }
      // Retina captures are 2x pixel size — downscale to POINT size so image coords == click coords.
      if (screenW > 0 && screenH > 0) {
        try {
          const { stdout } = await exec('sips', ['-g', 'pixelWidth', file], 15_000, signal);
          const pixelW = parseInt((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1] || '0', 10);
          if (pixelW > screenW) await exec('sips', ['-z', String(screenH), String(screenW), file], 20_000, signal);
        } catch { /* un-scaled screenshot is still usable */ }
      }
      const st = this.lastStatus;
      if (st.screenRecording === false) {
        return {
          ok: false, action: 'screenshot', driver: this.driverName(), screenshot: file,
          error: 'Screen Recording permission is not granted — the capture shows the wallpaper only. Run action=request_access, approve BiMax\'s terminal in System Settings → Privacy & Security → Screen Recording, then retry.',
          summary: 'screenshot blocked by missing Screen Recording permission',
        };
      }
      const app = await this.frontmostApp();
      return {
        ok: true, action: 'screenshot', driver: this.driverName(), screenshot: file,
        app: app || undefined,
        width: screenW || undefined, height: screenH || undefined,
        screenWidth: screenW || undefined, screenHeight: screenH || undefined,
        summary: `screenshot of display ${displayIndex}${app ? ` with ${app} frontmost` : ''} → ${path.relative(cwd, file)} (screen points${screenW ? ` ${screenW}×${screenH}` : ''})`,
      };
    }

    if (process.platform === 'linux') {
      const chain: Array<[string, string[]]> = [
        ['grim', [file]],
        ['gnome-screenshot', ['-f', file]],
        ['import', ['-window', 'root', file]],
        ['scrot', [file]],
      ];
      for (const [bin, args] of chain) {
        if (!binExists(bin)) continue;
        await exec(bin, args, 20_000, signal);
        return { ok: true, action: 'screenshot', driver: bin, screenshot: file, summary: `screenshot → ${path.relative(cwd, file)}` };
      }
      throw new Error('no screenshot tool found — install one of: grim, gnome-screenshot, imagemagick (import), scrot');
    }
    throw new Error(`screenshots are not supported on ${process.platform}`);
  }

  // ---- input drivers --------------------------------------------------------------------------

  private async runDarwin(cmd: DesktopCommand, signal?: AbortSignal): Promise<Partial<DesktopResult>> {
    const helper = this.resolveHelper();
    if (helper) {
      switch (cmd.action) {
        case 'status': {
          const st = await this.helper(['status'], signal);
          this.lastStatus = { accessibility: !!st.accessibility, screenRecording: !!st.screenRecording };
          this.displaysCache = st.displays;
          return { accessibility: st.accessibility, screenRecording: st.screenRecording, displays: st.displays, app: st.frontmost, summary: `driver native-helper · accessibility ${st.accessibility ? 'granted' : 'NOT granted'} · screen recording ${st.screenRecording ? 'granted' : 'NOT granted'}` };
        }
        case 'request_access': {
          const st = await this.helper(['request-access'], signal, 60_000);
          this.lastStatus = { accessibility: !!st.accessibility, screenRecording: !!st.screenRecording };
          return { accessibility: st.accessibility, screenRecording: st.screenRecording, summary: 'permission prompts triggered — approve in System Settings, then action=status to confirm' };
        }
        case 'cursor': { const r = await this.helper(['cursor'], signal); return { x: r.x, y: r.y, summary: `cursor at ${r.x},${r.y}` }; }
        case 'frontmost': { const r = await this.helper(['frontmost'], signal); return { app: r.app, summary: `frontmost app: ${r.app || '(unknown)'}` }; }
        case 'move': await this.helper(['move', String(cmd.x), String(cmd.y)], signal); return { summary: `moved to ${cmd.x},${cmd.y}` };
        case 'click': {
          const r = await this.helper(['click', String(cmd.x), String(cmd.y), cmd.button || 'left', String(cmd.count || 1), (cmd.modifier || []).join(',')], signal);
          return { app: r.app, summary: `${cmd.count === 2 ? 'double-' : cmd.count === 3 ? 'triple-' : ''}${cmd.button || 'left'} click at ${cmd.x},${cmd.y}${r.app ? ` in ${r.app}` : ''}` };
        }
        case 'drag': await this.helper(['drag', String(cmd.x), String(cmd.y), String(cmd.toX), String(cmd.toY)], signal); return { summary: `dragged ${cmd.x},${cmd.y} → ${cmd.toX},${cmd.toY}` };
        case 'hover': { const r = await this.helper(['hover', String(cmd.x), String(cmd.y), String(cmd.ms ?? 400)], signal); return { app: r.app, summary: `hovered at ${cmd.x},${cmd.y}${r.app ? ` in ${r.app}` : ''}` }; }
        case 'hold': { const r = await this.helper(['hold', String(cmd.x), String(cmd.y), String(cmd.ms ?? 800), cmd.button || 'left'], signal); return { app: r.app, summary: `${cmd.button || 'left'} click-and-hold ${cmd.ms ?? 800}ms at ${cmd.x},${cmd.y}` }; }
        case 'mouse_down': await this.helper(['mousedown', String(cmd.x), String(cmd.y), cmd.button || 'left'], signal); return { summary: `${cmd.button || 'left'} button down at ${cmd.x},${cmd.y}` };
        case 'mouse_up': await this.helper(['mouseup', String(cmd.x), String(cmd.y), cmd.button || 'left'], signal); return { summary: `${cmd.button || 'left'} button up at ${cmd.x},${cmd.y}` };
        case 'scroll': await this.helper(['scroll', String(cmd.x), String(cmd.y), String(cmd.dx || 0), String(cmd.dy || 0)], signal); return { summary: `scrolled (${cmd.dx || 0},${cmd.dy || 0}) at ${cmd.x},${cmd.y}` };
        case 'key': { const r = await this.helper(['key', cmd.combo || ''], signal); return { app: r.app, summary: `pressed ${cmd.combo}${r.app ? ` in ${r.app}` : ''}` }; }
        case 'type': {
          const r = await this.helper(['type', Buffer.from(cmd.text || '', 'utf8').toString('base64')], signal, 60_000);
          return { app: r.app, summary: `typed ${(cmd.text || '').length} chars${r.app ? ` into ${r.app}` : ''}` };
        }
      }
    }
    return this.runDarwinFallback(cmd, signal);
  }

  /** Degraded macOS path (no Xcode CLT): cliclick when present, else AppleScript System Events. */
  private async runDarwinFallback(cmd: DesktopCommand, signal?: AbortSignal): Promise<Partial<DesktopResult>> {
    const cli = binExists('cliclick');
    const osa = (script: string) => exec('osascript', ['-e', script], 30_000, signal);
    switch (cmd.action) {
      case 'status': {
        let displays: DesktopDisplay[] = [];
        try { displays = await this.displays(signal); } catch { /* status must still identify the usable fallback */ }
        return { accessibility: null, screenRecording: null, displays, summary: `driver ${cli ? 'cliclick' : 'applescript'} (degraded — native helper unavailable) · permissions verified by the first action` };
      }
      case 'request_access':
        // No CGRequest APIs without the helper: the first real action triggers the OS prompt.
        return { accessibility: null, screenRecording: null, summary: 'no native helper — macOS will prompt on the first real action instead' };
      case 'cursor': {
        if (cli) { const { stdout } = await exec('cliclick', ['p'], 15_000, signal); const m = stdout.match(/(\d+),(\d+)/); return { x: +(m?.[1] || 0), y: +(m?.[2] || 0), summary: `cursor at ${stdout.trim()}` }; }
        throw new Error('cursor position needs the native helper or cliclick');
      }
      case 'frontmost': { const app = await this.frontmostApp(); return { app, summary: `frontmost app: ${app || '(unknown)'}` }; }
      case 'move':
        if (cli) { await exec('cliclick', [`m:${cmd.x},${cmd.y}`], 15_000, signal); return { summary: `moved to ${cmd.x},${cmd.y}` }; }
        throw new Error('move needs the native helper or cliclick');
      case 'click': {
        if (cli) {
          const op = cmd.button === 'right' ? 'rc' : cmd.count === 3 ? 'tc' : cmd.count === 2 ? 'dc' : 'c';
          if (cmd.button === 'middle') throw new Error('middle click needs the native helper');
          await exec('cliclick', [`${op}:${cmd.x},${cmd.y}`], 15_000, signal);
        } else {
          if (cmd.button && cmd.button !== 'left') throw new Error(`${cmd.button} click needs the native helper or cliclick`);
          for (let i = 0; i < (cmd.count || 1); i++) await osa(`tell application "System Events" to click at {${cmd.x}, ${cmd.y}}`);
        }
        const app = await this.frontmostApp();
        return { app, summary: `${cmd.button || 'left'} click at ${cmd.x},${cmd.y}${app ? ` in ${app}` : ''}` };
      }
      case 'drag':
        if (cli) { await exec('cliclick', [`dd:${cmd.x},${cmd.y}`, 'w:120', `du:${cmd.toX},${cmd.toY}`], 20_000, signal); return { summary: `dragged ${cmd.x},${cmd.y} → ${cmd.toX},${cmd.toY}` }; }
        throw new Error('drag needs the native helper or cliclick');
      case 'hover':
        if (cli) { await exec('cliclick', [`m:${cmd.x},${cmd.y}`], 15_000, signal); return { summary: `hovered at ${cmd.x},${cmd.y}` }; }
        throw new Error('hover needs the native helper or cliclick');
      case 'hold':
        if (cli) { await exec('cliclick', [`dd:${cmd.x},${cmd.y}`, `w:${Math.max(50, Math.min(5000, cmd.ms ?? 800))}`, `du:${cmd.x},${cmd.y}`], 20_000, signal); return { summary: `click-and-hold at ${cmd.x},${cmd.y}` }; }
        throw new Error('hold needs the native helper or cliclick');
      case 'mouse_down':
        if (cli) { await exec('cliclick', [`dd:${cmd.x},${cmd.y}`], 15_000, signal); return { summary: `button down at ${cmd.x},${cmd.y}` }; }
        throw new Error('mouse_down needs the native helper or cliclick');
      case 'mouse_up':
        if (cli) { await exec('cliclick', [`du:${cmd.x},${cmd.y}`], 15_000, signal); return { summary: `button up at ${cmd.x},${cmd.y}` }; }
        throw new Error('mouse_up needs the native helper or cliclick');
      case 'scroll':
        throw new Error('scroll needs the native helper (install Xcode Command Line Tools: xcode-select --install)');
      case 'key': {
        const combo = (cmd.combo || '').toLowerCase();
        const mods = combo.split('+').slice(0, -1).map(m => ({ cmd: 'command', command: 'command', meta: 'command', shift: 'shift', alt: 'option', option: 'option', opt: 'option', ctrl: 'control', control: 'control' } as any)[m]).filter(Boolean);
        const keyName = combo.split('+').pop() || '';
        const codes: Record<string, number> = { return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121 };
        const using = mods.length ? ` using {${mods.map(m => `${m} down`).join(', ')}}` : '';
        if (codes[keyName] != null) await osa(`tell application "System Events" to key code ${codes[keyName]}${using}`);
        else if (keyName.length === 1) await osa(`tell application "System Events" to keystroke "${keyName.replace(/(["\\])/g, '\\$1')}"${using}`);
        else throw new Error(`key "${keyName}" needs the native helper`);
        return { app: await this.frontmostApp(), summary: `pressed ${cmd.combo}` };
      }
      case 'type':
        await osa(`tell application "System Events" to keystroke "${(cmd.text || '').replace(/([\\"])/g, '\\$1')}"`);
        return { app: await this.frontmostApp(), summary: `typed ${(cmd.text || '').length} chars` };
    }
    throw new Error(`unsupported action: ${cmd.action}`);
  }

  private async runLinux(cmd: DesktopCommand, signal?: AbortSignal): Promise<Partial<DesktopResult>> {
    if (!binExists('xdotool')) throw new Error('desktop control on Linux needs xdotool (and X11/XWayland)');
    const xdo = (args: string[]) => exec('xdotool', args, 20_000, signal);
    switch (cmd.action) {
      case 'status': { const displays = await this.displays(signal); return { accessibility: null, screenRecording: null, displays, summary: 'driver xdotool' }; }
      case 'request_access': return { summary: 'no permission model on X11 — actions work directly' };
      case 'cursor': { const { stdout } = await xdo(['getmouselocation']); const m = stdout.match(/x:(\d+)\s+y:(\d+)/); return { x: +(m?.[1] || 0), y: +(m?.[2] || 0), summary: `cursor at ${m?.[1]},${m?.[2]}` }; }
      case 'frontmost': { const app = await this.frontmostApp(); return { app, summary: `active window: ${app || '(unknown)'}` }; }
      case 'move': await xdo(['mousemove', String(cmd.x), String(cmd.y)]); return { summary: `moved to ${cmd.x},${cmd.y}` };
      case 'click': {
        const btn = cmd.button === 'right' ? '3' : cmd.button === 'middle' ? '2' : '1';
        await xdo(['mousemove', String(cmd.x), String(cmd.y), 'click', '--repeat', String(cmd.count || 1), btn]);
        const app = await this.frontmostApp();
        return { app, summary: `${cmd.button || 'left'} click at ${cmd.x},${cmd.y}${app ? ` in ${app}` : ''}` };
      }
      case 'drag':
        await xdo(['mousemove', String(cmd.x), String(cmd.y), 'mousedown', '1', 'mousemove', String(cmd.toX), String(cmd.toY), 'mouseup', '1']);
        return { summary: `dragged ${cmd.x},${cmd.y} → ${cmd.toX},${cmd.toY}` };
      case 'hover': await xdo(['mousemove', String(cmd.x), String(cmd.y)]); return { summary: `hovered at ${cmd.x},${cmd.y}` };
      case 'hold': {
        const btn = cmd.button === 'right' ? '3' : cmd.button === 'middle' ? '2' : '1';
        await xdo(['mousemove', String(cmd.x), String(cmd.y), 'mousedown', btn]);
        await new Promise(r => setTimeout(r, Math.max(50, Math.min(5000, cmd.ms ?? 800))));
        await xdo(['mouseup', btn]);
        return { summary: `click-and-hold at ${cmd.x},${cmd.y}` };
      }
      case 'mouse_down': await xdo(['mousemove', String(cmd.x), String(cmd.y), 'mousedown', cmd.button === 'right' ? '3' : '1']); return { summary: `button down at ${cmd.x},${cmd.y}` };
      case 'mouse_up': await xdo(['mousemove', String(cmd.x), String(cmd.y), 'mouseup', cmd.button === 'right' ? '3' : '1']); return { summary: `button up at ${cmd.x},${cmd.y}` };
      case 'scroll': {
        const notches = Math.max(1, Math.round(Math.abs(cmd.dy || 0) / 40));
        await xdo(['mousemove', String(cmd.x), String(cmd.y), 'click', '--repeat', String(notches), (cmd.dy || 0) > 0 ? '5' : '4']);
        return { summary: `scrolled ${(cmd.dy || 0) > 0 ? 'down' : 'up'} ${notches} notch(es)` };
      }
      case 'key': await xdo(['key', (cmd.combo || '').replace(/\bcmd\b|\bcommand\b|\bmeta\b/gi, 'super').replace(/\+/g, '+')]); return { app: await this.frontmostApp(), summary: `pressed ${cmd.combo}` };
      case 'type': await xdo(['type', '--delay', '12', cmd.text || '']); return { app: await this.frontmostApp(), summary: `typed ${(cmd.text || '').length} chars` };
    }
    throw new Error(`unsupported action: ${cmd.action}`);
  }

  // ---- entry ----------------------------------------------------------------------------------

  public async run(cmd: DesktopCommand, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<DesktopResult> {
    const cwd = ctx?.cwd || process.cwd();
    const driver = this.driverName();
    try {
      if (cmd.action === 'wait') {
        const ms = Math.max(WAIT_MIN, Math.min(WAIT_MAX, Math.floor(cmd.ms || 500)));
        await new Promise(r => setTimeout(r, ms));
        return { ok: true, action: 'wait', driver, summary: `waited ${ms}ms` };
      }
      if (cmd.action === 'open') {
        if (!cmd.app?.trim()) throw new Error('open needs app');
        if (process.platform === 'darwin') await exec('open', ['-a', cmd.app.trim()], 20_000, ctx?.signal);
        else if (process.platform === 'linux' && binExists('gtk-launch')) await exec('gtk-launch', [cmd.app.trim()], 20_000, ctx?.signal);
        else throw new Error(`open is not supported on ${process.platform}`);
        const app = await this.waitForApp(cmd.app.trim(), true, ctx?.signal);
        return { ok: true, action: 'open', driver, app, summary: `opened and focused ${app}` };
      }
      if (cmd.action === 'screenshot') return await this.screenshot(cmd, cwd, ctx?.signal);

      // Approval prompts and the TUI both run in Terminal and can steal focus. Restore focus only
      // after approval, immediately before native input, and refuse to report success on mismatch.
      if (cmd.action === 'type' || cmd.action === 'key' || cmd.action === 'close') {
        await this.activateApp(cmd.app || '', ctx?.signal);
      }

      if (cmd.action === 'close') {
        const partial = process.platform === 'darwin'
          ? await this.runDarwin({ action: 'key', combo: 'cmd+q', app: cmd.app }, ctx?.signal)
          : process.platform === 'linux'
            ? await this.runLinux({ action: 'key', combo: 'alt+f4', app: cmd.app }, ctx?.signal)
            : (() => { throw new Error(`desktop control is not supported on ${process.platform}`); })();
        await this.waitForApp(cmd.app || '', false, ctx?.signal);
        return { ok: true, action: 'close', driver: this.driverName(), ...partial, app: cmd.app, summary: `closed ${cmd.app}` };
      }

      const resolved = await this.denormalize(cmd, ctx?.signal);
      for (const field of ['x', 'y', 'toX', 'toY'] as const) {
        const v = resolved[field];
        if (v != null && (!Number.isFinite(v) || v < 0 || v > 20_000)) throw new Error(`${field} out of range: ${v}`);
      }
      const partial = process.platform === 'darwin'
        ? await this.runDarwin(resolved, ctx?.signal)
        : process.platform === 'linux'
          ? await this.runLinux(resolved, ctx?.signal)
          : (() => { throw new Error(`desktop control is not supported on ${process.platform}`); })();
      if ((cmd.action === 'type' || cmd.action === 'key') && cmd.app && !appNamesMatch(partial.app || '', cmd.app)) {
        throw new Error(`${cmd.action} went to ${partial.app || '(unknown app)'}, expected ${cmd.app}; no success was claimed`);
      }
      return { ok: true, action: cmd.action, driver: this.driverName(), summary: `${cmd.action} done`, ...partial };
    } catch (err: any) {
      return { ok: false, action: cmd.action, driver, error: String(err?.message || err).slice(0, 500), summary: `${cmd.action} failed` };
    }
  }
}

/** Replace upstream implementation names in anything that can reach the model or user. */
function bimaxBrand<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/cua-driver-rs/gi, 'Bimax Computer Use')
      .replace(/cua[ -]driver/gi, 'Bimax Computer Use') as T;
  }
  if (Array.isArray(value)) return value.map(bimaxBrand) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as any).map(([k, v]) => [k, bimaxBrand(v)])) as T;
  }
  return value;
}

function mcpText(result: any): string {
  return (result?.content || [])
    .filter((part: any) => part?.type === 'text')
    .map((part: any) => String(part.text || ''))
    .join('\n');
}

function mcpStructured(result: any): any {
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  const text = mcpText(result).replace(/^✅[^\n]*\n?/, '').trim();
  try { return JSON.parse(text); } catch { return text ? { message: text } : {}; }
}

interface ComputerTarget { app: string; pid: number; windowId?: number }

// Cold start (spawn the native sidecar + MCP handshake + start_session) and a steady-state RPC are
// different operations with different failure modes — a cold start doing real process/IPC work can
// legitimately take much longer than any single tool call. Budgeting them together made the FIRST
// gated action of a session race a clock that silently included both, so a slow-but-alive boot was
// indistinguishable from a hang. They now get separate, honestly-labeled budgets.
const COLD_START_TIMEOUT_MS = 45_000;
const RPC_TIMEOUT_MS = 30_000;

/**
 * Bimax Computer Use — a long-lived, private MCP connection to the embedded native sidecar.
 *
 * The sidecar is derived from trycua/cua 0.8.3 (MIT) but no Cua surface leaks into Bimax: the
 * executable path, session, tool schema, diagnostics, output and fallback are all Bimax-owned.
 * Keeping one live connection is essential because accessibility element tokens are scoped to the
 * observation that created them; spawning a process per action would silently discard that cache.
 */
export class BimaxComputerRuntime implements DesktopRuntimePort {
  private clientPromise: Promise<any> | null = null;
  private target: ComputerTarget | null = null;
  private indexedElements = new Map<string, { label?: string; role?: string; value?: string; description?: string; frame?: unknown; elementToken?: string; elementIndex?: number }>();
  private observedElements: Array<{ label?: string; role?: string; value?: string; description?: string; frame?: unknown; elementToken?: string; elementIndex?: number }> = [];
  private observedTarget: { pid: number; windowId?: number; degraded: boolean; width?: number; height?: number } | null = null;
  private observedWindowFrame: { x: number; y: number; w: number; h: number } | null = null;
  private recordingStarted = false;
  private recordingDir: string | undefined;
  private recordingError: string | undefined;
  /** What the current recording is scoped to and whether that scope is capture-safe (Stage 8). */
  private recordingScope: string | undefined;
  private recordingCaptureSafe: boolean | undefined;
  /** Which surfaces this session is operating on, who owns input, and which is active. Recorded
   * additively — Stage 1 of the surface architecture. Delivery routing still lives in run(). */
  private readonly surfaces = new SurfaceRegistry();
  private lastMechanismChoice: AutomationMechanism | null = null;
  /** Pixel digest of the most recent frame — the baseline the NEXT action's outcome is judged against. */
  private prevFrameHash: string | undefined;
  /** Consecutive no-effect actions, for runtime-level no-progress detection. */
  private noChangeStreak = 0;
  /** Bounded recovery authority (Stage 6): turns the per-action verification stream into a
   * continue/retry/recover/escalate/stop decision with hard budgets. When it latches stop-failure
   * the runtime refuses further acting verbs so a stuck agent stops thrashing instead of looping. */
  private readonly recovery = new RecoveryController();
  /** Bounded, compressed action log for durability + resume (Stage 7). */
  private actionHistory = new ActionHistory();
  /** Whether this process has already attempted a one-time resume from the persisted session file. */
  private resumedFromDisk = false;
  private activeAction = '';
  private lastCwd = process.cwd();
  private lastPersistAt = 0;
  /** Heartbeat: updated on every sidecar call so a watchdog can spot a wedged session. */
  private lastActivityAt = Date.now();
  private readonly session = `bimax-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  private lastStatus = { accessibility: null as boolean | null, screenRecording: null as boolean | null };

  public constructor(private readonly fallback: DesktopRuntimePort = new DesktopRuntime()) {}

  private driverPath(): string | null {
    const configured = process.env.BIMAX_COMPUTER_USE_DRIVER?.trim();
    return configured && fs.existsSync(configured) ? configured : null;
  }

  public quickStatus() {
    const path = this.driverPath();
    if (!path) return this.fallback.quickStatus();
    return { driver: 'bimax-computer-use 0.8.3', ready: true, ...this.lastStatus };
  }

  /** Record/refresh the active native-window surface from the current target + observed geometry.
   * Additive: this tracks WHAT the agent is operating on and who owns input; it does not change how
   * actions are delivered (that routing stays in run() until Stage 3 moves it behind chooseMechanism). */
  private syncSurface(opts: { focusOwner?: InputOwner } = {}): void {
    if (!this.target?.pid) return;
    this.surfaces.register({
      id: `native:${this.target.pid}`,
      kind: 'native-window',
      app: this.target.app || undefined,
      pid: this.target.pid,
      windowId: this.target.windowId,
      bounds: this.observedWindowFrame ? { ...this.observedWindowFrame } : undefined,
      ...(opts.focusOwner ? { focusOwner: opts.focusOwner } : {}),
    });
  }

  /** The surface the agent is currently operating on (native window, browser tab, …), or null. */
  public activeSurface(): ExecutionSurface | null { return this.surfaces.active(); }
  /** All surfaces tracked this session, for the /computer hub and PiP surface selection. */
  public surfaceSnapshot(): ExecutionSurface[] { return this.surfaces.all(); }
  /** The delivery mechanism chosen for the most recent acting verb, for observability/tests. */
  public lastMechanism(): AutomationMechanism | null { return this.lastMechanismChoice; }

  /** The capture-safe agent surface that recording/PiP should be scoped to (Stage 2 + 8): a native
   * window we can capture WITHOUT exposing unrelated windows. Returns null when the only thing to
   * capture is the whole desktop — the caller must then be honest that the capture is not scoped. */
  private captureSurface(): { pid: number; windowId: number; label: string } | null {
    const s = this.surfaces.active();
    if (s?.kind === 'native-window' && s.captureSafe && s.pid && s.windowId) {
      return { pid: s.pid, windowId: s.windowId, label: `${s.app || 'window'} window ${s.windowId}` };
    }
    return null;
  }

  /** PiP presentation status (Stage 2): whether the post-action preview is enabled, which surface it
   * reflects, and whether that surface is capture-safe (so a preview never mirrors the whole desktop). */
  public async pipStatus(): Promise<{ enabled: boolean; surface?: string; captureSafe: boolean }> {
    const enabled = (() => { try { return this.driverPath() != null; } catch { return false; } })()
      && (await loadConfig().catch(() => ({} as any))).computerPip !== false && process.platform === 'darwin';
    const scoped = this.captureSurface();
    return { enabled, surface: scoped?.label, captureSafe: !!scoped };
  }

  private sessionStateFile(cwd: string): string { return path.join(cwd, '.bimax', 'computer', 'session.json'); }

  /** Where the durable session state currently lives (active surface + compressed action history). */
  private buildSessionState(): ComputerSessionState {
    const s = this.surfaces.active();
    return {
      version: 1, updatedAt: Date.now(),
      surface: s ? { id: s.id, kind: s.kind, app: s.app, pid: s.pid, windowId: s.windowId, bounds: s.bounds, focusOwner: s.focusOwner } : null,
      history: this.actionHistory.summary(8),
      recordingDir: this.recordingDir,
    };
  }

  /** Record an acting verb into the bounded history and persist the session state (throttled). */
  private recordAction(action: string, app: string | undefined, outcome?: string): void {
    this.actionHistory.record(action, { app, outcome });
    const now = Date.now();
    if (now - this.lastPersistAt < 1500) return; // durable-but-throttled: at most ~1 write/1.5s
    this.lastPersistAt = now;
    try { writeSessionState(this.sessionStateFile(this.lastCwd), this.buildSessionState()); }
    catch { /* persistence is best-effort; a run must not fail because the disk is full */ }
  }

  /** Compressed action history for /computer, telemetry, and resume decisions. */
  public history(): ActionHistorySummary { return this.actionHistory.summary(); }
  /** The current durable session snapshot (active surface + history). */
  public sessionSummary(): ComputerSessionState { return this.buildSessionState(); }
  /** Reload a persisted session (active app/window + history) to resume after an interruption. */
  public loadPersistedState(cwd: string = process.cwd()): ComputerSessionState | null {
    return readSessionState(this.sessionStateFile(cwd));
  }

  /**
   * One-time resume: on the first `open` of a fresh process, if a persisted session for THIS app is
   * on disk, restore its bounded action history so an interrupted long run keeps its trajectory
   * count and no-change streak instead of silently starting over. Scoped deliberately narrow — we
   * restore only the compressed history, never the prior process's live pid/window (that would point
   * at a dead or reused process); the current `open` re-establishes the real surface itself.
   */
  private maybeResumeHistory(cwd: string): void {
    if (this.resumedFromDisk || this.actionHistory.total > 0) { this.resumedFromDisk = true; return; }
    this.resumedFromDisk = true;
    const persisted = readSessionState(this.sessionStateFile(cwd));
    const app = this.target?.app;
    if (!persisted?.surface || !app || persisted.surface.app !== app) return;
    this.actionHistory = ActionHistory.fromSummary(persisted.history);
    if (this.actionHistory.total > 0) {
      cliEvents.emit('status', `Resumed ${app} computer-use session — ${this.actionHistory.total} prior action${this.actionHistory.total === 1 ? '' : 's'} restored`);
    }
  }
  /** Watchdog view: is the sidecar connected, and how long since the last real activity? */
  public health(): { connected: boolean; idleMs: number; lastActivityAt: number } {
    return { connected: !!this.clientPromise, idleMs: Date.now() - this.lastActivityAt, lastActivityAt: this.lastActivityAt };
  }
  /** Cheap memory-footprint reporter — everything here is bounded; this surfaces the current sizes. */
  public memoryFootprint(): { historyKept: number; observedElements: number; indexedElements: number; surfaces: number } {
    return { historyKept: this.actionHistory.size, observedElements: this.observedElements.length, indexedElements: this.indexedElements.size, surfaces: this.surfaces.all().length };
  }

  /** User takeover: hand input ownership of the active surface to the user. While paused, acting
   * verbs are refused (the agent will not fight the human for the cursor) until resume() is called. */
  public pauseForUser(): { ok: boolean; surface?: string } {
    const s = this.surfaces.active();
    if (s) this.surfaces.update(s.id, { focusOwner: 'user' });
    cliEvents.emit('status', s
      ? `Computer use paused — you have control of ${s.app || 'the surface'}; the agent will not act until you resume`
      : 'Computer use paused — the agent will not act until you resume');
    return { ok: true, surface: s?.id };
  }

  /** Resume agent control of the active surface after a user takeover. */
  public resume(): { ok: boolean; surface?: string } {
    const s = this.surfaces.active();
    if (s) this.surfaces.claimInput(s.id, 'agent', { force: true });
    cliEvents.emit('status', 'Computer use resumed — the agent has control again');
    return { ok: true, surface: s?.id };
  }

  public describeTarget(cmd: DesktopCommand) {
    const key = cmd.elementToken ? `token:${cmd.elementToken}`
      : cmd.elementIndex != null ? `index:${Math.floor(cmd.elementIndex)}` : '';
    return key ? this.indexedElements.get(key) || null : null;
  }

  public async dispose(): Promise<void> {
    const pending = this.clientPromise;
    const wasRecording = this.recordingStarted;
    // Persist a final durable snapshot (active surface + compressed history) BEFORE tearing state
    // down, so an interrupted run can be resumed via loadPersistedState() on the next launch.
    try { writeSessionState(this.sessionStateFile(this.lastCwd), this.buildSessionState()); }
    catch { /* best-effort */ }
    this.clientPromise = null;
    // Session-scoped identity and observations must never leak into the next user turn. In
    // particular, closing the client is what removes the experimental PiP window.
    this.target = null;
    this.indexedElements.clear();
    this.observedElements = [];
    this.observedTarget = null;
    this.observedWindowFrame = null;
    this.recordingStarted = false;
    this.recordingDir = undefined;
    this.recordingError = undefined;
    this.recordingScope = undefined;
    this.recordingCaptureSafe = undefined;
    this.surfaces.clear();
    this.prevFrameHash = undefined;
    this.noChangeStreak = 0;
    this.recovery.reset();
    this.actionHistory.reset();
    this.resumedFromDisk = false; // a session ended; the next open may resume from disk again
    this.lastActivityAt = Date.now();
    this.lastPersistAt = 0;
    if (!pending) return;
    try {
      const client = await pending;
      if (wasRecording) {
        try { await client.callTool({ name: 'stop_recording', arguments: {} }); } catch { /* session teardown also finalizes */ }
      }
      await client.callTool({ name: 'end_session', arguments: { session: this.session } });
      await client.close?.();
    } catch { /* process teardown is best-effort */ }
  }

  /** Start (or join) the sidecar spawn/handshake without waiting on it — lets boot time overlap
   * with human read/decision time (e.g. an approval prompt) instead of starting after Enter. */
  public warm(): void {
    if (this.driverPath()) this.client().catch(() => { /* real error surfaces on the next call() */ });
  }

  private async client(): Promise<any> {
    const driver = this.driverPath();
    if (!driver) throw new Error('embedded Bimax Computer Use driver is unavailable');
    if (!this.clientPromise) {
      cliEvents.emit('status', 'Starting native driver…');
      // Every teardown below is identity-guarded (clientPromise === promise): a late failure or
      // close event from a SUPERSEDED connection must never destroy its healthy replacement —
      // unconditional nulling here would strand duplicate live sidecars behind a respawn loop.
      const promise: Promise<any> = withTimeout<any>((async () => {
        const cfg = await loadConfig();
        const driverArgs = ['mcp', '--embedded', '--host-bundle-id', 'ai.bimax.cli'];
        if (cfg.computerPip !== false && process.platform === 'darwin') driverArgs.push('--experimental-pip');
        const client = await openClient({
          name: 'bimax-computer-use',
          command: driver,
          args: driverArgs,
          forceScrubEnv: true,
          env: {
            CUA_DRIVER_EMBEDDED: '1',
            CUA_DRIVER_HOST_BUNDLE_ID: 'ai.bimax.cli',
            CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
            CUA_TELEMETRY_ENABLED: '0',
          },
        });
        await client.callTool({ name: 'start_session', arguments: { session: this.session } });
        // Cursor policy follows the delivery mode. VISIBLE mode drives the ONE real macOS cursor, so
        // the sidecar overlay is hidden (never two pointers). BACKGROUND mode (the OpenAI/ChatGPT
        // computer-use style: screenshot → pixel action → screenshot, delivered synthetically without
        // stealing focus) never moves the real cursor — so we SHOW the sidecar's own agent cursor so
        // the user can see where the agent is acting, including while they work in another window
        // (the PiP preview mirrors that same surface).
        const showAgentCursor = cfg.computerVisible === false;
        try {
          await client.callTool({
            name: 'set_agent_cursor_enabled',
            arguments: { enabled: showAgentCursor, cursor_id: this.session },
          });
        } catch { /* pinned driver supports this; older local overrides remain usable */ }
        return client;
      })(), COLD_START_TIMEOUT_MS, 'Bimax Computer Use driver start')
        .then(client => {
          // Detect a crashed/exited sidecar the moment it happens rather than waiting for the
          // next action to hang out a full RPC timeout before discovering the connection is dead.
          client.onclose = () => { if (this.clientPromise === promise) this.clientPromise = null; };
          cliEvents.emit('status', 'Native driver ready');
          return client;
        })
        .catch(err => {
          if (this.clientPromise === promise) this.clientPromise = null;
          throw err;
        });
      this.clientPromise = promise;
    }
    return this.clientPromise;
  }

  private async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const promise = this.client();
    const client = await promise;
    this.lastActivityAt = Date.now(); // heartbeat
    cliEvents.emit('status', `Running ${name}…`);
    const result = await withTimeout<any>(
      client.callTool({ name, arguments: args }),
      RPC_TIMEOUT_MS,
      `Bimax Computer Use '${name}'`,
    ).catch((err: any) => {
      // A wedged/crashed sidecar leaves clientPromise resolved-but-dead, and nothing else clears
      // it — but only a dead transport or our own timeout condemns the CONNECTION. An app-level
      // RPC rejection from a healthy sidecar must not cost the whole session (element caches,
      // plus a fresh cold start) on the next action.
      if (isDeadConnectionError(err) || String(err?.message || '').includes('timed out after')) {
        if (this.clientPromise === promise) this.clientPromise = null;
        // Close the condemned client: a timed-out action could otherwise still land on the
        // user's desktop later, unsupervised, and an unclosed client leaks the sidecar process.
        try { Promise.resolve(client.close?.()).catch(() => { /* best-effort teardown */ }); }
        catch { /* best-effort teardown */ }
      }
      throw err;
    });
    const data = bimaxBrand(mcpStructured(result));
    if (result?.isError) {
      const detail = bimaxBrand(mcpText(result)).trim();
      throw new Error(detail || `${name} failed`);
    }
    return data;
  }

  /** Delivery mode for acting verbs: an explicit request wins; otherwise the user's visibility
   * preference decides — visible (default) delivers in the foreground so the real cursor moves
   * and the user can watch the work; invisible keeps the old background delivery. */
  private async defaultDelivery(cmd: DesktopCommand): Promise<'background' | 'foreground'> {
    if (cmd.deliveryMode) return cmd.deliveryMode;
    try { return (await loadConfig()).computerVisible !== false ? 'foreground' : 'background'; }
    catch { return 'background'; }
  }

  private defaultRecordingDir(cwd: string): string {
    const root = path.join(cwd, '.bimax', 'computer', 'recordings');
    fs.mkdirSync(root, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(root, `run-${stamp}-${process.pid}`);
  }

  private async startRecording(cwd: string, outputDir?: string, recordVideo = true): Promise<any> {
    if (this.recordingStarted) return { enabled: true, output_dir: this.recordingDir };
    // Bound recording storage before adding another run — hours-long sessions must not fill the disk.
    sweepRecordings(path.join(cwd, '.bimax', 'computer', 'recordings'), { keepRuns: 5 });
    const dir = path.resolve(outputDir || this.defaultRecordingDir(cwd));
    fs.mkdirSync(dir, { recursive: true });
    // Stage 8: scope the capture to the agent's own window when one exists, so an hours-long
    // recording never silently mirrors unrelated windows. Passing pid/window_id is best-effort — a
    // driver that ignores them still records the display — so the scope/captureSafe we report is the
    // TRUTH about what was requested, and captureSafe is false whenever we fall back to whole-display.
    const scoped = this.captureSurface();
    this.recordingScope = scoped ? scoped.label : 'whole display';
    this.recordingCaptureSafe = !!scoped;
    try {
      const data = await this.call('start_recording', {
        output_dir: dir, record_video: recordVideo,
        ...(scoped ? { pid: scoped.pid, window_id: scoped.windowId } : {}),
      });
      this.recordingStarted = true;
      this.recordingDir = dir;
      this.recordingError = undefined;
      return data;
    } catch (err: any) {
      this.recordingError = bimaxBrand(String(err?.message || err)).slice(0, 500);
      throw err;
    }
  }

  private async ensureAutoRecording(cwd: string): Promise<void> {
    if (this.recordingStarted || this.recordingError) return;
    try {
      if ((await loadConfig()).computerRecord !== false) await this.startRecording(cwd, undefined, true);
    } catch (err: any) {
      cliEvents.emit('status', `Screen recording unavailable: ${bimaxBrand(String(err?.message || err)).slice(0, 160)}`);
    }
  }

  private resolveObservedElement(query: string, target: ComputerTarget): { elementToken?: string; elementIndex?: number; label?: string; role?: string; frame?: unknown } {
    if (!this.observedTarget || this.observedTarget.pid !== target.pid || this.observedTarget.windowId !== target.windowId) {
      throw new Error('semantic click needs a fresh observe of the current window');
    }
    const clean = (value: unknown) => String(value || '').trim().toLocaleLowerCase();
    const needle = clean(query);
    if (!needle) throw new Error('semantic click query cannot be empty');
    const score = (element: typeof this.observedElements[number]): number => {
      const fields = [element.label, element.value, element.description].map(clean).filter(Boolean);
      if (fields.some(value => value === needle)) return 0;
      if (fields.some(value => value.startsWith(needle))) return 1;
      if (fields.some(value => value.includes(needle))) return 2;
      return 99;
    };
    const candidates = this.observedElements
      .map(element => ({ element, score: score(element) }))
      .filter(candidate => candidate.score < 99)
      .sort((a, b) => a.score - b.score || Number(a.element.elementIndex || 0) - Number(b.element.elementIndex || 0));
    if (candidates.length === 0) {
      const labels = this.observedElements.map(element => element.label).filter(Boolean).slice(0, 12).join(', ');
      throw new Error(`no semantic element matched "${query}"${labels ? `; visible labels include: ${labels}` : ''}`);
    }
    const best = candidates.filter(candidate => candidate.score === candidates[0].score);
    const unique = new Map<string, typeof best[number]>();
    for (const candidate of best) {
      const key = `${clean(candidate.element.label)}|${JSON.stringify(candidate.element.frame || '')}`;
      if (!unique.has(key)) unique.set(key, candidate);
    }
    if (unique.size > 1) {
      const choices = Array.from(unique.values()).slice(0, 6)
        .map(candidate => `${candidate.element.role || 'element'} "${candidate.element.label || candidate.element.value || '?'}"`)
        .join(', ');
      throw new Error(`semantic click query "${query}" is ambiguous: ${choices}; observe with a narrower query`);
    }
    return Array.from(unique.values())[0].element;
  }

  private elementCenterInScreenshot(frame: unknown): { x: number; y: number } | null {
    const f = frame as any;
    const w = this.observedWindowFrame;
    const shot = this.observedTarget;
    if (!f || !w || !shot?.width || !shot?.height || !w.w || !w.h) return null;
    return elementCenterToScreenshot(
      { x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h) },
      { width: shot.width, height: shot.height }, w,
    );
  }

  private screenshotPixelToGlobalPoint(point: { x: number; y: number }): { x: number; y: number } | null {
    const shot = this.observedTarget;
    const frame = this.observedWindowFrame;
    if (!shot?.width || !shot?.height || !frame?.w || !frame?.h) return null;
    return screenshotToGlobal(point, { width: shot.width, height: shot.height }, frame);
  }

  /** Map a screenshot-pixel point (the space the model chose from) to a global screen point for the
   * current window, refusing points not grounded in the latest image. Shared by click and the new
   * pointer primitives so they all obey the same "must be on the newest screen" contract. */
  private groundScreenshotPoint(target: ComputerTarget, cmd: Pick<DesktopCommand, 'x' | 'y' | 'normalized'>, verb: string): { x: number; y: number } {
    if (cmd.x == null || cmd.y == null) throw new Error(`${verb} needs x and y`);
    if (!this.observedTarget || this.observedTarget.pid !== target.pid || this.observedTarget.windowId !== target.windowId) {
      throw new Error(`${verb} needs a fresh image of this exact window; observe once, then act on the visible point`);
    }
    const width = this.observedTarget.width, height = this.observedTarget.height;
    if (!width || !height) throw new Error('latest screenshot has no usable dimensions');
    const x = cmd.normalized ? normalizedToPixel(cmd.x, width - 1) : Math.round(cmd.x);
    const y = cmd.normalized ? normalizedToPixel(cmd.y, height - 1) : Math.round(cmd.y);
    if (x < 0 || y < 0 || x >= width || y >= height) throw new Error(`${verb} point ${x},${y} is outside the latest image (${width}x${height})`);
    const global = this.screenshotPixelToGlobalPoint({ x, y });
    if (!global) throw new Error(`${verb} could not map the point to the screen`);
    return global;
  }

  /** hover/hold/mouse_down/mouse_up: physical-cursor primitives delivered by the native helper after
   * bringing the target window to front. These ARE the real cursor, so they only run foreground. */
  private async pointerPrimitive(
    primitive: 'hover' | 'hold' | 'mouse_down' | 'mouse_up', target: ComputerTarget, cmd: DesktopCommand,
    cwd: string, session: string, ctx?: { cwd?: string; signal?: AbortSignal },
  ): Promise<DesktopResult> {
    const driver = 'bimax-computer-use 0.8.3';
    const global = this.groundScreenshotPoint(target, cmd, primitive);
    await this.call('bring_to_front', { pid: target.pid, window_id: target.windowId });
    await new Promise(resolve => setTimeout(resolve, 80));
    const native = await this.fallback.run({ action: primitive, x: global.x, y: global.y, button: cmd.button, ms: cmd.ms, app: target.app, normalized: false }, ctx);
    if (!native.ok) throw new Error(native.error || native.summary);
    // A bare mouse_down leaves the button physically held; do NOT capture a settling screenshot that
    // could itself move focus. hover/hold/mouse_up have completed a gesture, so fresh evidence is safe.
    // mouse_down leaves the button held and skips a settling screenshot, so it never reaches
    // postActionEvidence — record it here so a held-button state still lands in the durable history.
    if (primitive === 'mouse_down') this.recordAction('mouse_down', target.app, 'unverified');
    const evidence = primitive === 'mouse_down' ? {} : await this.postActionEvidence(target, cwd, session);
    return {
      ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
      details: { path: 'native-global-cgevent', primitive, at: global }, ...evidence,
      summary: `visible native ${primitive.replace('_', '-')} delivered to ${target.app || `pid ${target.pid}`}${primitive === 'mouse_down' ? ' (button held — issue mouse_up to release)' : '; fresh screen attached'}`,
    };
  }

  private targetFor(cmd: DesktopCommand): ComputerTarget | null {
    // Once open() establishes a target, that identity is runtime-owned until close/open changes it.
    // Models routinely repeat ids from older observations; trusting those ids ahead of this.target
    // sent System Settings actions from freshly-opened window 5151 back to stale window 5142.
    // A different app must be opened explicitly so the governor and the runtime agree on the input
    // recipient. `windows` remains a read-only escape hatch for inspecting another explicit pid.
    if (this.target && cmd.action !== 'open') {
      if (cmd.action === 'windows' && cmd.pid && Number(cmd.pid) !== this.target.pid) {
        return { app: cmd.app?.trim() || '', pid: Number(cmd.pid), windowId: Number(cmd.windowId || 0) || undefined };
      }
      if (cmd.app?.trim() && !appNamesMatch(cmd.app, this.target.app)) {
        throw new Error(`target app mismatch: ${this.target.app} is active; open ${cmd.app.trim()} before controlling it`);
      }
      return { ...this.target };
    }
    const pid = Number(cmd.pid || 0);
    if (!pid) return null;
    return {
      app: cmd.app?.trim() || '',
      pid,
      windowId: Number(cmd.windowId || 0) || undefined,
    };
  }

  private screenshotPath(cwd: string): string {
    const dir = path.join(cwd, '.bimax', 'computer');
    fs.mkdirSync(dir, { recursive: true });
    sweepShots(dir);
    return path.join(dir, `window-${Date.now()}.png`);
  }

  private screenshotHash(file: string): string | undefined {
    try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16); }
    catch { return undefined; }
  }

  /** One capture path for explicit observes and automatic post-action evidence. Keeping the AX
   * cache and the PNG from the same native call prevents coordinates from being applied to a
   * different frame than the one the model saw. */
  private async observeTarget(
    target: ComputerTarget,
    cwd: string,
    session: string,
    cmd: Pick<DesktopCommand, 'action' | 'query' | 'maxElements' | 'includeScreenshot'>,
  ): Promise<DesktopResult> {
    if (!target.windowId) throw new Error('observe needs pid + windowId; open or select an application window first');
    const screenshot = this.screenshotPath(cwd);
    const maxElements = Math.max(1, Math.min(2000, Math.floor(cmd.maxElements ?? 60)));
    // macOS exposes the application menu tree alongside the window. Traverse deeply, then remove
    // menu boilerplate and apply the small model-visible budget below.
    const scanElements = Math.max(1000, maxElements);
    const data = await this.call('get_window_state', {
      pid: target.pid,
      window_id: target.windowId,
      session,
      include_screenshot: cmd.includeScreenshot !== false,
      screenshot_out_file: screenshot,
      ...(cmd.query ? { query: cmd.query } : {}),
      max_elements: scanElements,
    });
    const screenshotFile = String(data?.screenshot_file_path || screenshot);
    let pngDimensions: { width: number; height: number } | null = null;
    if (cmd.includeScreenshot !== false) {
      try { pngDimensions = pngDimensionsFromBytes(fs.readFileSync(screenshotFile)); }
      catch { /* the visual-evidence checks below surface an absent screenshot */ }
    }
    const screenshotWidth = pngDimensions?.width || Number(data?.screenshot_width || 0) || undefined;
    const screenshotHeight = pngDimensions?.height || Number(data?.screenshot_height || 0) || undefined;
    const rawElements = Array.isArray(data?.elements) ? data.elements : [];
    const menuRoles = new Set(['AXMenuBar', 'AXMenuBarItem', 'AXMenu', 'AXMenuItem']);
    const windowElements = rawElements.filter((element: any) => !menuRoles.has(String(element?.role || '')));
    const degraded = windowElements.length === 0;
    this.indexedElements.clear();
    this.observedElements = [];
    for (const element of rawElements as any[]) {
      const safe = {
        label: element?.label, role: element?.role, value: element?.value,
        description: element?.description, frame: element?.frame,
        elementToken: element?.element_token ? String(element.element_token) : undefined,
        elementIndex: element?.element_index != null ? Number(element.element_index) : undefined,
      };
      if (element?.element_token) this.indexedElements.set(`token:${element.element_token}`, safe);
      if (element?.element_index != null) this.indexedElements.set(`index:${Number(element.element_index)}`, safe);
      if (!menuRoles.has(String(element?.role || ''))) this.observedElements.push(safe);
    }
    this.observedTarget = {
      pid: target.pid, windowId: target.windowId, degraded,
      width: screenshotWidth,
      height: screenshotHeight,
    };
    const windowFrame = windowElements.find((element: any) => String(element?.role || '') === 'AXWindow')?.frame;
    this.observedWindowFrame = windowFrame && Number(windowFrame.w) > 0 && Number(windowFrame.h) > 0
      ? { x: Number(windowFrame.x), y: Number(windowFrame.y), w: Number(windowFrame.w), h: Number(windowFrame.h) }
      : null;

    const verificationQuery = cmd.query?.trim() || '';
    const queryNeedle = verificationQuery.toLocaleLowerCase();
    const matchesQuery = (element: any) => !!queryNeedle
      && JSON.stringify(element).toLocaleLowerCase().includes(queryNeedle);
    const semanticMatches = queryNeedle ? windowElements.filter(matchesQuery) : [];
    const orderedElements = semanticMatches.length > 0
      ? [...semanticMatches, ...windowElements.filter((element: any) => !matchesQuery(element))]
      : (windowElements.length > 0 ? windowElements : rawElements);
    const elements = orderedElements.slice(0, maxElements).map((element: any) => {
      const compact: Record<string, unknown> = {};
      for (const key of ['element_index', 'element_token', 'role', 'label', 'value', 'description', 'enabled', 'focused', 'frame']) {
        if (element?.[key] !== undefined && element?.[key] !== null && element?.[key] !== '') compact[key] = element[key];
      }
      return compact;
    });
    const treeLines = String(data?.tree_markdown || '').split('\n');
    const tree = treeLines.length > 120
      ? `${treeLines.slice(0, 120).join('\n')}\n… ${treeLines.length - 120} more tree lines omitted; observe with query for a narrower view`
      : treeLines.join('\n');
    const matchCount = semanticMatches.length;
    const verification = verificationQuery
      ? { query: verificationQuery, matched: matchCount > 0, matchCount }
      : undefined;
    // Refresh the surface's bounds from the geometry we just observed, so window moves/resizes keep
    // the tracked surface (and any PiP built on it) aligned with the real window.
    if (this.target?.pid === target.pid) this.syncSurface();
    const frameHash = cmd.includeScreenshot === false ? undefined : this.screenshotHash(screenshotFile);
    // Any fresh frame becomes the baseline the next action's outcome is judged against.
    if (frameHash) this.prevFrameHash = frameHash;
    return {
      ok: true, action: cmd.action === 'screenshot' ? 'screenshot' : 'observe', driver: 'bimax-computer-use 0.8.3',
      app: target.app, pid: target.pid, windowId: target.windowId,
      screenshot: screenshotFile, frameHash,
      width: screenshotWidth, height: screenshotHeight,
      elements, tree, degraded, verification,
      summary: verification
        ? `observed ${target.app || `pid ${target.pid}`} window ${target.windowId}: verification query "${verificationQuery}" ${verification.matched ? `matched ${matchCount} semantic element${matchCount === 1 ? '' : 's'}` : 'was not found in native text; inspect the attached screenshot before deciding whether the state is complete'}`
        : degraded
          ? `observed ${target.app || `pid ${target.pid}`} window ${target.windowId}: native text is degraded; use the attached screenshot as the source of truth`
          : `observed ${target.app || `pid ${target.pid}`} window ${target.windowId}: fresh screenshot + ${elements.length} optional native targets`,
    };
  }

  /** OpenAI-style action loop: every delivered input immediately yields the next pixels. This saves
   * an entire model/tool round per step and makes a stale screenshot impossible to reuse silently. */
  private async postActionEvidence(target: ComputerTarget, cwd: string, session: string): Promise<Partial<DesktopResult>> {
    try {
      // Actions such as Cmd+N and info buttons can create a document window or sheet. Reacquire the
      // visible window before capture; otherwise a launch-time 33px menu proxy remains pinned and
      // every later screenshot is a black strip even though the real document is on screen.
      const refreshed = await this.refreshTargetWindow(target);
      if (this.target?.pid === target.pid) this.target = refreshed;
      // Capture the pre-action baseline BEFORE observeTarget overwrites it with the fresh frame.
      const prev = this.prevFrameHash;
      const observed = await this.observeTarget(refreshed, cwd, session, { action: 'observe', maxElements: 24 });
      // Judge the action by the SCREEN, not by the driver's success return (Stage 6).
      const progressCheck = classifyVerification({
        ok: true, prevFrameHash: prev, nextFrameHash: observed.frameHash,
        hadScreenshot: !!observed.screenshot,
        expectedApp: target.app || undefined, actualApp: observed.app || undefined,
        targetWindowId: refreshed.windowId, actualWindowId: observed.windowId,
      });
      if (progressCheck.outcome === 'no-change') this.noChangeStreak++; else this.noChangeStreak = 0;
      // Durable, bounded record of what the agent did and whether it worked (Stage 7).
      this.recordAction(this.activeAction || 'action', target.app, progressCheck.outcome);
      // Feed the outcome to the bounded recovery authority (Stage 6). Its decision is surfaced to the
      // model, and once it latches stop-failure the run() guard refuses further acting verbs.
      const recoveryDecision = this.recovery.record(progressCheck.outcome);
      const recoveryHint = recoveryDecision === 'stop-failure'
        ? `no visible progress after repeated attempts — stopping to avoid a loop; re-observe (screenshot/observe) and target a different element, or ask the user`
        : recoveryDecision === 'escalate'
          ? `cheap recovery options are exhausted — re-observe and try a clearly different approach, or ask the user before continuing`
          : this.noChangeStreak >= 3
            ? `${this.noChangeStreak} consecutive actions produced no visible change — re-observe, target a different element, or wait for the UI to update instead of repeating the same action`
            : undefined;
      return {
        screenshot: observed.screenshot, frameHash: observed.frameHash,
        width: observed.width, height: observed.height,
        elements: observed.elements, degraded: observed.degraded, windowId: refreshed.windowId,
        progressCheck, recoveryDecision, ...(recoveryHint ? { recoveryHint } : {}),
      };
    } catch (err: any) {
      return { visualEvidenceError: bimaxBrand(String(err?.message || err)).slice(0, 500) };
    }
  }

  private async refreshTargetWindow(target: ComputerTarget): Promise<ComputerTarget> {
    // A freshly created/activated window (e.g. Finder's Desktop window, a new document) briefly
    // reports a toolbar-only STRIP — full width but ~35px tall — before its content renders. Capturing
    // that strip gives the model a screenshot no click can be mapped against (the live "1559×35" bug).
    // Poll briefly for a properly-sized window instead of pinning the strip. A window already rendered
    // is found on the first attempt with no delay; only the not-yet-drawn case pays the wait.
    let windows: any[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const data = await this.call('list_windows', { pid: target.pid });
      windows = Array.isArray(data?.windows) ? data.windows : [];
      const visible = windows.filter((w: any) => w?.is_on_screen !== false
        && Number(w?.bounds?.width || 0) > 100 && Number(w?.bounds?.height || 0) > 100);
      if (visible.length > 0) {
        const good = visible.find((w: any) => Number(w.window_id) === target.windowId) || visible[0];
        return { ...target, windowId: Number(good?.window_id || 0) || target.windowId };
      }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1))); // let it finish rendering
    }
    // Still nothing properly sized after retrying — keep the CURRENT window id rather than pin a
    // degenerate strip; a slightly stale-but-real window captures better than a 35px menu-bar proxy.
    if (windows.length === 0 || target.windowId) return target;
    return { ...target, windowId: Number(windows[0]?.window_id || 0) || target.windowId };
  }

  /** Resolve a human app name for a pid from the sidecar's app list. launch_app sometimes returns
   * an empty or bundle-id-looking name; without this the model and the user saw "opened ?". */
  private async resolveAppName(pid: number, fallback: string): Promise<string> {
    const looksLikeBundleId = (s: string) => /^[a-z0-9_-]+(\.[a-z0-9_-]+){1,}$/i.test(s);
    const clean = fallback.trim();
    if (clean && clean !== '?' && !looksLikeBundleId(clean)) return clean;
    try {
      const data = await this.call('list_apps');
      const apps = Array.isArray(data?.apps) ? data.apps : [];
      const name = String(apps.find((a: any) => Number(a?.pid) === pid)?.name || '').trim();
      if (name) return name;
    } catch { /* best-effort — keep the fallback */ }
    return clean;
  }

  /** Best-effort truth check for activation. Returns the observed frontmost app name ONLY when it
   * is positively a DIFFERENT app (so callers can escalate/warn); returns '' when it matches or is
   * unknown. Observation is best-effort and must never manufacture a false activation failure. */
  private async frontmostMismatch(app: string): Promise<string> {
    if (!app.trim()) return '';
    try {
      const actual = await this.frontmostApp();
      if (actual && !appNamesMatch(actual, app)) return actual;
    } catch { /* unknown — no mismatch we can prove */ }
    return '';
  }

  /** Visible-cursor guarantee for keyboard actions: glide the one native cursor into the target
   * window before delivering keystrokes when it is currently outside it, so typing/shortcuts
   * visibly originate from the agent's cursor instead of firing while it rests over the terminal.
   * A cursor a prior click already placed inside the window is left exactly where it is. */
  private async ensureCursorInTargetWindow(target: ComputerTarget, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<void> {
    const frame = this.observedWindowFrame;
    if (!frame || !frame.w || !frame.h) return;
    if (!this.observedTarget || this.observedTarget.pid !== target.pid) return;
    try {
      const pos = await this.fallback.run({ action: 'cursor' }, ctx);
      const inside = pos.ok && pos.x != null && pos.y != null
        && pos.x >= frame.x && pos.x <= frame.x + frame.w
        && pos.y >= frame.y && pos.y <= frame.y + frame.h;
      if (inside) return;
      const center = { x: Math.round(frame.x + frame.w / 2), y: Math.round(frame.y + frame.h / 2) };
      await this.fallback.run({ action: 'move', x: center.x, y: center.y, normalized: false }, ctx);
    } catch { /* cursor positioning is best-effort; the keyboard action still proceeds */ }
  }

  public async frontmostApp(): Promise<string> {
    if (!this.driverPath()) return this.fallback.frontmostApp();
    try {
      const data = await this.call('list_apps');
      const active = (Array.isArray(data?.apps) ? data.apps : []).find((app: any) => app.active);
      return String(active?.name || '');
    } catch {
      return this.fallback.frontmostApp();
    }
  }

  public async run(cmd: DesktopCommand, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<DesktopResult> {
    if (!this.driverPath()) return this.fallback.run(cmd, ctx);
    const cwd = ctx?.cwd || process.cwd();
    this.lastCwd = cwd;
    this.activeAction = cmd.action;
    const driver = 'bimax-computer-use 0.8.3';
    // An explicit re-observation is the agent re-orienting itself — the corrective step the recovery
    // authority asks for. It clears any latched no-progress stop so the agent may act again on a
    // fresh read (the automatic post-action observe does NOT reset it; only a deliberate one does).
    if (cmd.action === 'observe' || cmd.action === 'screenshot') this.recovery.reset();
    try {
      if (ctx?.signal?.aborted) throw new Error('computer action aborted');
      const target = this.targetFor(cmd);
      const session = cmd.session || this.session;
      const delivery = await this.defaultDelivery(cmd);

      // Stage 3 — input ownership + mechanism routing. For acting verbs, consult the active surface
      // BEFORE delivering: (1) if the user has taken over, refuse rather than fight for the cursor;
      // (2) pick the honest mechanism for this (surface, action, delivery) and refuse combinations
      // that cannot be delivered safely; (3) record who owns input. Delivery itself is unchanged for
      // the working foreground path — this adds the guard and the ownership bookkeeping around it.
      const ACTING = ['click', 'type', 'key', 'set_value', 'drag', 'scroll', 'move', 'hover', 'hold', 'mouse_down', 'mouse_up'];
      if (ACTING.includes(cmd.action)) {
        const surface = this.surfaces.active();
        if (surface?.focusOwner === 'user') {
          return { ok: false, action: cmd.action, driver, error: 'computer use is paused for user takeover — resume before the agent acts', summary: `${cmd.action} refused: you currently have control` };
        }
        // Bounded recovery authority (Stage 6): once the controller has latched a no-progress
        // failure, the agent may not keep hammering the same stuck UI. Refuse until it re-observes
        // (which resets the budget) or reopens the app — a hard cap on blind repetition, not advice.
        if (this.recovery.done && !this.recovery.succeeded) {
          const c = this.recovery.counters;
          return { ok: false, action: cmd.action, driver,
            error: `computer-use recovery budget exhausted — the last actions produced no visible progress (${c.noProgress} no-change, ${c.recoveries} recoveries); re-observe (screenshot/observe) and target a different element before acting again, or ask the user`,
            summary: `${cmd.action} refused: no progress after repeated attempts — re-observe before acting again` };
        }
        const hasAxHandle = !!(cmd.elementToken || cmd.elementIndex != null || cmd.query?.trim());
        const choice = chooseMechanism(
          surface ?? { kind: 'native-window', backgroundCapable: true },
          cmd.action, { delivery, hasAxHandle },
        );
        this.lastMechanismChoice = choice.mechanism;
        if (choice.mechanism === 'unsupported') {
          return { ok: false, action: cmd.action, driver, error: choice.reason, summary: `${cmd.action} refused: ${choice.reason}` };
        }
        // Foreground physical delivery moves the ONE real cursor and needs the window in front — that
        // is an agent takeover of input, so record it (and emit a visible status) rather than have
        // the cursor move with no indication of who is driving.
        if (choice.requiresForeground && surface) {
          this.surfaces.claimInput(surface.id, 'agent', { force: true });
        }
      }

      if (['open', 'click', 'type', 'key', 'set_value', 'drag', 'scroll'].includes(cmd.action)) {
        await this.ensureAutoRecording(cwd);
      }

      switch (cmd.action) {
        case 'status': {
          const data = await this.call('health_report');
          const checks = Array.isArray(data?.checks) ? data.checks : [];
          const ax = checks.find((c: any) => c.name === 'tcc_accessibility');
          const screen = checks.find((c: any) => c.name === 'tcc_screen_recording');
          this.lastStatus = {
            accessibility: ax ? ax.status === 'pass' : null,
            screenRecording: screen ? screen.status === 'pass' : null,
          };
          return { ok: data?.overall !== 'failed', action: cmd.action, driver, ...this.lastStatus, details: data, summary: `Bimax Computer Use ${data?.overall || 'ready'}` };
        }
        case 'request_access': {
          const data = await this.call('check_permissions', { prompt: true });
          this.lastStatus = { accessibility: !!data?.accessibility, screenRecording: !!data?.screen_recording };
          return { ok: true, action: cmd.action, driver, ...this.lastStatus, details: data, summary: 'Bimax Computer Use permission check completed' };
        }
        case 'record_start': {
          const data = await this.startRecording(cwd, cmd.outputDir, cmd.recordVideo !== false);
          return {
            ok: true, action: cmd.action, driver, details: data,
            recording: { enabled: true, outputDir: this.recordingDir, scope: this.recordingScope, captureSafe: this.recordingCaptureSafe },
            summary: `computer-use recording started${cmd.recordVideo === false ? '' : ' with screen video'} → ${this.recordingDir} (capturing ${this.recordingScope}${this.recordingCaptureSafe ? '' : ' — may include unrelated windows'})`,
          };
        }
        case 'record_status': {
          const data = await this.call('get_recording_state');
          const enabled = !!data?.enabled;
          return {
            ok: true, action: cmd.action, driver, details: data,
            recording: {
              enabled, outputDir: String(data?.output_dir || this.recordingDir || '') || undefined,
              videoPath: String(data?.last_video_path || '') || undefined,
              error: String(data?.last_error || this.recordingError || '') || undefined,
              scope: enabled ? this.recordingScope : undefined,
              captureSafe: enabled ? this.recordingCaptureSafe : undefined,
            },
            summary: enabled ? `computer-use recording active → ${data?.output_dir || this.recordingDir}` : 'computer-use recording is off',
          };
        }
        case 'record_stop': {
          const data = await this.call('stop_recording');
          this.recordingStarted = false;
          const videoPath = String(data?.last_video_path || data?.video_path || '') || undefined;
          return {
            ok: true, action: cmd.action, driver, details: data,
            recording: { enabled: false, outputDir: this.recordingDir, videoPath },
            summary: `computer-use recording stopped${videoPath ? ` → ${videoPath}` : this.recordingDir ? ` → ${this.recordingDir}` : ''}`,
          };
        }
        case 'apps': {
          const data = await this.call('list_apps');
          return { ok: true, action: cmd.action, driver, details: data, summary: `found ${data?.apps?.length || 0} applications` };
        }
        case 'windows': {
          const data = await this.call('list_windows', target?.pid ? { pid: target.pid } : {});
          return { ok: true, action: cmd.action, driver, pid: target?.pid, details: data, summary: `found ${data?.windows?.length || 0} windows${target?.app ? ` for ${target.app}` : ''}` };
        }
        case 'open': {
          if (!cmd.app?.trim() && !cmd.bundleId?.trim()) throw new Error('open needs app or bundleId');
          const data = await this.call('launch_app', {
            ...(cmd.bundleId?.trim() ? { bundle_id: cmd.bundleId.trim() } : { name: cmd.app!.trim() }),
            ...(cmd.newInstance ? { creates_new_application_instance: true } : {}),
          });
          const window = Array.isArray(data?.windows) ? data.windows[0] : undefined;
          this.target = {
            app: String(data?.name || cmd.app || cmd.bundleId || ''),
            pid: Number(data?.pid || 0),
            windowId: Number(window?.window_id || 0) || undefined,
          };
          if (!this.target.pid) throw new Error(`opened ${this.target.app || 'application'} but received no target pid`);
          // Never surface a bundle id or an empty "?" as the app name — resolve the human name.
          this.target.app = await this.resolveAppName(this.target.pid, this.target.app);
          // Resume: if this is the first open of a fresh process and a persisted session for this
          // same app is on disk, restore its bounded history before this open records onto it.
          this.maybeResumeHistory(cwd);
          // A new app is a fresh visual context: reset the no-progress baseline so the opened app's
          // first frame is not compared against the previous app's screen, and give the recovery
          // authority a fresh budget for the new app.
          this.prevFrameHash = undefined;
          this.noChangeStreak = 0;
          this.recovery.reset();
          // launch_app intentionally suppresses activation. In visible mode that left the new app
          // off-screen while open() claimed it was ready, so observe walked the global menu bar and
          // every screenshot-local action was grounded against the wrong state. Activate first,
          // allow WindowServer to settle, then reacquire the actual visible application window.
          let frontmostWarning: string | undefined;
          if (delivery === 'foreground') {
            let activated = false;
            for (let attempt = 0; attempt < 4 && !activated; attempt++) {
              try {
                await this.call('bring_to_front', { pid: this.target.pid, window_id: this.target.windowId });
                activated = true;
              } catch {
                await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                this.target = await this.refreshTargetWindow(this.target);
              }
            }
            if (!activated) {
              // Some apps publish their process before AppKit accepts activation. `open -a` is the
              // native foreground contract and handles hidden/launching applications reliably.
              const nativeOpen = await this.fallback.run({ action: 'open', app: this.target.app }, ctx);
              if (!nativeOpen.ok) throw new Error(nativeOpen.error || nativeOpen.summary);
            }
            await new Promise(resolve => setTimeout(resolve, 250));
            // bring_to_front returning ok does NOT mean the app actually came forward — some apps
            // (Electron/Catalyst, e.g. WhatsApp) accept the call yet leave the terminal frontmost.
            // Verify the truth; if a different app is positively still in front, escalate to the
            // native `open -a` contract and re-check. Only then do we trust that it is focused.
            let stillWrong = await this.frontmostMismatch(this.target.app);
            if (stillWrong) {
              try { await this.fallback.run({ action: 'open', app: this.target.app }, ctx); } catch { /* re-checked below */ }
              await new Promise(resolve => setTimeout(resolve, 300));
              stillWrong = await this.frontmostMismatch(this.target.app);
            }
            if (stillWrong) {
              frontmostWarning = `${this.target.app} was launched but ${stillWrong} is still frontmost — its window may be hidden or blocked; screenshots and clicks may land on the wrong app until it is brought forward`;
              cliEvents.emit('status', frontmostWarning);
            }
            this.target = await this.refreshTargetWindow(this.target);
          } else if (!this.target.windowId) {
            this.target = await this.refreshTargetWindow(this.target);
          }
          const evidence = this.target.windowId
            ? await this.postActionEvidence(this.target, cwd, session)
            : { visualEvidenceError: 'opened application has no capturable window yet' };
          // The agent owns input on this surface only when it is genuinely frontmost in visible mode.
          this.syncSurface({ focusOwner: (delivery === 'foreground' && !frontmostWarning) ? 'agent' : 'none' });
          return {
            ok: true, action: cmd.action, driver, app: this.target.app, pid: this.target.pid,
            windowId: this.target.windowId, details: data, ...evidence, frontmostWarning,
            summary: `opened ${this.target.app} as pid ${this.target.pid}${this.target.windowId ? ` window ${this.target.windowId}` : ''}${frontmostWarning ? `; WARNING: ${frontmostWarning}` : '; fresh screen attached'}`,
          };
        }
        case 'observe':
        case 'screenshot': {
          let capture = target;
          // A target with a pid but no windowId (the app opened before its window was enumerable)
          // must NOT silently full-display capture — that grabbed the terminal instead of the app
          // the model is driving. Try to acquire the real window first; only a genuinely
          // window-less app falls back, and only for the whole-screen `screenshot` verb.
          if (capture?.pid && !capture.windowId) {
            const refreshed = await this.refreshTargetWindow(capture);
            if (refreshed.windowId) {
              capture = refreshed;
              if (this.target?.pid === capture.pid) this.target = refreshed;
            }
          }
          if (!capture?.windowId) {
            if (cmd.action === 'screenshot') return this.fallback.run(cmd, ctx);
            throw new Error('observe needs pid + windowId; open or select an application window first');
          }
          return this.observeTarget(capture, cwd, session, cmd);
        }
        case 'cursor': {
          if (delivery === 'foreground') return this.fallback.run({ action: 'cursor' }, ctx);
          const data = await this.call('get_cursor_position');
          return { ok: true, action: cmd.action, driver, x: data?.x, y: data?.y, details: data, summary: `cursor at ${data?.x},${data?.y}` };
        }
        case 'frontmost': {
          const app = await this.frontmostApp();
          return { ok: true, action: cmd.action, driver, app, summary: `frontmost app: ${app || '(unknown)'}` };
        }
        case 'click': {
          if (!target) return this.fallback.run(cmd, ctx);
          const args: any = { pid: target.pid, session, delivery_mode: delivery, button: cmd.button || 'left' };
          if (cmd.modifier?.length) args.modifier = cmd.modifier;
          if (target.windowId) args.window_id = target.windowId;
          let resolvedLabel = '';
          let coordinateSource = '';
          if (cmd.query?.trim()) {
            const resolved = this.resolveObservedElement(cmd.query, target);
            resolvedLabel = resolved.label || cmd.query;
            const point = this.elementCenterInScreenshot(resolved.frame);
            if (point) {
              // Use the visible rectangle as the action target. Native AX activation is retained only
              // for controls without geometry; it is slower and frequently reports a no-op in Settings.
              args.x = point.x;
              args.y = point.y;
              coordinateSource = 'native label frame';
            } else if (resolved.elementToken) args.element_token = resolved.elementToken;
            else if (resolved.elementIndex != null) args.element_index = resolved.elementIndex;
          } else if (cmd.elementToken) args.element_token = cmd.elementToken;
          else if (cmd.elementIndex != null) args.element_index = Math.floor(cmd.elementIndex);
          else {
            if (cmd.x == null || cmd.y == null) throw new Error('click needs query, elementToken/elementIndex, or x+y');
            if (!this.observedTarget || this.observedTarget.pid !== target.pid || this.observedTarget.windowId !== target.windowId) {
              throw new Error('screenshot click needs a fresh image of this exact window; observe once, then click the visible point');
            }
            const width = this.observedTarget?.width;
            const height = this.observedTarget?.height;
            if (!width || !height) throw new Error('latest screenshot has no usable dimensions');
            const x = cmd.normalized ? scaleNormalizedPoint(cmd.x, width - 1) : Math.round(cmd.x);
            const y = cmd.normalized ? scaleNormalizedPoint(cmd.y, height - 1) : Math.round(cmd.y);
            if (x < 0 || y < 0 || x >= width || y >= height) {
              throw new Error(`screenshot click ${x},${y} is outside the latest image (${width}x${height})`);
            }
            args.x = x; args.y = y;
            coordinateSource = cmd.normalized ? 'normalized screenshot point' : 'screenshot pixel';
          }
          if (cmd.count) args.count = Math.floor(cmd.count);
          if (cmd.debugImageOut) args.debug_image_out = path.resolve(cmd.debugImageOut);
          // The sidecar's foreground pixel rung still PID-posts a synthetic event and moves only
          // its overlay cursor. SwiftUI/System Settings can ignore that event. Visible mode means
          // a real global CGEvent: front the pinned window, glide the macOS cursor, click, then use
          // the same sidecar session for the fresh post-action capture.
          if (delivery === 'foreground' && args.x != null && args.y != null) {
            const globalPoint = this.screenshotPixelToGlobalPoint({ x: Number(args.x), y: Number(args.y) });
            if (globalPoint) {
              await this.call('bring_to_front', { pid: target.pid, window_id: target.windowId });
              await new Promise(resolve => setTimeout(resolve, 100));
              const native = await this.fallback.run({
                action: 'click', x: globalPoint.x, y: globalPoint.y,
                button: cmd.button || 'left', count: cmd.count || 1,
                modifier: cmd.modifier,
                app: target.app, normalized: false,
              }, ctx);
              if (!native.ok) throw new Error(native.error || native.summary);
              const evidence = await this.postActionEvidence(target, cwd, session);
              return {
                ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
                details: { path: 'native-global-cgevent', x: globalPoint.x, y: globalPoint.y }, ...evidence,
                summary: `visible native cursor click${resolvedLabel ? ` on "${resolvedLabel}"` : ''} delivered to ${target.app || `pid ${target.pid}`}; fresh screen attached`,
              };
            }
          }
          // Do not pre-position with move_cursor here. Click coordinates are window-local pixels,
          // while move_cursor consumes screen-space overlay coordinates; forwarding x/y directly
          // visibly pointed far away from the actual control. The click RPC owns the window-to-screen
          // conversion and updates the session cursor in the same coordinate frame as delivery.
          const data = await this.call('click', args);
          const evidence = await this.postActionEvidence(target, cwd, session);
          return {
            ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
            details: data, ...evidence,
            summary: `click${resolvedLabel ? ` on "${resolvedLabel}"` : ''}${coordinateSource ? ` via ${coordinateSource}` : ''} delivered to ${target.app || `pid ${target.pid}`}; fresh screen attached`,
          };
        }
        case 'type': {
          if (!target) return this.fallback.run(cmd, ctx);
          if (delivery === 'foreground') {
            await this.call('bring_to_front', { pid: target.pid, window_id: target.windowId });
            await this.ensureCursorInTargetWindow(target, ctx);
            const native = await this.fallback.run({ action: 'type', text: cmd.text || '', app: target.app }, ctx);
            if (!native.ok) throw new Error(native.error || native.summary);
            const evidence = await this.postActionEvidence(target, cwd, session);
            return {
              ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
              details: { path: 'native-global-cgevent' }, ...evidence,
              summary: `typed ${(cmd.text || '').length} characters with native keyboard into ${target.app || `pid ${target.pid}`}; fresh screen attached`,
            };
          }
          const args: any = { pid: target.pid, text: cmd.text || '', session, delivery_mode: delivery };
          if (target.windowId) args.window_id = target.windowId;
          if (cmd.elementToken) args.element_token = cmd.elementToken;
          else if (cmd.elementIndex != null) args.element_index = Math.floor(cmd.elementIndex);
          else if (cmd.x != null && cmd.y != null) { args.x = cmd.x; args.y = cmd.y; }
          const data = await this.call('type_text', args);
          const evidence = await this.postActionEvidence(target, cwd, session);
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, ...evidence, summary: `typed ${(cmd.text || '').length} characters into ${target.app || `pid ${target.pid}`}; fresh screen attached` };
        }
        case 'key': {
          if (!target) return this.fallback.run(cmd, ctx);
          const keys = (cmd.combo || '').split('+').map(k => k.trim().toLowerCase()).filter(Boolean);
          if (!keys.length) throw new Error('key needs combo');
          if (delivery === 'foreground') {
            await this.call('bring_to_front', { pid: target.pid, window_id: target.windowId });
            await this.ensureCursorInTargetWindow(target, ctx);
            const native = await this.fallback.run({ action: 'key', combo: cmd.combo, app: target.app }, ctx);
            if (!native.ok) throw new Error(native.error || native.summary);
            const evidence = await this.postActionEvidence(target, cwd, session);
            return {
              ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
              details: { path: 'native-global-cgevent' }, ...evidence,
              summary: `pressed ${cmd.combo} with native keyboard in ${target.app || `pid ${target.pid}`}; fresh screen attached`,
            };
          }
          const common: any = { pid: target.pid, session, delivery_mode: delivery };
          if (target.windowId) common.window_id = target.windowId;
          if (cmd.elementToken) common.element_token = cmd.elementToken;
          else if (cmd.elementIndex != null) common.element_index = Math.floor(cmd.elementIndex);
          const data = keys.length > 1
            ? await this.call('hotkey', { ...common, keys })
            : await this.call('press_key', { ...common, key: keys[0] });
          const evidence = await this.postActionEvidence(target, cwd, session);
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, ...evidence, summary: `pressed ${cmd.combo} in ${target.app || `pid ${target.pid}`}; fresh screen attached` };
        }
        case 'set_value': {
          if (!target) throw new Error('set_value needs a target pid');
          if (cmd.value == null) throw new Error('set_value needs value');
          const data = await this.call('set_value', {
            pid: target.pid, window_id: target.windowId, session, value: cmd.value,
            ...(cmd.elementToken ? { element_token: cmd.elementToken } : { element_index: cmd.elementIndex }),
          });
          const evidence = await this.postActionEvidence(target, cwd, session);
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, ...evidence, summary: `value delivered to ${target.app || `pid ${target.pid}`}; fresh screen attached` };
        }
        case 'drag': {
          if (!target) return this.fallback.run(cmd, ctx);
          if (cmd.x == null || cmd.y == null || cmd.toX == null || cmd.toY == null) {
            throw new Error('drag needs x+y and toX+toY');
          }
          if (!this.observedTarget || this.observedTarget.pid !== target.pid || this.observedTarget.windowId !== target.windowId) {
            throw new Error('drag needs a fresh image of this exact window');
          }
          const width = this.observedTarget.width;
          const height = this.observedTarget.height;
          if (!width || !height) throw new Error('latest screenshot has no usable dimensions');
          const from = {
            x: cmd.normalized ? scaleNormalizedPoint(cmd.x, width - 1) : Math.round(cmd.x),
            y: cmd.normalized ? scaleNormalizedPoint(cmd.y, height - 1) : Math.round(cmd.y),
          };
          const to = {
            x: cmd.normalized ? scaleNormalizedPoint(cmd.toX, width - 1) : Math.round(cmd.toX),
            y: cmd.normalized ? scaleNormalizedPoint(cmd.toY, height - 1) : Math.round(cmd.toY),
          };
          if ([from.x, from.y, to.x, to.y].some(value => !Number.isFinite(value))
            || from.x < 0 || from.y < 0 || to.x < 0 || to.y < 0
            || from.x >= width || to.x >= width || from.y >= height || to.y >= height) {
            throw new Error(`drag points must stay inside the latest image (${width}x${height})`);
          }
          if (delivery === 'foreground') {
            const globalFrom = this.screenshotPixelToGlobalPoint(from);
            const globalTo = this.screenshotPixelToGlobalPoint(to);
            if (globalFrom && globalTo) {
              // Drive the drag through the explicit state machine: verify the SOURCE is inside the
              // window before the button ever goes down (dragging from empty space is a mistake), run
              // the atomic native drag as the down→move→up executor, then verify a fresh screen. On a
              // native failure, cancel and post a compensating mouse-up so a half-drag can't wedge the
              // pointer. The full phase trace ships in details.dragTrace for observability.
              const machine = new DragMachine(globalFrom, globalTo);
              const wf = this.observedWindowFrame;
              machine.locateSource();
              const sourceInside = !wf || pointInFrame(globalFrom, wf);
              machine.verifySource(sourceInside, sourceInside ? 'source is inside the target window' : 'source point is outside the target window');
              if (!sourceInside) {
                return {
                  ok: false, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
                  details: { dragTrace: machine.trace }, error: 'drag source is outside the target window — re-observe and pick a point that is on the window',
                  summary: `drag refused: source is outside ${target.app || `pid ${target.pid}`}`,
                };
              }
              await this.call('bring_to_front', { pid: target.pid, window_id: target.windowId });
              // Activation is asynchronous on macOS. Without a short settle, a drag immediately
              // after screenshot capture can land while the window is visible but not yet key.
              await new Promise(resolve => setTimeout(resolve, 150));
              machine.mouseDown().startDrag().moveThrough([globalTo]).locateDestination();
              // A destination outside the source window is a LEGITIMATE cross-window drag, so this is
              // informational — the machine always completes the release rather than abandoning it.
              machine.verifyDestination(true, (!wf || pointInFrame(globalTo, wf)) ? 'destination inside the window' : 'destination outside the source window (cross-window drop)');
              const native = await this.fallback.run({
                action: 'drag', x: globalFrom.x, y: globalFrom.y,
                toX: globalTo.x, toY: globalTo.y, app: target.app, normalized: false,
              }, ctx);
              if (!native.ok) {
                machine.cancel('native drag failed');
                if (machine.releaseOwed) {
                  try { await this.fallback.run({ action: 'mouse_up', x: globalTo.x, y: globalTo.y, app: target.app, normalized: false }, ctx); }
                  catch { /* best-effort release so a failed drag never leaves the button stuck */ }
                }
                throw new Error(native.error || native.summary);
              }
              machine.mouseUp('native drag completed');
              const evidence = await this.postActionEvidence(target, cwd, session);
              machine.verifyResult(true, 'fresh post-drag screen captured');
              return {
                ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
                details: { path: 'native-global-cgevent', from: globalFrom, to: globalTo, dragTrace: machine.trace }, ...evidence,
                summary: `visible native cursor drag delivered to ${target.app || `pid ${target.pid}`}; fresh screen attached`,
              };
            }
          }
          const data = await this.call('drag', {
            pid: target.pid, window_id: target.windowId, session,
            from_x: from.x, from_y: from.y, to_x: to.x, to_y: to.y,
            delivery_mode: delivery, button: cmd.button || 'left',
          });
          const evidence = await this.postActionEvidence(target, cwd, session);
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, ...evidence, summary: `drag delivered to ${target.app || `pid ${target.pid}`}; fresh screen attached` };
        }
        case 'scroll': {
          if (!target) return this.fallback.run(cmd, ctx);
          const direction = Math.abs(cmd.dx || 0) > Math.abs(cmd.dy || 0)
            ? ((cmd.dx || 0) >= 0 ? 'right' : 'left')
            : ((cmd.dy || 0) >= 0 ? 'down' : 'up');
          const args: any = { pid: target.pid, direction, amount: Math.max(1, Math.min(50, Math.round(Math.abs((cmd.dy || cmd.dx || 120) / 40)))), session, delivery_mode: delivery };
          if (target.windowId) args.window_id = target.windowId;
          if (cmd.elementToken) args.element_token = cmd.elementToken;
          else if (cmd.elementIndex != null) args.element_index = Math.floor(cmd.elementIndex);
          else if (cmd.x != null && cmd.y != null) { args.x = cmd.x; args.y = cmd.y; }
          if (delivery === 'foreground' && this.observedTarget?.width && this.observedTarget?.height) {
            const point = {
              x: cmd.x == null ? Math.round(this.observedTarget.width / 2)
                : cmd.normalized ? scaleNormalizedPoint(cmd.x, this.observedTarget.width - 1) : Math.round(cmd.x),
              y: cmd.y == null ? Math.round(this.observedTarget.height / 2)
                : cmd.normalized ? scaleNormalizedPoint(cmd.y, this.observedTarget.height - 1) : Math.round(cmd.y),
            };
            const globalPoint = this.screenshotPixelToGlobalPoint(point);
            if (globalPoint) {
              await this.call('bring_to_front', { pid: target.pid, window_id: target.windowId });
              const native = await this.fallback.run({
                action: 'scroll', x: globalPoint.x, y: globalPoint.y,
                dx: cmd.dx || 0, dy: cmd.dy || 0, app: target.app, normalized: false,
              }, ctx);
              if (!native.ok) throw new Error(native.error || native.summary);
              const evidence = await this.postActionEvidence(target, cwd, session);
              return {
                ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
                details: { path: 'native-global-cgevent', at: globalPoint }, ...evidence,
                summary: `visible native cursor scrolled ${direction} in ${target.app || `pid ${target.pid}`}; fresh screen attached`,
              };
            }
          }
          const data = await this.call('scroll', args);
          const evidence = await this.postActionEvidence(target, cwd, session);
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, ...evidence, summary: `scrolled ${direction} in ${target.app || `pid ${target.pid}`}; fresh screen attached` };
        }
        case 'hover':
        case 'hold':
        case 'mouse_down':
        case 'mouse_up': {
          if (!target) return this.fallback.run(cmd, ctx);
          return this.pointerPrimitive(cmd.action, target, cmd, cwd, session, ctx);
        }
        case 'close': {
          if (!target) return this.fallback.run(cmd, ctx);
          const keys = process.platform === 'darwin' ? ['cmd', 'q'] : ['alt', 'f4'];
          await this.call('hotkey', { pid: target.pid, window_id: target.windowId, session, keys, delivery_mode: 'background' });
          await new Promise(resolve => setTimeout(resolve, 350));
          const windows = await this.call('list_windows', { pid: target.pid });
          if (Array.isArray(windows?.windows) && windows.windows.length > 0) {
            throw new Error(`${target.app || `pid ${target.pid}`} did not close after the cooperative quit shortcut`);
          }
          this.surfaces.remove(`native:${target.pid}`);
          this.target = null;
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, summary: `closed ${target.app || `pid ${target.pid}`} and verified that its windows disappeared` };
        }
        case 'move': {
          if (cmd.x == null || cmd.y == null) throw new Error('move needs x and y');
          if (delivery === 'foreground') return this.fallback.run({ ...cmd, normalized: false }, ctx);
          const data = await this.call('move_cursor', { x: cmd.x, y: cmd.y, session });
          return { ok: true, action: cmd.action, driver, x: cmd.x, y: cmd.y, details: data, summary: `moved Bimax cursor to ${cmd.x},${cmd.y}` };
        }
        case 'wait': {
          const ms = Math.max(WAIT_MIN, Math.min(WAIT_MAX, Math.floor(cmd.ms || 500)));
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            ctx?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('computer wait aborted')); }, { once: true });
          });
          const evidence = target?.windowId ? await this.postActionEvidence(target, cwd, session) : {};
          return { ok: true, action: cmd.action, driver, app: target?.app, pid: target?.pid, windowId: target?.windowId, ...evidence, summary: `waited ${ms}ms${target?.windowId ? '; fresh screen attached' : ''}` };
        }
        default:
          return { ok: false, action: cmd.action, driver, error: `unsupported computer action: ${String(cmd.action)}`, summary: `${cmd.action} failed` };
      }
    } catch (err: any) {
      return { ok: false, action: cmd.action, driver, error: bimaxBrand(String(err?.message || err)).slice(0, 1000), summary: `${cmd.action} failed` };
    }
  }
}

export const globalDesktopRuntime: DesktopRuntimePort = new BimaxComputerRuntime();
