import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { DESKTOP_HELPER_SOURCE, DESKTOP_HELPER_VERSION } from './helper.source';
import { cliEvents } from '../cli/events';
import { loadConfig } from '../cli/config';
import { normalizedToPixel, screenshotToGlobal, elementCenterToScreenshot, globalFrameToScreenshot, Frame } from './coordinates';
import { SurfaceRegistry, ExecutionSurface, InputOwner, chooseMechanism, AutomationMechanism } from './surface';
import { DragMachine } from './drag';
import { pointInFrame } from './coordinates';
import { classifyVerification, VerificationResult } from './verification';
import { RecoveryController, RecoveryDecision } from './recovery';
import { ActionHistory, ActionHistorySummary, ComputerSessionState, writeSessionState, readSessionState } from './durability';
import { RecordingController } from './recording';
import { toActionResult, ActionResult } from './verification';
import { SidecarTransport, SidecarTransportPort, bimaxBrand } from './transport';
import { TargetOwnership, ComputerTarget } from './target';
import { LivePipPort, LivePipStatus, NativeLivePip } from './pip';

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
  | 'cursor' | 'frontmost' | 'open' | 'close' | 'quit_app' | 'move' | 'click' | 'drag'
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
  /** drag: destination element handle from the newest observation (mirrors query/elementToken/elementIndex for the source). */
  toQuery?: string;
  toElementToken?: string;
  toElementIndex?: number;
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
  /** record_start: single-use approval token for WHOLE-DISPLAY video capture, minted ONLY by the
   * runtime's authorizeFullDisplayRecording() after a governor-approved prompt. This field is
   * STRIPPED from model-supplied arguments by the tool layer — a model cannot forge it, and no
   * boolean can authorize whole-display capture. */
  fullDisplayToken?: string;
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
  /** The honest per-action outcome contract: delivery status, observed state, semantic
   * postcondition, confidence, and failure reason. Pixel change is supporting evidence only —
   * `confidence: 'proven'` requires a matched semantic postcondition. */
  actionResult?: ActionResult;
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
  /** Coordinate contract attached to observations so a model never mixes AX global points with
   * screenshot pixels. Element frames exposed in results use the same pixels as x/y. */
  coordinateSpace?: { xY: 'screenshot_pixels'; elementFrames: 'screenshot_pixels'; normalized: '0-1000' };
  completionGuidance?: string;
  summary: string;
}

const COMPUTER_COMPLETION_GUIDANCE = 'Match the answer type the user requested. A categorical state such as Normal, On, or Connected is not a percentage or other numeric value. Battery health means both Battery Condition and Maximum Capacity percentage when macOS exposes them; open the Battery Health info sheet instead of stopping at Normal. If the exact requested datum is not visible, use the Details, info, or disclosure control on the same row/section as that datum in the newest screenshot; never substitute an unrelated Options or ellipsis menu. Repeated generic controls may be enriched with their row context (for example, "Show Detail — Battery Health"); choose that exact control and never click structural containers such as Window, Sidebar, Outline, Group, or Scroll Area. Set sliders with set_value on their fresh semantic handle: maximum/full/100% maps to 1 and minimum/mute/0% maps to 0; never click or drag a slider to approximate an exact value. A visible modal, sheet, dialog, or popover blocks the page behind it: interact only with that foreground surface and, after reading it, dismiss it with Done, Close, Cancel, or Escape before navigating or scrolling the underlying page. Dismissing a blocker does not complete the interrupted navigation: retry the original action. Seeing a destination label in a sidebar/menu is not proof that its page is open; require the destination heading in the main content pane. Sidebar entries are navigation, never the requested settings inside that page. Never mark a checklist phase complete when its latest Computer action failed or when no post-action screenshot proves the phase. Otherwise report that the datum could not be retrieved.';
const POST_ACTION_ELEMENT_BUDGET = 80;

type ObservedElement = {
  label?: string;
  originalLabel?: string;
  contextLabel?: string;
  role?: string;
  value?: string;
  description?: string;
  frame?: unknown;
  elementToken?: string;
  elementIndex?: number;
};

const ACTIONABLE_AX_ROLES = new Set([
  'AXButton', 'AXCheckBox', 'AXComboBox', 'AXDisclosureTriangle', 'AXLink', 'AXMenuButton',
  'AXPopUpButton', 'AXRadioButton', 'AXSearchField', 'AXSlider', 'AXSwitch', 'AXTab',
  'AXTextArea', 'AXTextField',
]);
const STRUCTURAL_AX_ROLES = new Set(['AXWindow', 'AXOutline', 'AXGroup', 'AXScrollArea', 'AXToolbar']);

function elementFrame(element: any): Frame | null {
  const frame = element?.frame;
  if (!frame) return null;
  const parsed = { x: Number(frame.x), y: Number(frame.y), w: Number(frame.w), h: Number(frame.h) };
  return Object.values(parsed).every(Number.isFinite) && parsed.w > 0 && parsed.h > 0 ? parsed : null;
}

/** Accessibility APIs often expose several identical icon buttons ("Show Detail", "Info") while
 * their row labels are separate static-text nodes. Join those two pieces before showing the map to
 * the model so a semantic target describes the control's actual purpose, not just its glyph. */
