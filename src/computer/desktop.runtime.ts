import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { DESKTOP_HELPER_SOURCE, DESKTOP_HELPER_VERSION } from './helper.source';
import { openClient } from '../mcp/client';
import { withTimeout } from '../utils/withTimeout';

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
  | 'scroll' | 'type' | 'key' | 'set_value' | 'wait';

export interface DesktopCommand {
  action: DesktopAction;
  x?: number; y?: number;
  toX?: number; toY?: number;
  dx?: number; dy?: number;
  button?: 'left' | 'right' | 'middle';
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
}

export interface DesktopDisplay { index: number; width: number; height: number; scale: number; main: boolean }

export interface DesktopResult {
  ok: boolean;
  action: DesktopAction;
  driver: string;
  error?: string;
  screenshot?: string;
  width?: number; height?: number;
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
}

/** Pure: 0–1000 normalized → screen points (clamped). Exported for tests. */
export function scaleNormalizedPoint(v: number, extent: number): number {
  const clamped = Math.max(0, Math.min(1000, v));
  return Math.round((clamped / 1000) * extent);
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
          const r = await this.helper(['click', String(cmd.x), String(cmd.y), cmd.button || 'left', String(cmd.count || 1)], signal);
          return { app: r.app, summary: `${cmd.count === 2 ? 'double-' : cmd.count === 3 ? 'triple-' : ''}${cmd.button || 'left'} click at ${cmd.x},${cmd.y}${r.app ? ` in ${r.app}` : ''}` };
        }
        case 'drag': await this.helper(['drag', String(cmd.x), String(cmd.y), String(cmd.toX), String(cmd.toY)], signal); return { summary: `dragged ${cmd.x},${cmd.y} → ${cmd.toX},${cmd.toY}` };
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

/**
 * Bimax Computer Use — a long-lived, private MCP connection to the embedded native sidecar.
 *
 * The sidecar is derived from trycua/cua 0.8.3 (MIT) but no Cua surface leaks into Bimax: the
 * executable path, session, tool schema, diagnostics, output and fallback are all Bimax-owned.
 * Keeping one live connection is essential because accessibility element tokens are scoped to the
 * observation that created them; spawning a process per action would silently discard that cache.
 */