function enrichControlLabels(elements: any[]): any[] {
  const generic = /^(show detail|details?|info(?:rmation)?|more|disclosure|ellipsis)$/i;
  const textRoles = new Set(['AXStaticText', 'AXHeading', 'AXLabel']);
  return elements.map(element => {
    const role = String(element?.role || '');
    const label = String(element?.label || '').trim();
    const control = elementFrame(element);
    const needsContext = role === 'AXSlider' ? !label : generic.test(label);
    if (!control || !ACTIONABLE_AX_ROLES.has(role) || !needsContext) return element;

    const centerY = control.y + control.h / 2;
    const rowTexts = elements
      .filter(candidate => candidate !== element && textRoles.has(String(candidate?.role || '')))
      .map(candidate => ({ candidate, frame: elementFrame(candidate) }))
      .filter(({ frame }) => {
        if (!frame) return false;
        const candidateCenterY = frame.y + frame.h / 2;
        const rowTolerance = Math.max(16, Math.min(36, (control.h + frame.h) / 2));
        return Math.abs(candidateCenterY - centerY) <= rowTolerance
          && frame.x + frame.w <= control.x + 8
          && control.x - (frame.x + frame.w) <= (role === 'AXSlider' ? 200 : 450);
      })
      .sort((a, b) => a.frame!.x - b.frame!.x)
      .map(({ candidate }) => String(candidate?.label || candidate?.value || '').trim())
      .filter(text => text && !/^(?:decrease|increase)\s+volume$/i.test(text));
    const contextParts = Array.from(new Set(rowTexts)).slice(role === 'AXSlider' ? -1 : -3);
    let contextLabel = contextParts.join(' · ').slice(0, 120);
    if (role === 'AXSlider' && !contextLabel) {
      const rowButtons = elements
        .filter(candidate => String(candidate?.role || '') === 'AXButton')
        .map(candidate => ({ label: String(candidate?.label || ''), frame: elementFrame(candidate) }))
        .filter(candidate => candidate.frame
          && Math.abs((candidate.frame.y + candidate.frame.h / 2) - centerY) <= 24
          && candidate.frame.x >= control.x - 60
          && candidate.frame.x <= control.x + control.w + 60)
        .map(candidate => candidate.label);
      const hasVolumeStepper = rowButtons.some(text => /^decrease volume$/i.test(text))
        && rowButtons.some(text => /^increase volume$/i.test(text));
      const outputSliderBelow = elements.some(candidate => {
        const frame = elementFrame(candidate);
        return String(candidate?.role || '') === 'AXSlider'
          && /output volume/i.test(String(candidate?.label || candidate?.value || ''))
          && !!frame && frame.y > control.y;
      });
      if (hasVolumeStepper && outputSliderBelow) contextLabel = 'Alert volume';
    }
    if (!contextLabel || contextLabel.toLocaleLowerCase() === label.toLocaleLowerCase()) return element;
    const controlName = label || role.replace(/^AX/, '');
    return {
      ...element,
      original_label: element.label,
      context_label: contextLabel,
      label: `${controlName} — ${contextLabel}`,
    };
  });
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
  pipStatus?(): Promise<LivePipStatus>;
  /** What the next record_start would capture — so the approval layer can phrase the prompt honestly. */
  recordingScopePreview?(): { scope: string; captureSafe: boolean };
  /** Mint a single-use whole-display recording approval token AFTER the user explicitly approved
   * that scope. Only the tool/approval layer calls this; models can never reach it. */
  authorizeFullDisplayRecording?(): string;
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

/** Verbs that ACT on the desktop (vs pure observation) — every one must yield ONE ActionResult. */
const ACTING_VERBS = new Set<DesktopAction>([
  'open', 'click', 'type', 'key', 'set_value', 'drag', 'scroll', 'move',
  'hover', 'hold', 'mouse_down', 'mouse_up', 'close', 'quit_app', 'wait',
]);

/** Invariant: every acting verb's result carries exactly one honest ActionResult. Results that
 * already computed one (post-action evidence, verified close/quit) pass through; anything else
 * gets the truthful default — delivered-but-unverified on success, failed on error. */
export function ensureActionResult(result: DesktopResult): DesktopResult {
  if (result.actionResult || !ACTING_VERBS.has(result.action)) return result;
  if (!result.ok) {
    return { ...result, actionResult: { delivered: false, observed: 'failed', confidence: 'unknown', failureReason: result.error || result.summary } };
  }
  return { ...result, actionResult: { delivered: true, observed: 'unverified', confidence: 'unknown' } };
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

  // NOTE: the Grok-ported circuit breaker that wrapped this helper was removed. It only guarded
  // the FALLBACK driver (never the real sidecar path), so the same action was governed by two
  // conflicting failure policies depending on which driver happened to be active — a misleading
  // half-protection. The runtime's own recovery controller + per-action errors are the one policy.
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
          return { app: r.app, x: r.x, y: r.y, summary: `${cmd.count === 2 ? 'double-' : cmd.count === 3 ? 'triple-' : ''}${cmd.button || 'left'} click at ${cmd.x},${cmd.y}${r.app ? ` in ${r.app}` : ''}` };
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
    return ensureActionResult(await this.runInner(cmd, ctx));
  }

  private async runInner(cmd: DesktopCommand, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<DesktopResult> {
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
      if (cmd.action === 'type' || cmd.action === 'key' || cmd.action === 'close' || cmd.action === 'quit_app') {
        await this.activateApp(cmd.app || '', ctx?.signal);
      }

      if (cmd.action === 'close') {
        // close = close the SELECTED WINDOW only (Cmd+W / Ctrl+W). Quitting the entire application
        // is the separate, high-impact `quit_app` action — close must never tear down other windows
        // or discard unsaved state app-wide.
        const partial = process.platform === 'darwin'
          ? await this.runDarwin({ action: 'key', combo: 'cmd+w', app: cmd.app }, ctx?.signal)
          : process.platform === 'linux'
            ? await this.runLinux({ action: 'key', combo: 'ctrl+w', app: cmd.app }, ctx?.signal)
            : (() => { throw new Error(`desktop control is not supported on ${process.platform}`); })();
        // TRUTHFUL: this driver cannot enumerate windows, so it can DELIVER Cmd+W but cannot verify
        // the window actually closed. Never claim a verified outcome here.
        return {
          ok: true, action: 'close', driver: this.driverName(), ...partial, app: cmd.app,
          actionResult: { delivered: true, observed: 'unverified', postcondition: { query: 'target window closed', matched: false }, confidence: 'unknown', failureReason: undefined },
          summary: `sent close-window (Cmd+W/Ctrl+W) to ${cmd.app} — delivery only; this driver cannot verify the window closed (the application keeps running; use quit_app to quit it entirely)`,
        };
      }

      if (cmd.action === 'quit_app') {
        // High-impact by contract: quits the whole application and may discard unsaved state.
        const partial = process.platform === 'darwin'
          ? await this.runDarwin({ action: 'key', combo: 'cmd+q', app: cmd.app }, ctx?.signal)
          : process.platform === 'linux'
            ? await this.runLinux({ action: 'key', combo: 'alt+f4', app: cmd.app }, ctx?.signal)
            : (() => { throw new Error(`desktop control is not supported on ${process.platform}`); })();
        await this.waitForApp(cmd.app || '', false, ctx?.signal);
        return {
          ok: true, action: 'quit_app', driver: this.driverName(), ...partial, app: cmd.app,
          actionResult: { delivered: true, observed: 'changed', postcondition: { query: 'app no longer frontmost', matched: true }, confidence: 'likely' },
          summary: `quit ${cmd.app} (verified it is no longer frontmost)`,
        };
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

// Transport-level helpers (branding, MCP decode, timeouts) live in transport.ts;
// target-ownership rules live in target.ts. Re-export the target type for existing importers.
export type { ComputerTarget } from './target';

/**
 * Bimax Computer Use — a long-lived, private MCP connection to the embedded native sidecar.
 *
 * The sidecar is derived from trycua/cua 0.8.3 (MIT) but no Cua surface leaks into Bimax: the
 * executable path, session, tool schema, diagnostics, output and fallback are all Bimax-owned.
 * Keeping one live connection is essential because accessibility element tokens are scoped to the
 * observation that created them; spawning a process per action would silently discard that cache.
 */
export class BimaxComputerRuntime implements DesktopRuntimePort {
  private readonly session = `bimax-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  /** Driver transport — the ONE place a sidecar RPC can happen (see transport.ts). */
  private readonly transport: SidecarTransportPort = new SidecarTransport(this.session);
  /** Target ownership — the single authority on which app/window an action goes to (target.ts). */
  private readonly targets = new TargetOwnership();
  private indexedElements = new Map<string, ObservedElement>();
  private observedElements: ObservedElement[] = [];
  private observedTarget: { pid: number; windowId?: number; degraded: boolean; width?: number; height?: number } | null = null;
  private observedWindowFrame: { x: number; y: number; w: number; h: number } | null = null;
  /** Which surface the newest image describes. Context menus/popovers are separate OS windows that
   * a window-scoped PNG can never show, so right-click switches to a full-display observation:
   * image pixels == global display points (identity frame), and physical input skips activation
   * because bring_to_front would dismiss the very menu the model is about to click. */
  private observedSurfaceKind: 'window' | 'display' = 'window';
  /** System Settings reports a sheet as the first app window while its screenshot is composed in
   * the larger parent-window coordinate space. Track the sheet independently so pixels keep mapping
   * through the parent and background clicks can be rejected instead of silently doing nothing. */
  private transientDialogFrame: Frame | null = null;
  /** Single owner of recording state (see recording.ts). Recording is explicit-opt-in only:
   * nothing in the action path may start it — only the record_start case below. */
  private readonly recording = new RecordingController();
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
  private lastStatus = { accessibility: null as boolean | null, screenRecording: null as boolean | null };
  /** Immediate delivery/grounding failures do not reach postActionEvidence, so the visual recovery
   * controller cannot count them. Bound those separately and require a fresh observation. */
  private failedActingStreak = 0;
  /** Presentation-only continuous ScreenCaptureKit preview. Its process and failures are isolated
   * from the action sidecar and exact model screenshot path. */
  private pipGeneration = 0;
  private pipPaused = false;

  public constructor(
    private readonly fallback: DesktopRuntimePort = new DesktopRuntime(),
    private readonly livePip: LivePipPort = new NativeLivePip(),
  ) {}

  public quickStatus() {
    if (!this.transport.available()) return this.fallback.quickStatus();
    return { driver: 'bimax-computer-use 0.8.3', ready: true, ...this.lastStatus };
  }

  /** Record/refresh the active native-window surface from the current target + observed geometry.
   * Additive: this tracks WHAT the agent is operating on and who owns input; it does not change how
   * actions are delivered (that routing stays in run() until Stage 3 moves it behind chooseMechanism). */
  private syncSurface(opts: { focusOwner?: InputOwner } = {}): void {
    const target = this.targets.current();
    if (!target?.pid) return;
    this.surfaces.register({
      id: `native:${target.pid}`,
      kind: 'native-window',
      app: target.app || undefined,
      pid: target.pid,
      windowId: target.windowId,
      bounds: this.observedWindowFrame ? { ...this.observedWindowFrame } : undefined,
      ...(opts.focusOwner ? { focusOwner: opts.focusOwner } : {}),
    });
    this.syncLivePip();
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

  /** PiP is a presentation-only preview. It is never used as an input or coordinate surface. */
  public async pipStatus(): Promise<LivePipStatus> {
    const cfg = await loadConfig().catch(() => ({ computerPip: false } as any));
    const current = this.livePip.status();
    return {
      ...current,
      enabled: cfg.computerPip === true,
      captureSafe: !!this.captureSurface(),
      surface: this.captureSurface()?.label || current.surface,
    };
  }

  /** Resolve configuration asynchronously without making an observe/action wait for UI startup.
   * Generation checks prevent a late config read from resurrecting PiP after dispose or retarget. */
  private syncLivePip(): void {
    const generation = ++this.pipGeneration;
    const target = this.pipPaused ? null : this.captureSurface();
    void loadConfig()
      .then(cfg => {
        if (generation !== this.pipGeneration) return;
        this.livePip.sync(target, cfg.computerPip === true);
      })
      .catch(() => {
        if (generation === this.pipGeneration) this.livePip.sync(null, false);
      });
  }

  private sessionStateFile(cwd: string): string { return path.join(cwd, '.bimax', 'computer', 'session.json'); }

  /** Where the durable session state currently lives (active surface + compressed action history). */
  private buildSessionState(): ComputerSessionState {
    const s = this.surfaces.active();
    return {
      version: 1, updatedAt: Date.now(),
      surface: s ? { id: s.id, kind: s.kind, app: s.app, pid: s.pid, windowId: s.windowId, bounds: s.bounds, focusOwner: s.focusOwner } : null,
      history: this.actionHistory.summary(8),
      recordingDir: this.recording.outputDir,
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
    const app = this.targets.current()?.app;
    if (!persisted?.surface || !app || persisted.surface.app !== app) return;
    this.actionHistory = ActionHistory.fromSummary(persisted.history);
    if (this.actionHistory.total > 0) {
      cliEvents.emit('status', `Resumed ${app} computer-use session — ${this.actionHistory.total} prior action${this.actionHistory.total === 1 ? '' : 's'} restored`);
    }
  }
  /** Watchdog view: is the sidecar connected, and how long since the last real activity? */
  public health(): { connected: boolean; idleMs: number; lastActivityAt: number } {
    return this.transport.health();
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
    this.pipPaused = true;
    this.syncLivePip();
    cliEvents.emit('status', s
      ? `Computer use paused — you have control of ${s.app || 'the surface'}; the agent will not act until you resume`
      : 'Computer use paused — the agent will not act until you resume');
    return { ok: true, surface: s?.id };
  }

  /** Resume agent control of the active surface after a user takeover. */
  public resume(): { ok: boolean; surface?: string } {
    const s = this.surfaces.active();
    if (s) this.surfaces.claimInput(s.id, 'agent', { force: true });
    this.pipPaused = false;
    this.syncLivePip();
    cliEvents.emit('status', 'Computer use resumed — the agent has control again');
    return { ok: true, surface: s?.id };
  }

  public describeTarget(cmd: DesktopCommand) {
    const key = cmd.elementToken ? `token:${cmd.elementToken}`
      : cmd.elementIndex != null ? `index:${Math.floor(cmd.elementIndex)}` : '';
    return key ? this.indexedElements.get(key) || null : null;
  }

  public async dispose(): Promise<void> {
    const wasRecording = this.recording.started;
    // Persist a final durable snapshot (active surface + compressed history) BEFORE tearing state
    // down, so an interrupted run can be resumed via loadPersistedState() on the next launch.
    try { writeSessionState(this.sessionStateFile(this.lastCwd), this.buildSessionState()); }
    catch { /* best-effort */ }
    // Session-scoped identity and observations must never leak into the next user turn. In
    // particular, closing the client is what removes the experimental PiP window.
    this.targets.clear();
    this.pipGeneration++;
    this.pipPaused = false;
    this.indexedElements.clear();
    this.observedElements = [];
    this.observedTarget = null;
    this.observedWindowFrame = null;
    this.observedSurfaceKind = 'window';
    this.transientDialogFrame = null;
    this.recording.reset();
    this.surfaces.clear();
    this.prevFrameHash = undefined;
    this.noChangeStreak = 0;
    this.recovery.reset();
    this.actionHistory.reset();
    this.resumedFromDisk = false; // a session ended; the next open may resume from disk again
    this.lastPersistAt = 0;
    await Promise.all([
      this.transport.dispose({ stopRecording: wasRecording }),
      this.livePip.stop(),
    ]);
  }

  /** Start (or join) the sidecar spawn/handshake without waiting on it — lets boot time overlap
   * with human read/decision time (e.g. an approval prompt) instead of starting after Enter. */
  public warm(): void { this.transport.warm(); }

  /** One sidecar RPC, via the extracted transport (spawn/handshake/timeouts live there). */
  private call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return this.transport.call(name, args);
  }

  /** Native applications always receive physical foreground input. The retired background mode
   * animated an overlay cursor but SwiftUI/System Settings frequently ignored its synthetic event.
   * Explicit deliveryMode remains only as an internal test/diagnostic seam; model arguments are
   * stripped by ComputerTool and persisted legacy preferences cannot select the unreliable path. */
  private async defaultDelivery(cmd: DesktopCommand): Promise<'background' | 'foreground'> {
    if (cmd.deliveryMode) return cmd.deliveryMode;
    return 'foreground';
  }

  /** Single-use whole-display approval tokens. Minted ONLY by authorizeFullDisplayRecording()
   * (called by the tool layer AFTER a governor-approved whole-display prompt) and consumed by the
   * next record_start. Unforgeable by the model: its arguments are stripped of any token field. */
  private readonly fullDisplayTokens = new Set<string>();

  /** What the next record_start would capture — lets the approval layer phrase the prompt honestly
   * BEFORE any recording starts. */
  public recordingScopePreview(): { scope: string; captureSafe: boolean } {
    const scoped = this.captureSurface();
    return { scope: scoped ? scoped.label : 'whole display', captureSafe: !!scoped };
  }

  /** Mint a single-use whole-display recording approval token. MUST only be called after the user
   * explicitly approved whole-display capture (the governor prompt in the tool layer). */
  public authorizeFullDisplayRecording(): string {
    const token = crypto.randomBytes(16).toString('hex');
    this.fullDisplayTokens.add(token);
    return token;
  }

  /**
   * Explicit recording start (the ONLY path that can begin a recording — there is no auto-record):
   *   - requires the opt-in `computerRecord` config to be true;
   *   - scopes the capture to the agent's own window when one exists;
   *   - refuses whole-display VIDEO capture unless a valid governor-issued single-use token is
   *     presented (a model-supplied boolean or guessed token can never authorize it).
   */
  private async startRecording(cwd: string, cmd: DesktopCommand): Promise<any> {
    const cfg = await loadConfig().catch(() => ({} as any));
    if (cfg.computerRecord !== true) {
      throw new Error('screen recording is disabled — it is opt-in. Enable it first (/computer record on), then retry record_start.');
    }
    // Consume the token exactly once, and only if it was genuinely minted by this runtime.
    const approvedFullDisplay = !!cmd.fullDisplayToken && this.fullDisplayTokens.delete(cmd.fullDisplayToken);
    return this.recording.start({
      cwd,
      outputDir: cmd.outputDir,
      recordVideo: cmd.recordVideo !== false,
      approveFullDisplay: approvedFullDisplay,
      scopeTarget: this.captureSurface(),
      call: (name, args) => this.call(name, args),
    });
  }

  private resolveObservedElement(query: string, target: ComputerTarget): { elementToken?: string; elementIndex?: number; label?: string; role?: string; frame?: unknown } {
    if (!this.observedTarget || this.observedTarget.pid !== target.pid || this.observedTarget.windowId !== target.windowId) {
      throw new Error('semantic targeting needs a fresh observe of the current window');
    }
    const clean = (value: unknown) => String(value || '').trim().toLocaleLowerCase();
    const needle = clean(query);
    if (!needle) throw new Error('semantic query cannot be empty');
    const score = (element: typeof this.observedElements[number]): number => {
      if (ACTIONABLE_AX_ROLES.has(String(element.role || '')) && clean(element.contextLabel) === needle) return -1;
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
      throw new Error(`semantic query "${query}" is ambiguous: ${choices}; observe with a narrower query`);
    }
    return Array.from(unique.values())[0].element;
  }

  private assertClickableSemanticTarget(element: { role?: string; label?: string }): void {
    const role = String(element.role || '');
    if (STRUCTURAL_AX_ROLES.has(role)) {
      throw new Error(`"${element.label || role.replace(/^AX/, '')}" is a structural container, not a clickable control; choose a labeled button/field/row or a visible screenshot point`);
    }
    if (role === 'AXSlider') {
      throw new Error(`"${element.label || 'Slider'}" is a slider; use set_value with its fresh query/elementToken/elementIndex (1 = maximum, 0 = minimum) instead of an approximate click`);
    }
  }

  private sliderAtScreenshotPoint(point: { x: number; y: number }): ObservedElement | null {
    const shot = this.observedTarget;
    const windowFrame = this.observedWindowFrame;
    if (!shot?.width || !shot?.height || !windowFrame) return null;
    for (const element of this.observedElements) {
      if (element.role !== 'AXSlider') continue;
      const frame = elementFrame(element);
      if (!frame) continue;
      const screenshotFrame = globalFrameToScreenshot(
        frame,
        { width: shot.width, height: shot.height },
        windowFrame,
      );
      if (screenshotFrame && pointInFrame(point, screenshotFrame)) return element;
    }
    return null;
  }

  private normalizedControlValue(role: string, value: string): { value: string; endpoint?: 'maximum' | 'minimum' } {
    const clean = value.trim().toLocaleLowerCase();
    if (role !== 'AXSlider') return { value };
    if (/^(?:1(?:\.0+)?|100\s*%|max(?:imum)?|full)$/i.test(clean)) {
      return { value: '1', endpoint: 'maximum' };
    }
    if (/^(?:0(?:\.0+)?|0\s*%|min(?:imum)?|mute(?:d)?|off)$/i.test(clean)) {
      return { value: '0', endpoint: 'minimum' };
    }
    const numeric = Number(clean.replace(/\s*%$/, ''));
    if (!Number.isFinite(numeric)) {
      throw new Error('slider set_value needs a number from 0 to 1, a percentage from 0% to 100%, or maximum/full/minimum/mute');
    }
    const normalized = clean.endsWith('%') ? numeric / 100 : numeric;
    if (normalized < 0 || normalized > 1) throw new Error('slider set_value must be between 0 and 1 (or 0% and 100%)');
    return { value: String(normalized) };
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

  private resolveObservedHandle(target: ComputerTarget, cmd: Pick<DesktopCommand, 'elementToken' | 'elementIndex'>) {
    if (!this.observedTarget || this.observedTarget.pid !== target.pid || this.observedTarget.windowId !== target.windowId) {
      throw new Error('element targeting needs a fresh observe of this exact window');
    }
    const key = cmd.elementToken
      ? `token:${cmd.elementToken}`
      : cmd.elementIndex != null ? `index:${Math.floor(cmd.elementIndex)}` : '';
    const resolved = key ? this.indexedElements.get(key) : undefined;
    if (!resolved) throw new Error('element handle is stale or missing; observe again and use a handle from the newest result');
    return resolved;
  }

  private screenshotPixelToGlobalPoint(point: { x: number; y: number }, liveFrame?: Frame | null): { x: number; y: number } | null {
    const shot = this.observedTarget;
    const frame = liveFrame || this.observedWindowFrame;
    if (!shot?.width || !shot?.height || !frame?.w || !frame?.h) return null;
    return screenshotToGlobal(point, { width: shot.width, height: shot.height }, frame);
  }

  private appNamesMatch(actual: string | undefined, expected: string | undefined): boolean {
    if (!actual || !expected) return true;
    const clean = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
    const a = clean(actual), e = clean(expected);
    return a === e || a.includes(e) || e.includes(a);
  }

  /** Activate the owned window and prove its application became frontmost before posting physical
   * input. A click sent while a window is merely visible but not key is often consumed as an
   * activation click by macOS, which looks exactly like “cursor clicked, control did nothing”. */
  private async ensurePhysicalTargetFrontmost(target: ComputerTarget): Promise<void> {
    await this.call('bring_to_front', { pid: target.pid, window_id: target.windowId });
    for (const waitMs of [25, 50, 100]) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
      const actual = await this.frontmostApp().catch(() => '');
      if (!actual || this.appNamesMatch(actual, target.app)) return;
      await this.call('bring_to_front', { pid: target.pid, window_id: target.windowId });
    }
    const actual = await this.frontmostApp().catch(() => '');
    throw new Error(`could not make ${target.app || `pid ${target.pid}`} frontmost before physical input${actual ? ` (frontmost is ${actual})` : ''}`);
  }

  /** Resolve the current live window frame after activation. The model acts on screenshot pixels;
   * mapping those pixels through the live bounds makes window moves/resizes between observe and act
   * safe without treating the separately-scaled PiP preview as a coordinate surface. */
  private async liveWindowFrame(target: ComputerTarget): Promise<Frame | null> {
    try {
      const data = await this.call('list_windows', { pid: target.pid });
      const windows = Array.isArray(data?.windows) ? data.windows : [];
      const window = windows.find((candidate: any) => Number(candidate?.window_id) === Number(target.windowId));
      const bounds = window?.bounds;
      const frame = bounds && {
        x: Number(bounds.x), y: Number(bounds.y),
        w: Number(bounds.width ?? bounds.w), h: Number(bounds.height ?? bounds.h),
      };
      if (frame && [frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) && frame.w > 0 && frame.h > 0) return frame;
    } catch { /* the observed AX frame remains a safe fallback */ }
    return this.observedWindowFrame;
  }

  /** Capture the FULL display (point-scaled: image pixels == global points) as the newest
   * observation. Used after right-click: the context menu is its own OS window, invisible in any
   * window-scoped PNG — without this the model chose its next click blind. Element handles are
   * cleared because their frames were expressed in the previous window image. */
  private async displayObservation(target: ComputerTarget, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<Record<string, any>> {
    const shot = await this.fallback.run({ action: 'screenshot', display: 1 }, ctx);
    if (!shot.ok || !shot.screenshot) {
      return { visualEvidenceError: shot.error || 'full-display capture failed after opening the transient surface' };
    }
    let dims: { width: number; height: number } | null = null;
    try { dims = pngDimensionsFromBytes(fs.readFileSync(shot.screenshot)); } catch { /* handled below */ }
    if (!dims?.width || !dims?.height) return { visualEvidenceError: 'full-display capture has unreadable dimensions' };
    this.indexedElements.clear();
    this.observedElements = [];
    this.observedTarget = { pid: target.pid, windowId: target.windowId, degraded: true, width: dims.width, height: dims.height };
    this.observedWindowFrame = { x: 0, y: 0, w: dims.width, h: dims.height };
    this.observedSurfaceKind = 'display';
    const frameHash = this.screenshotHash(shot.screenshot);
    if (frameHash) this.prevFrameHash = frameHash;
    return {
      screenshot: shot.screenshot, frameHash, width: dims.width, height: dims.height,
      elements: [], degraded: true,
      coordinateSpace: { xY: 'screenshot_pixels', elementFrames: 'screenshot_pixels', normalized: '0-1000' },
      completionGuidance: `${COMPUTER_COMPLETION_GUIDANCE} This image is the FULL DISPLAY because a context menu/popover may be open as its own window: click the visible menu item by x/y in THIS image, or press key escape to dismiss it. Element handles from earlier window observations are no longer valid.`,
    };
  }

  private async preparePhysicalPoint(target: ComputerTarget, screenshotPoint: { x: number; y: number }): Promise<{ x: number; y: number }> {
    if (this.observedSurfaceKind === 'display') {
      // The newest image is the whole display at point scale (identity mapping). Skip activation:
      // bring_to_front would dismiss the open menu/popover the model is clicking, and the dialog
      // guard is window-scoped evidence that does not apply to a display-wide frame.
      const global = this.screenshotPixelToGlobalPoint(screenshotPoint, this.observedWindowFrame);
      if (!global) throw new Error('could not map the display point; take a fresh screenshot');
      return global;
    }
    await this.ensurePhysicalTargetFrontmost(target);
    const frame = await this.liveWindowFrame(target);
    const global = this.screenshotPixelToGlobalPoint(screenshotPoint, frame);
    if (!global || (frame && !pointInFrame(global, frame))) {
      throw new Error('could not map the screenshot point into the live target window; re-observe after moving or resizing the window');
    }
    if (this.transientDialogFrame && !pointInFrame(global, this.transientDialogFrame)) {
      throw new Error('a foreground dialog is blocking that background point — click Done/Close/Cancel inside the dialog or press Escape before navigating the page behind it');
    }
    return global;
  }

  private verifyPhysicalClick(target: ComputerTarget, requested: { x: number; y: number }, result: DesktopResult): void {
    if (result.x != null && result.y != null && Math.hypot(result.x - requested.x, result.y - requested.y) > 3) {
      throw new Error(`native cursor did not land at the requested point (${requested.x},${requested.y}); it reported ${result.x},${result.y}`);
    }
    if (result.app && !this.appNamesMatch(result.app, target.app)) {
      throw new Error(`physical click landed while ${result.app} was frontmost, not ${target.app || `pid ${target.pid}`}`);
    }
  }

  /** Resolve a point in the exact latest screenshot. The final screenshot→global mapping happens
   * only after activation, through the live window frame, so a move/resize cannot offset input. */
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
    return { x, y };
  }

  /** hover/hold/mouse_down/mouse_up: physical-cursor primitives delivered by the native helper after
   * bringing the target window to front. These ARE the real cursor, so they only run foreground. */
  private async pointerPrimitive(
    primitive: 'hover' | 'hold' | 'mouse_down' | 'mouse_up', target: ComputerTarget, cmd: DesktopCommand,
    cwd: string, session: string, ctx?: { cwd?: string; signal?: AbortSignal },
  ): Promise<DesktopResult> {
    const driver = 'bimax-computer-use 0.8.3';
    const screenshotPoint = this.groundScreenshotPoint(target, cmd, primitive);
    const global = await this.preparePhysicalPoint(target, screenshotPoint);
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

  /** Delegates to the extracted TargetOwnership (target.ts) — the one authority on the recipient. */
  private targetFor(cmd: DesktopCommand): ComputerTarget | null {
    return this.targets.resolveFor(cmd);
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
    // Most actionable controls appear in the first few hundred AX nodes. A 1000-node traversal on
    // every automatic post-action frame made each visible click feel sluggish. Explicit queried
    // observations still scan deeper; routine evidence refreshes use a smaller, measured floor.
    const scanElements = cmd.query
      ? Math.max(600, maxElements)
      : Math.max(300, maxElements);
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
    if (cmd.includeScreenshot !== false && (!screenshotWidth || !screenshotHeight)) {
      const nativeFrontmost = await this.fallback.frontmostApp().catch(() => '');
      if (/loginwindow/i.test(nativeFrontmost)) {
        throw new Error('the Mac screen is locked (loginwindow is frontmost), so no window screenshot or mouse action can be verified — unlock the Mac and retry');
      }
      throw new Error('the native sidecar returned no usable screenshot pixels; stop acting and retry only after Screen Recording permission and the visible desktop are available');
    }
    const rawElements = Array.isArray(data?.elements) ? data.elements : [];
    const menuRoles = new Set(['AXMenuBar', 'AXMenuBarItem', 'AXMenu', 'AXMenuItem']);
    const windowElements = enrichControlLabels(
      rawElements.filter((element: any) => !menuRoles.has(String(element?.role || ''))),
    );
    const degraded = windowElements.length === 0;
    // The PNG is captured for target.windowId, so THAT window's live CG bounds are the authoritative
    // mapping frame. The first AXWindow in the walk can belong to a DIFFERENT window of the same app
    // (a sheet vs its parent) — mapping pixels through the wrong window's frame is exactly how a
    // click "lands on a random control". Validate candidates against the PNG's aspect ratio and
    // fall back to the AX frame only when the CG bounds are unavailable or geometrically implausible.
    const axWindowFrame = windowElements.find((element: any) => String(element?.role || '') === 'AXWindow')?.frame;
    const axFrame: Frame | null = axWindowFrame && Number(axWindowFrame.w) > 0 && Number(axWindowFrame.h) > 0
      ? { x: Number(axWindowFrame.x), y: Number(axWindowFrame.y), w: Number(axWindowFrame.w), h: Number(axWindowFrame.h) }
      : null;
    let cgFrame: Frame | null = null;
    try {
      const wins = await this.call('list_windows', { pid: target.pid });
      const win = (Array.isArray(wins?.windows) ? wins.windows : [])
        .find((candidate: any) => Number(candidate?.window_id) === Number(target.windowId));
      const bounds = win?.bounds;
      // Require an explicit origin: a bounds record without x/y cannot anchor a pixel mapping.
      const parsed = bounds && {
        x: Number(bounds.x), y: Number(bounds.y),
        w: Number(bounds.width ?? bounds.w), h: Number(bounds.height ?? bounds.h),
      };
      if (parsed && [parsed.x, parsed.y, parsed.w, parsed.h].every(Number.isFinite) && parsed.w > 0 && parsed.h > 0) cgFrame = parsed;
    } catch { /* AX frame remains the fallback authority */ }
    const pngAspect = screenshotWidth && screenshotHeight ? screenshotWidth / screenshotHeight : null;
    const aspectMatchesPng = (frame: Frame) => pngAspect == null || Math.abs(frame.w / frame.h - pngAspect) <= pngAspect * 0.03;
    this.observedWindowFrame =
      (cgFrame && aspectMatchesPng(cgFrame) ? cgFrame : null)
      || (axFrame && aspectMatchesPng(axFrame) ? axFrame : null)
      || axFrame;
    this.observedSurfaceKind = 'window';
    this.observedTarget = {
      pid: target.pid, windowId: target.windowId, degraded,
      width: screenshotWidth,
      height: screenshotHeight,
    };
    this.indexedElements.clear();
    this.observedElements = [];
    const enrichedByIndex = new Map(windowElements
      .filter((element: any) => element?.element_index != null)
      .map((element: any) => [Number(element.element_index), element]));
    const enrichedByToken = new Map(windowElements
      .filter((element: any) => element?.element_token)
      .map((element: any) => [String(element.element_token), element]));
    for (const rawElement of rawElements as any[]) {
      const element = (rawElement?.element_token && enrichedByToken.get(String(rawElement.element_token)))
        || (rawElement?.element_index != null && enrichedByIndex.get(Number(rawElement.element_index)))
        || rawElement;
      const safe = {
        label: element?.label, role: element?.role, value: element?.value,
        originalLabel: element?.original_label, contextLabel: element?.context_label,
        description: element?.description, frame: element?.frame,
        elementToken: element?.element_token ? String(element.element_token) : undefined,
        elementIndex: element?.element_index != null ? Number(element.element_index) : undefined,
      };
      if (element?.element_token) this.indexedElements.set(`token:${element.element_token}`, safe);
      if (element?.element_index != null) this.indexedElements.set(`index:${Number(element.element_index)}`, safe);
      if (!menuRoles.has(String(element?.role || ''))) this.observedElements.push(safe);
    }
    const verificationQuery = cmd.query?.trim() || '';
    const queryNeedle = verificationQuery.toLocaleLowerCase();
    const matchesQuery = (element: any) => !!queryNeedle
      && JSON.stringify(element).toLocaleLowerCase().includes(queryNeedle);
    const semanticMatches = queryNeedle ? windowElements.filter(matchesQuery) : [];
    const orderedElements = semanticMatches.length > 0
      ? [...semanticMatches, ...windowElements.filter((element: any) => !matchesQuery(element))]
      : (windowElements.length > 0
        ? [...windowElements.filter((element: any) => ACTIONABLE_AX_ROLES.has(String(element?.role || ''))),
          ...windowElements.filter((element: any) => !ACTIONABLE_AX_ROLES.has(String(element?.role || '')))]
        : rawElements);
    const elements = orderedElements.slice(0, maxElements).map((element: any) => {
      const compact: Record<string, unknown> = {};
      for (const key of ['element_index', 'element_token', 'role', 'label', 'context_label', 'value', 'description', 'enabled', 'focused', 'frame']) {
        if (element?.[key] === undefined || element?.[key] === null || element?.[key] === '') continue;
        if (key === 'frame' && this.observedWindowFrame && screenshotWidth && screenshotHeight) {
          compact.frame = globalFrameToScreenshot(
            { x: Number(element.frame.x), y: Number(element.frame.y), w: Number(element.frame.w), h: Number(element.frame.h) },
            { width: screenshotWidth, height: screenshotHeight }, this.observedWindowFrame,
          ) || undefined;
        } else compact[key] = element[key];
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
    if (this.targets.owns(target.pid)) this.syncSurface();
    const frameHash = cmd.includeScreenshot === false ? undefined : this.screenshotHash(screenshotFile);
    // Any fresh frame becomes the baseline the next action's outcome is judged against.
    if (frameHash) this.prevFrameHash = frameHash;
    return {
      ok: true, action: cmd.action === 'screenshot' ? 'screenshot' : 'observe', driver: 'bimax-computer-use 0.8.3',
      app: target.app, pid: target.pid, windowId: target.windowId,
      screenshot: screenshotFile, frameHash,
      width: screenshotWidth, height: screenshotHeight,
      coordinateSpace: { xY: 'screenshot_pixels', elementFrames: 'screenshot_pixels', normalized: '0-1000' },
      completionGuidance: this.transientDialogFrame
        ? `${COMPUTER_COMPLETION_GUIDANCE} A foreground dialog is currently detected; dismiss it before attempting any background control.`
        : COMPUTER_COMPLETION_GUIDANCE,
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
      this.targets.retargetWindow(target.pid, refreshed.windowId);
      // Capture the pre-action baseline BEFORE observeTarget overwrites it with the fresh frame.
      const prev = this.prevFrameHash;
      // A 24-element budget was exhausted by the System Settings sidebar before the first main-pane
      // control appeared. Preserve enough fresh targets for details/info/disclosure controls while
      // the sidecar still performs the same bounded 1000-element internal scan.
      const observed = await this.observeTarget(refreshed, cwd, session, {
        action: 'observe', maxElements: POST_ACTION_ELEMENT_BUDGET,
      });
      // Judge the action by the SCREEN, not by the driver's success return (Stage 6).
      const progressCheck = classifyVerification({
        ok: true, prevFrameHash: prev, nextFrameHash: observed.frameHash,
        hadScreenshot: !!observed.screenshot,
        expectedApp: target.app || undefined, actualApp: observed.app || undefined,
        targetWindowId: refreshed.windowId, actualWindowId: observed.windowId,
      });
      const verb = this.activeAction || 'action';
      // Only genuinely state-mutating verbs feed the no-progress accounting. Verbs that are
      // legitimately visually static (wait, hover, move, a mouse_up completing a gesture) must not
      // accrue a false "stuck" state just because the pixels didn't change.
      const countsForProgress = ['click', 'type', 'key', 'set_value', 'drag', 'scroll', 'open'].includes(verb);
      if (countsForProgress) {
        if (progressCheck.outcome === 'no-change') this.noChangeStreak++; else this.noChangeStreak = 0;
      }
      // Durable, bounded record of what the agent did and whether it worked (Stage 7).
      this.recordAction(verb, target.app, progressCheck.outcome);
      // Feed the outcome to the bounded recovery authority (Stage 6). Its decision is surfaced to the
      // model, and once it latches stop-failure the run() guard refuses further acting verbs.
      const recoveryDecision: RecoveryDecision = countsForProgress ? this.recovery.record(progressCheck.outcome) : 'continue';
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
        coordinateSpace: observed.coordinateSpace,
        completionGuidance: observed.completionGuidance,
        elements: observed.elements, degraded: observed.degraded, windowId: refreshed.windowId,
        progressCheck, actionResult: toActionResult(progressCheck),
        recoveryDecision, ...(recoveryHint ? { recoveryHint } : {}),
      };
    } catch (err: any) {
      const visualEvidenceError = bimaxBrand(String(err?.message || err)).slice(0, 500);
      // The action may have changed the UI, so the pre-action frame and all handles are now stale.
      // Invalidate them immediately; the observe-before-act gate will refuse another input until a
      // real fresh capture succeeds.
      this.observedTarget = null;
      this.observedWindowFrame = null;
      this.observedSurfaceKind = 'window';
      this.indexedElements.clear();
      this.observedElements = [];
      this.prevFrameHash = undefined;
      const progressCheck = classifyVerification({
        ok: true,
        hadScreenshot: false,
        expectedApp: target.app || undefined,
        targetWindowId: target.windowId,
      });
      this.recordAction(this.activeAction || 'action', target.app, progressCheck.outcome);
      return {
        visualEvidenceError,
        progressCheck,
        actionResult: toActionResult(progressCheck),
        recoveryDecision: this.recovery.record(progressCheck.outcome),
        recoveryHint: 'Perception is stale. Re-observe before any next input.',
      };
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
        const area = (w: any) => Number(w?.bounds?.width || 0) * Number(w?.bounds?.height || 0);
        const largest = visible.reduce((best: any, candidate: any) => area(candidate) > area(best) ? candidate : best, visible[0]);
        const current = visible.find((w: any) => Number(w.window_id) === target.windowId);
        // In System Settings a modal sheet is listed before the main window, but the sidecar PNG is
        // the full composed main window. Pinning the sheet id therefore compressed every screenshot
        // coordinate into its tiny frame. Use the main surface for capture/mapping and retain the
        // sheet bounds as a modal input guard.
        const isSystemSettings = /(?:system settings|com\.apple\.systempreferences)/i.test(target.app);
        const dialog = isSystemSettings
          ? visible.find((w: any) => Number(w.window_id) !== Number(largest.window_id)
            && area(w) >= 20_000 && area(w) < area(largest) * 0.5)
          : undefined;
        this.transientDialogFrame = dialog ? {
          x: Number(dialog.bounds.x), y: Number(dialog.bounds.y),
          w: Number(dialog.bounds.width), h: Number(dialog.bounds.height),
        } : null;
        const good = current && area(current) >= area(largest) * 0.5 ? current : largest;
        return { ...target, windowId: Number(good?.window_id || 0) || target.windowId };
      }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1))); // let it finish rendering
    }
    // Still nothing properly sized after retrying — keep the CURRENT window id rather than pin a
    // degenerate strip; a slightly stale-but-real window captures better than a 35px menu-bar proxy.
    if (windows.length === 0 || target.windowId) return target;
    return { ...target, windowId: Number(windows[0]?.window_id || 0) || target.windowId };
  }

  private async hasUsableTargetWindow(target: ComputerTarget): Promise<boolean> {
    try {
      const data = await this.call('list_windows', { pid: target.pid });
      const windows = Array.isArray(data?.windows) ? data.windows : [];
      return windows.some((w: any) => Number(w?.window_id) === target.windowId
        && w?.is_on_screen !== false
        && Number(w?.bounds?.width || 0) > 100
        && Number(w?.bounds?.height || 0) > 100);
    } catch {
      return false;
    }
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
    const frame = await this.liveWindowFrame(target);
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
    if (!this.transport.available()) return this.fallback.frontmostApp();
    try {
      const data = await this.call('list_apps');
      const active = (Array.isArray(data?.apps) ? data.apps : []).find((app: any) => app.active);
      return String(active?.name || '');
    } catch {
      return this.fallback.frontmostApp();
    }
  }

  public async run(cmd: DesktopCommand, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<DesktopResult> {
    const result = ensureActionResult(await this.runInner(cmd, ctx));
    if (result.visualEvidenceError && ACTING_VERBS.has(cmd.action)) {
      result.summary = `${cmd.action} was delivered, but the fresh post-action screen could not be captured. Re-observe before any next input: ${result.visualEvidenceError}`;
    }
    if (result.ok && (ACTING_VERBS.has(cmd.action) || cmd.action === 'observe' || cmd.action === 'screenshot')) {
      this.failedActingStreak = 0;
    } else if (!result.ok && ACTING_VERBS.has(cmd.action) && !/\brefused:/.test(result.summary || '')) {
      // Our own latch refusals are not new delivery failures — counting them would let the
      // three-strike guard inflate itself while the model is already being told to re-observe.
      this.failedActingStreak++;
    }
    return result;
  }

  private async runInner(cmd: DesktopCommand, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<DesktopResult> {
    if (!this.transport.available()) return this.fallback.run(cmd, ctx);
    const cwd = ctx?.cwd || process.cwd();
    this.lastCwd = cwd;
    this.activeAction = cmd.action;
    const driver = 'bimax-computer-use 0.8.3';
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
        // Hard observe-before-act gate. Naming a pid/app is not visual evidence, and a failed
        // post-action capture invalidates the old frame. `move` changes no application state.
        const needsFreshFrame = cmd.action !== 'move';
        const frameMatchesTarget = !!target
          && !!this.observedTarget
          && this.observedTarget.pid === target.pid
          && this.observedTarget.windowId === target.windowId
          && !!this.observedTarget.width
          && !!this.observedTarget.height;
        if (needsFreshFrame && !frameMatchesTarget) {
          return {
            ok: false, action: cmd.action, driver,
            error: 'a fresh screenshot of the exact target window is required before input — open or observe it first, then choose one action from that frame',
            summary: `${cmd.action} refused: observe the target window first`,
          };
        }
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
        // Immediate failures and visual no-progress are independent latches. When both are active,
        // preserve the more specific recovery-budget diagnosis; otherwise the generic three-strike
        // guard would mask it after a failed observe and make recovery state appear to have changed.
        if (this.failedActingStreak >= 3) {
          return { ok: false, action: cmd.action, driver,
            error: 'three consecutive input actions failed — do not click again until you re-observe or reopen the intended app and use handles from that fresh target',
            summary: `${cmd.action} refused: repeated input failures require a fresh observation` };
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
          // Embedded mode intentionally runs as a child of ai.bimax.cli, so the helper executable
          // has no standalone CFBundleIdentifier. TCC grants belong to the responsible host. The
          // upstream health report calls that expected identity shape a failure even when every
          // real observation/input capability passes; do not misreport a fully working runtime as
          // degraded for that one inapplicable check.
          const failedChecks = checks.filter((check: any) => check?.status === 'fail');
          const embeddedIdentityOnly = this.lastStatus.accessibility === true
            && this.lastStatus.screenRecording === true
            && failedChecks.length === 1
            && failedChecks[0]?.name === 'bundle_identity';
          const overall = embeddedIdentityOnly ? 'ready' : (data?.overall || 'ready');
          const details = embeddedIdentityOnly
            ? {
              ...data, overall: 'ready', attribution: 'embedded_host',
              note: 'Bundle identity is supplied by the responsible Bimax host; native permissions and capabilities passed.',
            }
            : data;
          return { ok: overall !== 'failed', action: cmd.action, driver, ...this.lastStatus, details, summary: `Bimax Computer Use ${overall}` };
        }
        case 'request_access': {
          const data = await this.call('check_permissions', { prompt: true });
          this.lastStatus = { accessibility: !!data?.accessibility, screenRecording: !!data?.screen_recording };
          return { ok: true, action: cmd.action, driver, ...this.lastStatus, details: data, summary: 'Bimax Computer Use permission check completed' };
        }
        case 'record_start': {
          const data = await this.startRecording(cwd, cmd);
          return {
            ok: true, action: cmd.action, driver, details: data,
            recording: { enabled: true, outputDir: this.recording.outputDir, scope: this.recording.scope, captureSafe: this.recording.captureSafe },
            summary: `computer-use recording started${cmd.recordVideo === false ? '' : ' with screen video'} → ${this.recording.outputDir} (capturing ${this.recording.scope}${this.recording.captureSafe ? '' : ' — WHOLE DISPLAY, explicitly approved'})`,
          };
        }
        case 'record_status': {
          const data = await this.call('get_recording_state');
          const enabled = !!data?.enabled;
          return {
            ok: true, action: cmd.action, driver, details: data,
            recording: {
              enabled, outputDir: String(data?.output_dir || this.recording.outputDir || '') || undefined,
              videoPath: String(data?.last_video_path || '') || undefined,
              error: String(data?.last_error || this.recording.error || '') || undefined,
              scope: enabled ? this.recording.scope : undefined,
              captureSafe: enabled ? this.recording.captureSafe : undefined,
            },
            summary: enabled ? `computer-use recording active → ${data?.output_dir || this.recording.outputDir}` : 'computer-use recording is off',
          };
        }
        case 'record_stop': {
          const data = await this.call('stop_recording');
          this.recording.markStopped();
          const videoPath = String(data?.last_video_path || data?.video_path || '') || undefined;
          return {
            ok: true, action: cmd.action, driver, details: data,
            recording: { enabled: false, outputDir: this.recording.outputDir, videoPath },
            summary: `computer-use recording stopped${videoPath ? ` → ${videoPath}` : this.recording.outputDir ? ` → ${this.recording.outputDir}` : ''}`,
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
          const requestedApp = cmd.app?.trim();
          // Finder is a special always-running system process. The sidecar's name lookup can miss it
          // even though bundle-id launch works, which made the natural `open Finder` request fail.
          // Normalize only this well-known macOS alias; keep every other caller-supplied app exact.
          const requestedBundleId = cmd.bundleId?.trim()
            || (requestedApp?.toLocaleLowerCase() === 'finder' ? 'com.apple.finder' : undefined);
          const appIdentity = `${requestedApp || ''}|${requestedBundleId || ''}`.toLocaleLowerCase();
          const macSingleton = /(?:^|\|)(?:finder|system settings|com\.apple\.finder|com\.apple\.systempreferences)(?:$|\|)/.test(appIdentity);
          const data = await this.call('launch_app', {
            ...(requestedBundleId ? { bundle_id: requestedBundleId } : { name: requestedApp! }),
            ...(cmd.newInstance && !macSingleton ? { creates_new_application_instance: true } : {}),
          });
          const window = Array.isArray(data?.windows) ? data.windows[0] : undefined;
          let opened: ComputerTarget = {
            app: String(data?.name || cmd.app || cmd.bundleId || ''),
            pid: Number(data?.pid || 0),
            windowId: Number(window?.window_id || 0) || undefined,
          };
          if (!opened.pid) throw new Error(`opened ${opened.app || 'application'} but received no target pid`);
          // Never surface a bundle id or an empty "?" as the app name — resolve the human name.
          opened.app = await this.resolveAppName(opened.pid, opened.app);
          // open() establishes ownership: from here every action routes to THIS app/window.
          this.targets.set(opened);
          // Resume: if this is the first open of a fresh process and a persisted session for this
          // same app is on disk, restore its bounded history before this open records onto it.
          this.maybeResumeHistory(cwd);
          // A new app is a fresh visual context: reset the no-progress baseline so the opened app's
          // first frame is not compared against the previous app's screen, and give the recovery
          // authority a fresh budget for the new app.
          this.prevFrameHash = undefined;
          this.noChangeStreak = 0;
          this.failedActingStreak = 0;
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
                await this.call('bring_to_front', { pid: opened.pid, window_id: opened.windowId });
                activated = true;
              } catch {
                await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                opened = await this.refreshTargetWindow(opened);
                this.targets.set(opened);
              }
            }
            if (!activated) {
              // Some apps publish their process before AppKit accepts activation. `open -a` is the
              // native foreground contract and handles hidden/launching applications reliably.
              const nativeOpen = await this.fallback.run({ action: 'open', app: opened.app }, ctx);
              if (!nativeOpen.ok) throw new Error(nativeOpen.error || nativeOpen.summary);
            }
            await new Promise(resolve => setTimeout(resolve, 250));
            // bring_to_front returning ok does NOT mean the app actually came forward — some apps
            // (Electron/Catalyst, e.g. WhatsApp) accept the call yet leave the terminal frontmost.
            // Verify the truth; if a different app is positively still in front, escalate to the
            // native `open -a` contract and re-check. Only then do we trust that it is focused.
            let stillWrong = await this.frontmostMismatch(opened.app);
            if (stillWrong) {
              try { await this.fallback.run({ action: 'open', app: opened.app }, ctx); } catch { /* re-checked below */ }
              await new Promise(resolve => setTimeout(resolve, 300));
              stillWrong = await this.frontmostMismatch(opened.app);
            }
            if (stillWrong) {
              frontmostWarning = `${opened.app} was launched but ${stillWrong} is still frontmost — its window may be hidden or blocked; screenshots and clicks may land on the wrong app until it is brought forward`;
              cliEvents.emit('status', frontmostWarning);
            }
            opened = await this.refreshTargetWindow(opened);
            this.targets.set(opened);
            // Finder can be genuinely frontmost while exposing only its 35px menu/desktop proxy —
            // there is no document window to click or capture. Open a normal Finder window once,
            // reacquire it, and refuse to claim success if the surface is still unusable.
            if (process.platform === 'darwin' && opened.app.toLocaleLowerCase() === 'finder'
              && !await this.hasUsableTargetWindow(opened)) {
              const newWindow = await this.fallback.run({ action: 'key', combo: 'cmd+n', app: opened.app }, ctx);
              if (!newWindow.ok) throw new Error(newWindow.error || newWindow.summary);
              await new Promise(resolve => setTimeout(resolve, 350));
              opened = await this.refreshTargetWindow({ ...opened, windowId: undefined });
              this.targets.set(opened);
              if (!opened.windowId || !await this.hasUsableTargetWindow(opened)) {
                throw new Error('Finder opened without a usable window after Cmd+N; no click-safe surface is available');
              }
            }
          } else if (!opened.windowId) {
            opened = await this.refreshTargetWindow(opened);
            this.targets.set(opened);
          }
          const evidence = opened.windowId
            ? await this.postActionEvidence(opened, cwd, session)
            : { visualEvidenceError: 'opened application has no capturable window yet' };
          if (evidence.visualEvidenceError) {
            throw new Error(evidence.visualEvidenceError);
          }
          // postActionEvidence may have re-acquired a better window — read the owned truth back.
          opened = this.targets.current() ?? opened;
          // The agent owns input on this surface only when it is genuinely frontmost in visible mode.
          this.syncSurface({ focusOwner: (delivery === 'foreground' && !frontmostWarning) ? 'agent' : 'none' });
          return {
            ok: true, action: cmd.action, driver, app: opened.app, pid: opened.pid,
            windowId: opened.windowId, details: data, ...evidence, frontmostWarning,
            summary: `opened ${opened.app} as pid ${opened.pid}${opened.windowId ? ` window ${opened.windowId}` : ''}${frontmostWarning ? `; WARNING: ${frontmostWarning}` : '; fresh screen attached'}`,
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
              this.targets.retargetWindow(capture.pid, refreshed.windowId);
            }
          }
          if (!capture?.windowId) {
            if (cmd.action === 'screenshot') return this.fallback.run(cmd, ctx);
            throw new Error('observe needs pid + windowId; open or select an application window first');
          }
          const observed = await this.observeTarget(capture, cwd, session, cmd);
          // An explicit re-observation that actually produced fresh evidence (a captured frame) is
          // the corrective step the recovery authority requires — only then does a latched
          // no-progress stop clear. Merely issuing observe/screenshot (or a capture that failed to
          // produce a frame) does NOT reset or bypass the latch.
          if (observed.ok && observed.frameHash) this.recovery.reset();
          return observed;
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
            this.assertClickableSemanticTarget(resolved);
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
          } else if (cmd.elementToken || cmd.elementIndex != null) {
            const resolved = this.resolveObservedHandle(target, cmd);
            this.assertClickableSemanticTarget(resolved);
            resolvedLabel = resolved.label || resolved.value || '';
            if (delivery === 'foreground') {
              const point = this.elementCenterInScreenshot(resolved.frame);
              if (!point) throw new Error('element has no visible screenshot rectangle; observe again or choose a visible x/y point');
              args.x = point.x;
              args.y = point.y;
              coordinateSource = 'semantic element frame';
            } else if (cmd.elementToken) args.element_token = cmd.elementToken;
            else args.element_index = Math.floor(cmd.elementIndex!);
          }
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
            const slider = this.sliderAtScreenshotPoint({ x, y });
            if (slider) {
              throw new Error(`screenshot point ${x},${y} is inside "${slider.label || 'Slider'}"; use set_value with its fresh semantic handle so the requested value is exact`);
            }
          }
          if (cmd.count) args.count = Math.floor(cmd.count);
          if (cmd.debugImageOut) args.debug_image_out = path.resolve(cmd.debugImageOut);
          // The sidecar's foreground pixel rung still PID-posts a synthetic event and moves only
          // its overlay cursor. SwiftUI/System Settings can ignore that event. Visible mode means
          // a real global CGEvent: front the pinned window, glide the macOS cursor, click, then use
          // the same sidecar session for the fresh post-action capture.
          if (delivery === 'foreground' && args.x != null && args.y != null) {
            const screenshotPoint = { x: Number(args.x), y: Number(args.y) };
            const globalPoint = await this.preparePhysicalPoint(target, screenshotPoint);
            const native = await this.fallback.run({
              action: 'click', x: globalPoint.x, y: globalPoint.y,
              button: cmd.button || 'left', count: cmd.count || 1,
              modifier: cmd.modifier,
              app: target.app, normalized: false,
            }, ctx);
            if (!native.ok) throw new Error(native.error || native.summary);
            this.verifyPhysicalClick(target, globalPoint, native);
            // A right-click usually opens a context menu — a separate OS window a window-scoped PNG
            // cannot show. Return the full display so the model actually SEES the menu it opened.
            const evidence = (cmd.button === 'right')
              ? await this.displayObservation(target, ctx)
              : await this.postActionEvidence(target, cwd, session);
            // WindowServer can keep a just-dismissed sheet enumerable for a short grace period.
            // Trust the verified physical activation of an explicit dismissal control so the stale
            // window record does not block the very next click on the now-visible parent page.
            if (/^(?:done|close|cancel|ok)$/i.test(resolvedLabel.trim())) {
              this.transientDialogFrame = null;
              evidence.completionGuidance = COMPUTER_COMPLETION_GUIDANCE;
            }
            return {
              ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
              details: {
                path: 'native-global-cgevent', screenshotPoint,
                requestedGlobalPoint: globalPoint,
                landedGlobalPoint: native.x != null && native.y != null ? { x: native.x, y: native.y } : undefined,
                inputVerified: native.x != null && native.y != null,
              },
              ...evidence,
              summary: `physical mouse click${resolvedLabel ? ` on "${resolvedLabel}"` : ''} delivered to ${target.app || `pid ${target.pid}`}; fresh screen attached`,
            };
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
            await this.ensurePhysicalTargetFrontmost(target);
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
            await this.ensurePhysicalTargetFrontmost(target);
            await this.ensureCursorInTargetWindow(target, ctx);
            const native = await this.fallback.run({ action: 'key', combo: cmd.combo, app: target.app }, ctx);
            if (!native.ok) throw new Error(native.error || native.summary);
            const evidence = await this.postActionEvidence(target, cwd, session);
            // Escape is the keyboard twin of the Done/Close/Cancel click: it semantically dismisses
            // the foreground sheet, and WindowServer may keep the dead sheet enumerable for a short
            // grace period. Without this, the dialog guard kept refusing clicks on the visible page.
            if (keys.length === 1 && (keys[0] === 'escape' || keys[0] === 'esc')) {
              this.transientDialogFrame = null;
              evidence.completionGuidance = COMPUTER_COMPLETION_GUIDANCE;
            }
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
          const resolved = cmd.query?.trim()
            ? this.resolveObservedElement(cmd.query, target)
            : this.resolveObservedHandle(target, cmd);
          const role = String(resolved.role || '');
          if (!ACTIONABLE_AX_ROLES.has(role)) {
            throw new Error(`"${resolved.label || role || 'element'}" does not support native value assignment`);
          }
          const requested = this.normalizedControlValue(role, cmd.value);
          const handle = resolved.elementToken
            ? { element_token: resolved.elementToken }
            : resolved.elementIndex != null ? { element_index: resolved.elementIndex } : null;
          if (!handle) throw new Error('set_value target has no fresh native handle; observe again');
          const data = await this.call('set_value', {
            pid: target.pid, window_id: target.windowId, session, value: requested.value,
            ...handle,
          });
          const evidence = await this.postActionEvidence(target, cwd, session);
          const exactEndpoint = role === 'AXSlider' && requested.endpoint;
          if (exactEndpoint && evidence.progressCheck) {
            evidence.actionResult = toActionResult(evidence.progressCheck, {
              query: `${resolved.label || 'Slider'} native ${exactEndpoint} endpoint (${requested.value})`,
              matched: true,
            });
          }
          return {
            ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
            details: {
              native: data,
              target: { label: resolved.label, role },
              requestedValue: cmd.value,
              appliedValue: requested.value,
              ...(requested.endpoint ? { endpoint: requested.endpoint } : {}),
            },
            ...evidence,
            summary: exactEndpoint
              ? `${resolved.label || 'slider'} set to exact ${requested.endpoint} endpoint; fresh screen attached`
              : `value delivered to ${resolved.label || target.app || `pid ${target.pid}`}; fresh screen attached`,
          };
        }
        case 'drag': {
          if (!target) return this.fallback.run(cmd, ctx);
          // Source and destination each accept the same semantic grounding as click: an element
          // handle from the newest observation (query/elementToken/elementIndex for the source,
          // toQuery/toElementToken/toElementIndex for the destination) or a raw screenshot pixel.
          const hasSourceHandle = !!(cmd.query?.trim() || cmd.elementToken || cmd.elementIndex != null);
          const hasDestHandle = !!(cmd.toQuery?.trim() || cmd.toElementToken || cmd.toElementIndex != null);
          if (!hasSourceHandle && (cmd.x == null || cmd.y == null)) {
            throw new Error('drag needs a source: query/elementToken/elementIndex from the newest observation, or x+y screenshot pixels');
          }
          if (!hasDestHandle && (cmd.toX == null || cmd.toY == null)) {
            throw new Error('drag needs a destination: toQuery/toElementToken/toElementIndex from the newest observation, or toX+toY screenshot pixels');
          }
          if (!this.observedTarget || this.observedTarget.pid !== target.pid || this.observedTarget.windowId !== target.windowId) {
            throw new Error('drag needs a fresh image of this exact window');
          }
          const width = this.observedTarget.width;
          const height = this.observedTarget.height;
          if (!width || !height) throw new Error('latest screenshot has no usable dimensions');
          const resolveDragPoint = (
            spec: { query?: string; elementToken?: string; elementIndex?: number }, end: 'source' | 'destination',
          ): { x: number; y: number } => {
            const resolved = spec.query?.trim()
              ? this.resolveObservedElement(spec.query, target)
              : this.resolveObservedHandle(target, { elementToken: spec.elementToken, elementIndex: spec.elementIndex });
            const point = this.elementCenterInScreenshot(resolved.frame);
            if (!point) throw new Error(`drag ${end} element has no visible screenshot rectangle; observe again or use a visible screenshot pixel instead`);
            return point;
          };
          const from = hasSourceHandle
            ? resolveDragPoint(cmd, 'source')
            : {
              x: cmd.normalized ? scaleNormalizedPoint(cmd.x!, width - 1) : Math.round(cmd.x!),
              y: cmd.normalized ? scaleNormalizedPoint(cmd.y!, height - 1) : Math.round(cmd.y!),
            };
          const to = hasDestHandle
            ? resolveDragPoint({ query: cmd.toQuery, elementToken: cmd.toElementToken, elementIndex: cmd.toElementIndex }, 'destination')
            : {
              x: cmd.normalized ? scaleNormalizedPoint(cmd.toX!, width - 1) : Math.round(cmd.toX!),
              y: cmd.normalized ? scaleNormalizedPoint(cmd.toY!, height - 1) : Math.round(cmd.toY!),
            };
          if ([from.x, from.y, to.x, to.y].some(value => !Number.isFinite(value))
            || from.x < 0 || from.y < 0 || to.x < 0 || to.y < 0
            || from.x >= width || to.x >= width || from.y >= height || to.y >= height) {
            throw new Error(`drag points must stay inside the latest image (${width}x${height})`);
          }
          if (delivery === 'foreground') {
            await this.ensurePhysicalTargetFrontmost(target);
            const wf = await this.liveWindowFrame(target);
            const globalFrom = this.screenshotPixelToGlobalPoint(from, wf);
            const globalTo = this.screenshotPixelToGlobalPoint(to, wf);
            if (globalFrom && globalTo) {
              // Drive the drag through the explicit state machine: verify the SOURCE is inside the
              // window before the button ever goes down (dragging from empty space is a mistake), run
              // the atomic native drag as the down→move→up executor, then verify a fresh screen. On a
              // native failure, cancel and post a compensating mouse-up so a half-drag can't wedge the
              // pointer. The full phase trace ships in details.dragTrace for observability.
              const machine = new DragMachine(globalFrom, globalTo);
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
            const globalPoint = await this.preparePhysicalPoint(target, point);
            if (globalPoint) {
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
          // close = close the SELECTED WINDOW only (Cmd+W / Ctrl+W). It must never quit the whole
          // application — that is the separate, high-impact quit_app action below.
          if (!target) return this.fallback.run(cmd, ctx);
          const closingWindowId = target.windowId;
          const combo = process.platform === 'darwin' ? 'cmd+w' : 'ctrl+w';
          await this.ensurePhysicalTargetFrontmost(target);
          const delivered = await this.fallback.run({ action: 'key', combo, app: target.app }, ctx);
          if (!delivered.ok) throw new Error(delivered.error || delivered.summary);
          // Close animations and the WindowServer's stale-enumeration grace period both outlive a
          // single fixed delay; poll before declaring the close failed (same phenomenon that kept
          // dismissed sheets enumerable for a tick).
          let remaining: any[] = [];
          let stillListed = true;
          for (const settleMs of [350, 450, 700]) {
            await new Promise(resolve => setTimeout(resolve, settleMs));
            const windows = await this.call('list_windows', { pid: target.pid });
            remaining = Array.isArray(windows?.windows) ? windows.windows : [];
            stillListed = !!closingWindowId && remaining.some((w: any) => Number(w?.window_id) === closingWindowId);
            if (!stillListed) break;
          }
          if (stillListed) {
            throw new Error(`window ${closingWindowId} of ${target.app || `pid ${target.pid}`} did not close after Cmd+W — it may have an unsaved-changes prompt open; observe to see its current state`);
          }
          // The app keeps running. Retarget to its next window when one exists; otherwise drop the target.
          const next = remaining.find((w: any) => w?.is_on_screen !== false && Number(w?.bounds?.width || 0) > 100);
          if (next && this.targets.owns(target.pid)) {
            this.targets.retargetWindow(target.pid, Number(next.window_id) || undefined);
            this.syncSurface();
          } else if (this.targets.owns(target.pid) && remaining.length === 0) {
            this.surfaces.remove(`native:${target.pid}`);
            this.targets.clear();
            this.syncLivePip();
          }
          return {
            ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: closingWindowId,
            actionResult: { delivered: true, observed: 'confirmed', postcondition: { query: 'target window no longer listed', matched: true }, confidence: 'proven' },
            summary: `closed window ${closingWindowId ?? '?'} of ${target.app || `pid ${target.pid}`} (application still running${remaining.length ? `, ${remaining.length} window(s) remain` : ''})`,
          };
        }
        case 'quit_app': {
          // High impact: quits the ENTIRE application and may discard unsaved state. The tool layer
          // gates this behind an explicit approval; the runtime verifies the quit actually happened.
          if (!target) return this.fallback.run({ ...cmd, action: 'quit_app' }, ctx);
          const combo = process.platform === 'darwin' ? 'cmd+q' : 'alt+f4';
          await this.ensurePhysicalTargetFrontmost(target);
          const delivered = await this.fallback.run({ action: 'key', combo, app: target.app }, ctx);
          if (!delivered.ok) throw new Error(delivered.error || delivered.summary);
          await new Promise(resolve => setTimeout(resolve, 350));
          const windows = await this.call('list_windows', { pid: target.pid });
          if (Array.isArray(windows?.windows) && windows.windows.length > 0) {
            throw new Error(`${target.app || `pid ${target.pid}`} did not quit after the cooperative quit shortcut — it may be showing an unsaved-changes prompt; observe to see its current state`);
          }
          this.surfaces.remove(`native:${target.pid}`);
          this.targets.clear();
          this.syncLivePip();
          return {
            ok: true, action: cmd.action, driver, app: target.app, pid: target.pid,
            actionResult: { delivered: true, observed: 'confirmed', postcondition: { query: 'application windows no longer listed', matched: true }, confidence: 'proven' },
            summary: `quit ${target.app || `pid ${target.pid}`} and verified that its windows disappeared`,
          };
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
      const error = bimaxBrand(String(err?.message || err)).slice(0, 1000);
      return {
        ok: false, action: cmd.action, driver, error,
        actionResult: { delivered: false, observed: 'failed', confidence: 'unknown', failureReason: error },
        summary: `${cmd.action} failed`,
      };
    }
  }
}

export const globalDesktopRuntime: DesktopRuntimePort = new BimaxComputerRuntime();