export class BimaxComputerRuntime implements DesktopRuntimePort {
  private readonly fallback = new DesktopRuntime();
  private clientPromise: Promise<any> | null = null;
  private target: ComputerTarget | null = null;
  private indexedElements = new Map<string, { label?: string; role?: string; value?: string }>();
  private readonly session = `bimax-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  private lastStatus = { accessibility: null as boolean | null, screenRecording: null as boolean | null };

  private driverPath(): string | null {
    const configured = process.env.BIMAX_COMPUTER_USE_DRIVER?.trim();
    return configured && fs.existsSync(configured) ? configured : null;
  }

  public quickStatus() {
    const path = this.driverPath();
    if (!path) return this.fallback.quickStatus();
    return { driver: 'bimax-computer-use 0.8.3', ready: true, ...this.lastStatus };
  }

  public describeTarget(cmd: DesktopCommand) {
    const key = cmd.elementToken ? `token:${cmd.elementToken}`
      : cmd.elementIndex != null ? `index:${Math.floor(cmd.elementIndex)}` : '';
    return key ? this.indexedElements.get(key) || null : null;
  }

  public async dispose(): Promise<void> {
    const pending = this.clientPromise;
    this.clientPromise = null;
    if (!pending) return;
    try {
      const client = await pending;
      await client.callTool({ name: 'end_session', arguments: { session: this.session } });
      await client.close?.();
    } catch { /* process teardown is best-effort */ }
  }

  private async client(): Promise<any> {
    const driver = this.driverPath();
    if (!driver) throw new Error('embedded Bimax Computer Use driver is unavailable');
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const client = await openClient({
          name: 'bimax-computer-use',
          command: driver,
          args: ['mcp', '--embedded', '--host-bundle-id', 'ai.bimax.cli'],
          forceScrubEnv: true,
          env: {
            CUA_DRIVER_EMBEDDED: '1',
            CUA_DRIVER_HOST_BUNDLE_ID: 'ai.bimax.cli',
            CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
            CUA_TELEMETRY_ENABLED: '0',
          },
        });
        await client.callTool({ name: 'start_session', arguments: { session: this.session } });
        return client;
      })().catch(err => {
        this.clientPromise = null;
        throw err;
      });
    }
    return this.clientPromise;
  }

  private async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const result = await withTimeout<any>(
      (await this.client()).callTool({ name, arguments: args }),
      30_000,
      `Bimax Computer Use '${name}'`,
    );
    const data = bimaxBrand(mcpStructured(result));
    if (result?.isError) {
      const detail = bimaxBrand(mcpText(result)).trim();
      throw new Error(detail || `${name} failed`);
    }
    return data;
  }

  private targetFor(cmd: DesktopCommand): ComputerTarget | null {
    const pid = Number(cmd.pid || this.target?.pid || 0);
    if (!pid) return null;
    return {
      app: cmd.app?.trim() || this.target?.app || '',
      pid,
      windowId: Number(cmd.windowId || this.target?.windowId || 0) || undefined,
    };
  }

  private screenshotPath(cwd: string): string {
    const dir = path.join(cwd, '.bimax', 'computer');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `window-${Date.now()}.png`);
  }

  private async refreshTargetWindow(target: ComputerTarget): Promise<ComputerTarget> {
    const data = await this.call('list_windows', { pid: target.pid });
    const windows = Array.isArray(data?.windows) ? data.windows : [];
    const window = windows.find((w: any) => Number(w.window_id) === target.windowId) || windows[0];
    return { ...target, windowId: Number(window?.window_id || 0) || undefined };
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
    const driver = 'bimax-computer-use 0.8.3';
    try {
      if (ctx?.signal?.aborted) throw new Error('computer action aborted');
      const target = this.targetFor(cmd);
      const session = cmd.session || this.session;

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
          if (!this.target.windowId) this.target = await this.refreshTargetWindow(this.target);
          return { ok: true, action: cmd.action, driver, app: this.target.app, pid: this.target.pid, windowId: this.target.windowId, details: data, summary: `opened ${this.target.app} as pid ${this.target.pid}${this.target.windowId ? ` window ${this.target.windowId}` : ''}` };
        }
        case 'observe':
        case 'screenshot': {
          if (!target?.windowId) {
            if (cmd.action === 'screenshot') return this.fallback.run(cmd, ctx);
            throw new Error('observe needs pid + windowId; open or select an application window first');
          }
          const screenshot = this.screenshotPath(cwd);
          const data = await this.call('get_window_state', {
            pid: target.pid,
            window_id: target.windowId,
            session,
            include_screenshot: cmd.includeScreenshot !== false,
            screenshot_out_file: screenshot,
            ...(cmd.query ? { query: cmd.query } : {}),
            ...(cmd.maxElements ? { max_elements: Math.max(1, Math.min(2000, Math.floor(cmd.maxElements))) } : {}),
          });
          const elements = Array.isArray(data?.elements) ? data.elements : [];
          const degraded = !elements.some((element: any) =>
            !['AXMenuBar', 'AXMenuBarItem', 'AXMenu', 'AXMenuItem'].includes(String(element?.role || '')));
          this.indexedElements.clear();
          for (const element of elements as any[]) {
            const safe = { label: element?.label, role: element?.role, value: element?.value };
            if (element?.element_token) this.indexedElements.set(`token:${element.element_token}`, safe);
            if (element?.element_index != null) this.indexedElements.set(`index:${Number(element.element_index)}`, safe);
          }
          return {
            ok: true, action: cmd.action, driver, app: target.app, pid: target.pid,
            windowId: target.windowId, screenshot: data?.screenshot_file_path || screenshot,
            width: data?.screenshot_width, height: data?.screenshot_height,
            elements, tree: data?.tree_markdown, degraded,
            summary: degraded
              ? `observed ${target.app || `pid ${target.pid}`} window ${target.windowId}: semantic tree is degraded; use the attached window screenshot and pixel addressing`
              : `observed ${target.app || `pid ${target.pid}`} window ${target.windowId}: ${elements.length} indexed UI elements + screenshot`,
          };
        }
        case 'cursor': {
          const data = await this.call('get_cursor_position');
          return { ok: true, action: cmd.action, driver, x: data?.x, y: data?.y, details: data, summary: `cursor at ${data?.x},${data?.y}` };
        }
        case 'frontmost': {
          const app = await this.frontmostApp();
          return { ok: true, action: cmd.action, driver, app, summary: `frontmost app: ${app || '(unknown)'}` };
        }
        case 'click': {
          if (!target) return this.fallback.run(cmd, ctx);
          const args: any = { pid: target.pid, session, delivery_mode: cmd.deliveryMode || 'background', button: cmd.button || 'left' };
          if (target.windowId) args.window_id = target.windowId;
          if (cmd.elementToken) args.element_token = cmd.elementToken;
          else if (cmd.elementIndex != null) args.element_index = Math.floor(cmd.elementIndex);
          else { args.x = cmd.x; args.y = cmd.y; }
          if (cmd.count) args.count = Math.floor(cmd.count);
          const data = await this.call('click', args);
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, summary: `click delivered to ${target.app || `pid ${target.pid}`}; verify with a fresh observe` };
        }
        case 'type': {
          if (!target) return this.fallback.run(cmd, ctx);
          const args: any = { pid: target.pid, text: cmd.text || '', session, delivery_mode: cmd.deliveryMode || 'background' };
          if (target.windowId) args.window_id = target.windowId;
          if (cmd.elementToken) args.element_token = cmd.elementToken;
          else if (cmd.elementIndex != null) args.element_index = Math.floor(cmd.elementIndex);
          else if (cmd.x != null && cmd.y != null) { args.x = cmd.x; args.y = cmd.y; }
          const data = await this.call('type_text', args);
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, summary: `typed ${(cmd.text || '').length} characters into ${target.app || `pid ${target.pid}`}; verify with a fresh observe` };
        }
        case 'key': {
          if (!target) return this.fallback.run(cmd, ctx);
          const keys = (cmd.combo || '').split('+').map(k => k.trim().toLowerCase()).filter(Boolean);
          if (!keys.length) throw new Error('key needs combo');
          const common: any = { pid: target.pid, session, delivery_mode: cmd.deliveryMode || 'background' };
          if (target.windowId) common.window_id = target.windowId;
          if (cmd.elementToken) common.element_token = cmd.elementToken;
          else if (cmd.elementIndex != null) common.element_index = Math.floor(cmd.elementIndex);
          const data = keys.length > 1
            ? await this.call('hotkey', { ...common, keys })
            : await this.call('press_key', { ...common, key: keys[0] });
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, summary: `pressed ${cmd.combo} in ${target.app || `pid ${target.pid}`}; verify with a fresh observe` };
        }
        case 'set_value': {
          if (!target) throw new Error('set_value needs a target pid');
          if (cmd.value == null) throw new Error('set_value needs value');
          const data = await this.call('set_value', {
            pid: target.pid, window_id: target.windowId, session, value: cmd.value,
            ...(cmd.elementToken ? { element_token: cmd.elementToken } : { element_index: cmd.elementIndex }),
          });
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, summary: `value delivered to ${target.app || `pid ${target.pid}`}; verify with a fresh observe` };
        }
        case 'drag': {
          if (!target) return this.fallback.run(cmd, ctx);
          const data = await this.call('drag', {
            pid: target.pid, window_id: target.windowId, session,
            from_x: cmd.x, from_y: cmd.y, to_x: cmd.toX, to_y: cmd.toY,
            delivery_mode: cmd.deliveryMode || 'background', button: cmd.button || 'left',
          });
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, summary: `drag delivered to ${target.app || `pid ${target.pid}`}; verify with a fresh observe` };
        }
        case 'scroll': {
          if (!target) return this.fallback.run(cmd, ctx);
          const direction = Math.abs(cmd.dx || 0) > Math.abs(cmd.dy || 0)
            ? ((cmd.dx || 0) >= 0 ? 'right' : 'left')
            : ((cmd.dy || 0) >= 0 ? 'down' : 'up');
          const args: any = { pid: target.pid, direction, amount: Math.max(1, Math.min(50, Math.round(Math.abs((cmd.dy || cmd.dx || 120) / 40)))), session, delivery_mode: cmd.deliveryMode || 'background' };
          if (target.windowId) args.window_id = target.windowId;
          if (cmd.elementToken) args.element_token = cmd.elementToken;
          else if (cmd.elementIndex != null) args.element_index = Math.floor(cmd.elementIndex);
          else if (cmd.x != null && cmd.y != null) { args.x = cmd.x; args.y = cmd.y; }
          const data = await this.call('scroll', args);
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId, details: data, summary: `scrolled ${direction} in ${target.app || `pid ${target.pid}`}; verify with a fresh observe` };
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
          this.target = null;
          return { ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, summary: `closed ${target.app || `pid ${target.pid}`} and verified that its windows disappeared` };
        }
        case 'move': {
          if (cmd.x == null || cmd.y == null) throw new Error('move needs x and y');
          const data = await this.call('move_cursor', { x: cmd.x, y: cmd.y, session });
          return { ok: true, action: cmd.action, driver, x: cmd.x, y: cmd.y, details: data, summary: `moved Bimax cursor to ${cmd.x},${cmd.y}` };
        }
        case 'wait': {
          const ms = Math.max(WAIT_MIN, Math.min(WAIT_MAX, Math.floor(cmd.ms || 500)));
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            ctx?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('computer wait aborted')); }, { once: true });
          });
          return { ok: true, action: cmd.action, driver, summary: `waited ${ms}ms` };
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
