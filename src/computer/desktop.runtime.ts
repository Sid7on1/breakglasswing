import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { DESKTOP_HELPER_SOURCE, DESKTOP_HELPER_VERSION } from './helper.source';
import { cliEvents } from '../cli/events';
import { loadConfig } from '../cli/config';
import { normalizedToPixel, screenshotToGlobal, elementCenterToScreenshot, globalFrameToScreenshot, frameCenter, pixelInImage, Frame } from './coordinates';
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
import { FrameRegistry, FrameMetadata } from './frame';
import { TargetSwitch, SwitchLatencyLog } from './switch';
import { InputExecutor, heldButtonFor } from './input.executor';
import { waitUntil, waitFor } from './settle';

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
  | 'cursor' | 'frontmost' | 'open' | 'focus' | 'close' | 'quit_app' | 'move' | 'click' | 'drag'
  | 'scroll' | 'type' | 'key' | 'set_value' | 'wait'
  | 'hover' | 'hold' | 'mouse_down' | 'mouse_up'
  | 'copy' | 'paste' | 'clipboard' | 'arrange' | 'desktop'
  | 'record_start' | 'record_status' | 'record_stop'
  // Internal plumbing verbs: the pasteboard and window-geometry primitives the model-facing verbs
  // are built from. Deliberately absent from the tool schema — the model never calls these directly.
  | 'clipboard_read' | 'clipboard_write' | 'clipboard_write_files'
  | 'screens' | 'window_frame' | 'window_set_frame' | 'window_fullscreen' | 'modal_frame' | 'ax_enable'
  | 'window_at' | 'window_raise'
  | 'bundle_id' | 'app_running' | 'desktop_icons';

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
  /** clipboard: absolute file paths to place on the pasteboard, so an app can receive them by paste. */
  paths?: string[];
  /** drag: destination APPLICATION for a cross-app drop. Must already be open in this session
   *  (open/focus); toX/toY are then read in THAT window's screenshot space, not the source's. */
  toApp?: string;
  /** arrange: where to put the window — a named region of the screen, or explicit bounds. */
  layout?: WindowLayout;
  /** arrange / window_set_frame: explicit target rectangle in global screen points. */
  bounds?: { x: number; y: number; w: number; h: number };
  deliveryMode?: 'background' | 'foreground';
  session?: string;
  newInstance?: boolean;
  display?: number;
  ms?: number;
  /** Interpret coordinates in the 0–1000 normalized space and scale to the main display. */
  normalized?: boolean;
  /** The frame these coordinates were planned from, as returned by the observation that produced
   * them. Optional — omitting it keeps the pre-existing behaviour — but supplying it is what lets
   * the runtime detect a stale frame of the SAME window and refuse rather than mis-click. */
  frameId?: string;
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

/** A rectangle in global screen points (top-left origin), the space every helper command speaks. */
export interface ScreenRect { x: number; y: number; w: number; h: number }

/** A screen, with the area a window may actually occupy (menu bar and Dock excluded). */
export interface ScreenInfo { index: number; main: boolean; scale: number; frame: ScreenRect; visible: ScreenRect }

/**
 * Named window placements. These cover what "put them side by side" and "make it fullscreen"
 * actually mean, computed against the screen's VISIBLE area so a tiled window never hides under the
 * menu bar or Dock. `fullscreen`/`unfullscreen` are the native macOS Space toggle, which is a
 * different thing from `maximize` (a window filling the visible area, still on the current Space).
 */
export type WindowLayout =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  // Thirds — what a three-app workflow actually needs. Halves cannot express "reference on the
  // left, editor in the middle, terminal on the right" without overlapping windows.
  | 'left-third' | 'center-third' | 'right-third'
  | 'left-two-thirds' | 'right-two-thirds'
  // Put the window back where it was before the last arrange — the undo a multi-app layout needs
  // so a workflow can borrow the screen and hand it back.
  | 'restore'
  | 'maximize' | 'center' | 'fullscreen' | 'unfullscreen';

export interface DesktopResult {
  ok: boolean;
  action: DesktopAction;
  driver: string;
  error?: string;
  screenshot?: string;
  width?: number; height?: number;
  /** Stable digest of captured pixels, used to measure actual visual progress. */
  frameHash?: string;
  /** Identity of the frame these coordinates belong to (see frame.ts). Echo it back on the acting
   * verb planned from this observation and a superseded frame is refused instead of clicking
   * whatever now occupies those pixels. */
  frameId?: string;
  /** The input landed, but the automatic post-action screenshot could not be captured. */
  visualEvidenceError?: string;
  /** What the live preview panel is showing, attached to observations.
   *
   * The preview is presentation-only: no verb can look at it, so a model asked "what is the live
   * preview showing?" has no ground truth to answer from. Observed twice in real sessions, it
   * answered anyway — naming an app after every switch, having never queried anything. Stating the
   * preview's real state alongside the observation is what makes the honest answer available. */
  preview?: string;
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
  /** Pasteboard contents — the OS-level bridge between apps. `changeCount` is the system's
   * monotonic write counter; comparing it across a copy is what proves the copy actually placed
   * something rather than merely delivering a keystroke. -1 means the driver could not report it. */
  clipboard?: { text: string; files: string[]; types: string[]; changeCount: number };
  /** Screens with their visible (menu-bar/Dock-excluded) areas — what layouts are computed against. */
  screens?: ScreenInfo[];
  /** Items on the desktop, with their rectangles in global screen points. */
  icons?: Array<{ name: string; frame: ScreenRect }>;
  /** The window's ACTUAL rectangle after a geometry change. Apps enforce minimum sizes and size
   * increments, so this frequently differs from what was requested — reported, never assumed. */
  windowFrame?: ScreenRect;
  requestedFrame?: ScreenRect;
  /** The rectangle of an OS-confirmed modal sheet/dialog, when one is blocking this app. */
  modalFrame?: ScreenRect;
  /** Did the app accept the request to publish its full accessibility tree? Native apps refuse. */
  applied?: boolean;
  /** The window that would actually receive a click at a probed point — the OS's answer, not ours. */
  windowAt?: { window_id: number; owner_pid: number; owner_name: string; layer: number; bounds: ScreenRect };
  /** Did a single-window raise succeed? Floating panels can stay above regardless. */
  raised?: boolean;
  fullscreen?: boolean;
  /** Launch Services' bundle id for an app name, when the OS could resolve one. */
  bundleId?: string;
  /** Is that application currently running? */
  running?: boolean;
  /** False when the window exposes no fullscreen capability at all (a panel, a utility window). */
  fullscreenSupported?: boolean;
  /** Did the window actually settle into the requested fullscreen state? */
  fullscreenMatched?: boolean;
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
/** Roles where the visible CENTER is always at least as good a click target as any pixel inside —
 * an edge-grazing raw click on one of these delivers fine yet activates nothing. Text inputs are
 * excluded (the click point places the caret) and sliders are excluded (position IS the value). */
const SNAP_TO_CENTER_AX_ROLES = new Set([
  'AXButton', 'AXCheckBox', 'AXDisclosureTriangle', 'AXLink', 'AXMenuButton',
  'AXPopUpButton', 'AXRadioButton', 'AXSwitch', 'AXTab',
]);

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

/**
 * Verb synonyms models reach for that are not in the schema enum. Live runs showed `snapshot`
 * called in nearly every episode — the model wanted a fresh frame, got "unsupported computer
 * action: snapshot", and burned the step. These are all unambiguous one-to-one synonyms, so
 * mapping them is strictly better than failing a step on vocabulary.
 *
 * SECURITY: normalization must run BEFORE the governor's gating decision, never after. Several
 * targets here (`key`, `type`, `open`) are gated actions — normalizing downstream of the gate
 * would let `press` slip through as an unrecognized, ungated verb and then execute as `key`.
 */
const DESKTOP_ACTION_ALIASES: Record<string, string> = {
  snapshot: 'screenshot', capture: 'screenshot', screen_shot: 'screenshot', screen_capture: 'screenshot',
  look: 'observe', inspect: 'observe', read_screen: 'observe', get_state: 'observe', get_window_state: 'observe',
  press: 'key', keypress: 'key', key_press: 'key', hotkey: 'key', send_keys: 'key',
  write: 'type', type_text: 'type', input_text: 'type', enter_text: 'type',
  launch: 'open', open_app: 'open',
  // These three mean "switch to an app that is already open" — route them to focus, which does
  // exactly that without the re-launch (and second-instance risk) that open would incur.
  activate: 'focus', focus_app: 'focus', switch_app: 'focus', switch_to: 'focus',
  mouse_move: 'move', move_mouse: 'move', left_click: 'click', mouse_click: 'click',
};

/** Map a model-supplied verb onto the real action, or return it unchanged. */
export function normalizeDesktopAction(action: string): string {
  const key = String(action || '').trim().toLocaleLowerCase();
  return DESKTOP_ACTION_ALIASES[key] || action;
}

/** Text fields on a driver element that a human — or a `query` — would ever read. */
const ELEMENT_TEXT_KEYS = ['label', 'value', 'description', 'original_label', 'context_label', 'title', 'placeholder'];

/**
 * Turn a named layout into a rectangle inside a screen's VISIBLE area.
 *
 * Everything is derived from `visible` rather than the full screen frame, so a tiled window sits
 * below the menu bar and clear of the Dock instead of hiding behind them. Halves are computed by
 * splitting and then deriving the second half from the first, so two tiles always meet exactly on
 * an odd-width screen rather than leaving a one-pixel seam or overlapping by one.
 */
export function layoutRect(layout: WindowLayout, visible: ScreenRect): ScreenRect {
  const halfW = Math.floor(visible.w / 2);
  const halfH = Math.floor(visible.h / 2);
  const rightW = visible.w - halfW;
  const bottomH = visible.h - halfH;
  const midX = visible.x + halfW;
  const midY = visible.y + halfH;
  const thirdW = Math.floor(visible.w / 3);
  const lastThirdW = visible.w - 2 * thirdW;
  switch (layout) {
    case 'left': return { x: visible.x, y: visible.y, w: halfW, h: visible.h };
    case 'right': return { x: midX, y: visible.y, w: rightW, h: visible.h };
    case 'top': return { x: visible.x, y: visible.y, w: visible.w, h: halfH };
    case 'bottom': return { x: visible.x, y: midY, w: visible.w, h: bottomH };
    case 'top-left': return { x: visible.x, y: visible.y, w: halfW, h: halfH };
    case 'top-right': return { x: midX, y: visible.y, w: rightW, h: halfH };
    case 'bottom-left': return { x: visible.x, y: midY, w: halfW, h: bottomH };
    case 'bottom-right': return { x: midX, y: midY, w: rightW, h: bottomH };
    // Thirds use the same "derive the later tiles from the earlier ones" rule as halves, so three
    // columns always tile the full width exactly — no seam and no overlap on a width that is not
    // divisible by three.
    case 'left-third': return { x: visible.x, y: visible.y, w: thirdW, h: visible.h };
    case 'center-third': return { x: visible.x + thirdW, y: visible.y, w: thirdW, h: visible.h };
    case 'right-third': return { x: visible.x + 2 * thirdW, y: visible.y, w: lastThirdW, h: visible.h };
    case 'left-two-thirds': return { x: visible.x, y: visible.y, w: 2 * thirdW, h: visible.h };
    case 'right-two-thirds': return { x: visible.x + thirdW, y: visible.y, w: visible.w - thirdW, h: visible.h };
    case 'center': {
      const w = Math.round(visible.w * 0.6), h = Math.round(visible.h * 0.7);
      return { x: visible.x + Math.round((visible.w - w) / 2), y: visible.y + Math.round((visible.h - h) / 2), w, h };
    }
    case 'maximize':
    default: return { ...visible };
  }
}

/** The screen a rectangle mostly sits on — so arranging a window uses ITS display, not always the
 *  main one. Falls back to the main screen when nothing overlaps (a window parked off-screen). */
export function screenForRect(rect: ScreenRect | undefined, screens: ScreenInfo[]): ScreenInfo | null {
  if (!screens.length) return null;
  const main = screens.find(s => s.main) || screens[0];
  if (!rect) return main;
  let best: { screen: ScreenInfo; area: number } | null = null;
  for (const screen of screens) {
    const overlapW = Math.max(0, Math.min(rect.x + rect.w, screen.frame.x + screen.frame.w) - Math.max(rect.x, screen.frame.x));
    const overlapH = Math.max(0, Math.min(rect.y + rect.h, screen.frame.y + screen.frame.h) - Math.max(rect.y, screen.frame.y));
    const area = overlapW * overlapH;
    if (area > 0 && (!best || area > best.area)) best = { screen, area };
  }
  return best?.screen || main;
}

/** How closely did the window actually land on what was asked for? Apps enforce minimum sizes and
 *  size increments, so an exact match is the exception rather than the rule. */
function frameMatches(want: ScreenRect, got: ScreenRect | undefined, tolerance = 2): boolean {
  if (!got) return false;
  return Math.abs(want.x - got.x) <= tolerance && Math.abs(want.y - got.y) <= tolerance
    && Math.abs(want.w - got.w) <= tolerance && Math.abs(want.h - got.h) <= tolerance;
}

/**
 * Combos macOS handles at the WindowServer level, which change WHICH SPACE — and therefore which
 * windows — are visible.
 *
 * These are not application keystrokes: they never reach the focused app, and after one runs the
 * previously targeted window may be on a Space that is no longer on screen. Capturing that window
 * then yields an empty frame, which reads as a broken app rather than "you changed Spaces". The
 * runtime has to recognise them up front and re-establish what it is looking at afterwards.
 *
 *  - 'switch':   Ctrl+Left/Right moves between Spaces and fullscreen apps; Ctrl+1..9 jumps to one.
 *  - 'overview': Ctrl+Up (Mission Control) and Ctrl+Down (App Exposé) overlay every window, so no
 *                single app window is meaningfully capturable until the overlay is dismissed.
 */
export function classifySpaceCombo(combo: string): 'switch' | 'overview' | null {
  const keys = String(combo || '').toLocaleLowerCase().split('+').map(k => k.trim()).filter(Boolean);
  if (keys.length < 2) return null;
  const key = keys[keys.length - 1];
  const modifiers = new Set(keys.slice(0, -1));
  if (!modifiers.has('ctrl') && !modifiers.has('control')) return null;
  if (key === 'left' || key === 'right' || /^[1-9]$/.test(key)) return 'switch';
  if (key === 'up' || key === 'down') return 'overview';
  return null;
}

/**
 * Is `inner` substantially contained within `outer`? Used to tell a modal SHEET (which macOS draws
 * attached to and inside its parent window) apart from a floating palette or inspector, which is
 * also smaller than the main window but sits outside it and must never be treated as a modal
 * blocker. Driver bounds are `{x,y,width,height}`; a small slack absorbs shadow/rounding.
 */
function rectMostlyInside(inner: any, outer: any, minOverlapRatio = 0.8): boolean {
  const ix = Number(inner?.x), iy = Number(inner?.y);
  const iw = Number(inner?.width), ih = Number(inner?.height);
  const ox = Number(outer?.x), oy = Number(outer?.y);
  const ow = Number(outer?.width), oh = Number(outer?.height);
  if (![ix, iy, iw, ih, ox, oy, ow, oh].every(Number.isFinite) || iw <= 0 || ih <= 0) return false;
  const overlapW = Math.max(0, Math.min(ix + iw, ox + ow) - Math.max(ix, ox));
  const overlapH = Math.max(0, Math.min(iy + ih, oy + oh) - Math.max(iy, oy));
  return (overlapW * overlapH) / (iw * ih) >= minOverlapRatio;
}

/**
 * Resolve a desktop item by name. Exact match wins outright; otherwise a single unambiguous
 * case-insensitive partial match is accepted. Several partial matches are refused with the
 * candidates listed, because silently picking one would move the wrong file.
 */
export function resolveDesktopIcon(
  icons: Array<{ name: string; frame: ScreenRect }>, query: string,
): { name: string; frame: ScreenRect } {
  const wanted = query.trim().toLocaleLowerCase();
  if (!wanted) throw new Error('desktop item name is empty');
  const named = icons.filter(i => i.name);
  const exact = named.filter(i => i.name.toLocaleLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  const partial = named.filter(i => i.name.toLocaleLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(`"${query}" matches several desktop items (${partial.map(i => i.name).join(', ')}) — use the exact name`);
  }
  throw new Error(`no desktop item named "${query}"${named.length ? ` (on the desktop: ${named.map(i => i.name).join(', ')})` : ' — the desktop appears empty'}`);
}

/** A clipboard snapshot the runtime can compare across an action. */
type ClipboardSnapshot = { text: string; files: string[]; types: string[]; changeCount: number };

/**
 * Did the pasteboard actually receive new content between two snapshots?
 *
 * changeCount is the OS's monotonic write counter and is the ONLY reliable signal: it advances even
 * when an app writes content identical to what was already there, which a text comparison would
 * report as "nothing happened". Drivers that cannot read it report -1, and only then do we fall back
 * to comparing content — weaker, because re-copying the same text is then indistinguishable from a
 * copy that did nothing.
 */
function clipboardAdvanced(before: ClipboardSnapshot, after: ClipboardSnapshot): boolean {
  if (before.changeCount >= 0 && after.changeCount >= 0) return after.changeCount !== before.changeCount;
  return after.text !== before.text || after.files.join('|') !== before.files.join('|');
}

/** Human-readable one-liner for a clipboard snapshot, with text truncated for the transcript. */
function describeClipboard(clip: ClipboardSnapshot): string {
  if (clip.files.length) return `${clip.files.length} file(s): ${clip.files.join(', ')}`;
  const text = clip.text.replace(/\s+/g, ' ').trim();
  if (!text) return 'clipboard is empty';
  return `${clip.text.length} chars: "${text.length > 160 ? `${text.slice(0, 160)}…` : text}"`;
}

/**
 * Driver >=0.12 reports element text WITH the invisible bidi marks macOS embeds; 0.8 handed them
 * over already stripped. `trim()` does not remove them, so they poison BOTH ends of the pipeline:
 * the model is shown "‎Chats" and cannot retype it, and — worse — an EXACT label match
 * silently degrades into a substring match, because `"‎chats" === "chats"` is false while
 * `"‎chats".includes("chats")` is true. The resolver's exact tier (score 0) therefore goes
 * empty, every marked label collapses into the same "contains" bucket, and a precise query like
 * "Chats" is rejected as ambiguous against every other marked label. That is what pushed the model
 * off `query` and onto guessed element indices in live WhatsApp runs. Strip the marks at the one
 * place driver elements enter Bimax state, so both the model-visible list and the resolver see the
 * same clean text.
 */
export function sanitizeDriverElements(elements: any[]): any[] {
  return elements.map(element => {
    if (!element || typeof element !== 'object') return element;
    let cleaned = element;
    for (const key of ELEMENT_TEXT_KEYS) {
      const raw = element[key];
      if (typeof raw !== 'string') continue;
      const stripped = stripInvisibleMarks(raw);
      if (stripped === raw) continue;
      if (cleaned === element) cleaned = { ...element };
      cleaned[key] = stripped;
    }
    return cleaned;
  });
}

/**
 * Reach when hunting for the text that names an icon — deliberately ADJACENCY, not proximity.
 *
 * A flat radius does not describe how labelling works. With a 260×120pt box, WhatsApp's window
 * close/minimize/zoom buttons were named `unlabeled Button near "New chat"` after a heading 248pt
 * away across the window; the model read that as the New Chat control, clicked it, and reopened the
 * same popover on every retry. Text names a control when it sits in the control's ROW or its
 * COLUMN, so require alignment on one axis before distance on the other counts for anything.
 */
const UNLABELED_TEXT_REACH = { alongRow: 200, alongColumn: 80 };

/**
 * Roles that COVER the window: while one is open the accessibility tree exposes only its contents,
 * so every control of the underlying page is simply absent from the observation.
 */
const FOREGROUND_SURFACE_ROLES = new Set(['AXPopover', 'AXSheet', 'AXMenu', 'AXDialog']);

/**
 * Name the foreground surface covering the window, if one is open.
 *
 * A popover usually carries NO label, so the observation just looks like a window whose controls
 * vanished. That is what stranded a real run: with WhatsApp's "New chat" popover open, the tree
 * held 24 contact rows and no composer, so the model hunted for an attachment button that was not
 * in the map, clicked contacts instead, and looped. Saying "a popover is covering the window"
 * turns an invisible dead end into a recoverable one.
 */
function foregroundSurfaceNotice(elements: any[]): string | null {
  const windowFrame = elementFrame(elements.find(element => String(element?.role || '') === 'AXWindow'));
  const surface = elements.find(element => FOREGROUND_SURFACE_ROLES.has(String(element?.role || '')));
  if (!surface) return null;
  const frame = elementFrame(surface);
  const kind = String(surface.role || '').replace(/^AX/, '').toLocaleLowerCase();
  const where = frame && windowFrame
    ? ` at ${Math.round(frame.x)},${Math.round(frame.y)} (${Math.round(frame.w)}×${Math.round(frame.h)})`
    : '';
  return `A ${kind} is open${where} and is covering the window: the elements listed are ITS contents, `
    + `and every control of the page behind it is absent from this observation — not missing from the app. `
    + `If what you need is not listed, dismiss the ${kind} first (press escape, or click outside it), `
    + `re-observe, and only then look for the control.`;
}

/**
 * Warn when the app publishes almost nothing nameable.
 *
 * Mac Catalyst apps (WhatsApp) and some Chromium apps expose a shell: measured live, WhatsApp gave
 * 31 elements of which 22 were unlabeled buttons, against 397 labelled ones from a native app of
 * the same size. Silence here is expensive — the model keeps issuing `query` for an "attachment
 * button" that is not in the map, and every miss looks like a broken click. Naming the condition
 * lets it switch to the screenshot, which is the only place that information exists.
 */
function thinTreeNotice(elements: any[]): string | null {
  const actionable = elements.filter(element => ACTIONABLE_AX_ROLES.has(String(element?.role || '')));
  if (actionable.length === 0) return null;
  const unlabeled = actionable.filter(element => !String(element?.original_label || '').trim());
  if (unlabeled.length < 6 || unlabeled.length / actionable.length < 0.6) return null;
  return `This app exposes little accessibility text: ${unlabeled.length} of ${actionable.length} controls have no name of their own `
    + `(the "unlabeled …" entries are positions this runtime assigned, not names the app supplied). `
    + `Do not keep re-querying for a control by a name you expect — it is not in the map. Read the SCREENSHOT to find the control, `
    + `then click the nearest listed element or its screenshot pixel, and verify from the next frame.`;
}

/** Does `text` sit in the control's row or column closely enough to be its name? */
function textNamesControl(control: Frame, dx: number, dy: number): boolean {
  const sameRow = dy <= Math.max(20, control.h) && dx <= UNLABELED_TEXT_REACH.alongRow;
  const sameColumn = dx <= Math.max(20, control.w) && dy <= UNLABELED_TEXT_REACH.alongColumn;
  return sameRow || sameColumn;
}

/**
 * The macOS close/minimize/zoom buttons, which are AXButtons with no label like any icon control.
 *
 * They must never be offered as click targets: they are window management, they are reachable
 * through `close` and `arrange`, and a mis-aimed click on one destroys the window the task is
 * running in. Identified by the platform invariant — a small button in the window's top-left
 * corner — rather than by app, because every macOS window puts them in exactly that spot.
 */
function isWindowChrome(control: Frame, windowFrame: Frame | null): boolean {
  if (!windowFrame) return false;
  return control.w <= 22 && control.h <= 22
    && control.x - windowFrame.x <= 70
    && control.y - windowFrame.y <= 26;
}

/**
 * Strip window chrome from a driver element list. Applied to the RAW elements, before anything
 * splits into the model-visible map and the internal hit-test list — filtering only one of those
 * leaves the buttons clickable by raw x/y through the other.
 */
export function withoutWindowChrome(elements: any[]): any[] {
  const windowFrame = elementFrame(elements.find(element => String(element?.role || '') === 'AXWindow')) || null;
  if (!windowFrame) return elements;
  return elements.filter(element => {
    if (String(element?.role || '') !== 'AXButton') return true;
    const frame = elementFrame(element);
    return !frame || !isWindowChrome(frame, windowFrame);
  });
}

/**
 * Give every UNLABELED actionable control something a model can recognize and address.
 *
 * Icon-only buttons (send, attach, emoji, back, the WhatsApp sidebar rail) expose no AX label at
 * all, so they arrive as `AXButton ""`. `enrichControlLabels` cannot help: it only rewrites labels
 * that are GENERIC ("Info", "More"), and an empty label matches none of those patterns. The model
 * was therefore shown a row of indistinguishable blank buttons, could not name one in a `query`,
 * and fell back to guessing raw coordinates — the user-visible "it can't click unlabeled things".
 *
 * Name them by the nearest text in any direction (an icon's meaning usually sits beside or beneath
 * it), and when there is no nearby text at all, by stable position within the window. Position is a
 * weak name but a HONEST one: it distinguishes three blank buttons from each other, which is the
 * difference between an addressable control and a coin flip. The synthesized text goes to
 * `context_label`/`label` only — `original_label` stays empty so nothing pretends the app supplied
 * a name.
 */
export function describeUnlabeledControls(elements: any[]): any[] {
  const textRoles = new Set(['AXStaticText', 'AXHeading', 'AXLabel']);
  const texts = elements
    .map(candidate => ({ candidate, frame: elementFrame(candidate) }))
    .filter((entry): entry is { candidate: any; frame: Frame } =>
      !!entry.frame && textRoles.has(String(entry.candidate?.role || ''))
      && !!String(entry.candidate?.label || entry.candidate?.value || '').trim());
  const named = (entry: { candidate: any }) =>
    String(entry.candidate?.label || entry.candidate?.value || '').trim();

  // Window bounds anchor the positional fallback, so "top-left" means the window's corner rather
  // than the display's — the model reads these frames in window space.
  const actionable = elements
    .map(element => ({ element, frame: elementFrame(element) }))
    .filter((entry): entry is { element: any; frame: Frame } =>
      !!entry.frame && ACTIONABLE_AX_ROLES.has(String(entry.element?.role || '')));
  const windowFrame = elementFrame(elements.find(element => String(element?.role || '') === 'AXWindow')) || null;
  const blanks = actionable.filter(({ element, frame }) =>
    !ELEMENT_TEXT_KEYS.some(key => String(element?.[key] || '').trim())
    && !isWindowChrome(frame, windowFrame));
  if (blanks.length === 0) return elements;
  const window = elements.map(elementFrame).filter((frame): frame is Frame => !!frame);
  const bounds = window.length > 0 ? {
    x: Math.min(...window.map(frame => frame.x)), y: Math.min(...window.map(frame => frame.y)),
    right: Math.max(...window.map(frame => frame.x + frame.w)),
    bottom: Math.max(...window.map(frame => frame.y + frame.h)),
  } : null;

  const describe = ({ element, frame }: { element: any; frame: Frame }, ordinal: number): string => {
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    const nearest = texts
      .map(entry => {
        const tx = entry.frame.x + entry.frame.w / 2;
        const ty = entry.frame.y + entry.frame.h / 2;
        const dx = Math.abs(tx - cx);
        const dy = Math.abs(ty - cy);
        return { entry, dx, dy, distance: Math.hypot(dx, dy) };
      })
      .filter(({ dx, dy }) => textNamesControl(frame, dx, dy))
      .sort((a, b) => a.distance - b.distance)[0];
    // The ordinal rides along even when nearby text supplies a name: a row of icon buttons commonly
    // shares its nearest text (three controls beside one "Type a message" field), and three controls
    // with the SAME synthesized name are no more addressable than three blank ones.
    if (nearest) return `near "${named(nearest.entry).slice(0, 60)}" #${ordinal}`;
    if (!bounds || bounds.right <= bounds.x || bounds.bottom <= bounds.y) return `#${ordinal}`;
    const vertical = cy < bounds.y + (bounds.bottom - bounds.y) / 3 ? 'top'
      : cy > bounds.bottom - (bounds.bottom - bounds.y) / 3 ? 'bottom' : 'middle';
    const horizontal = cx < bounds.x + (bounds.right - bounds.x) / 3 ? 'left'
      : cx > bounds.right - (bounds.right - bounds.x) / 3 ? 'right' : 'center';
    return `${vertical}-${horizontal} #${ordinal}`;
  };

  // Order blanks top-to-bottom then left-to-right so the ordinal in a positional name is stable
  // across observations of an unchanged window instead of following driver walk order.
  const ordered = [...blanks].sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
  const descriptions = new Map<any, string>();
  ordered.forEach((entry, index) => descriptions.set(entry.element, describe(entry, index + 1)));

  return elements.map(element => {
    const description = descriptions.get(element);
    if (!description) return element;
    const role = String(element?.role || '').replace(/^AX/, '') || 'Control';
    return { ...element, context_label: description, label: `unlabeled ${role} ${description}` };
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

/** Same as exec(), but feeds `input` on stdin — needed for pbcopy/xclip, which read the payload
 * from stdin rather than argv (and must, since clipboard text can be arbitrarily large). */
function execWithInput(bin: string, args: string[], input: string, timeoutMs = 15_000, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, signal }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin} ${args[0] || ''}: ${String(stderr || err.message).trim().slice(0, 400)}`));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.on('error', () => { /* the callback above reports the real failure */ });
    child.stdin?.end(input, 'utf8');
  });
}

function binExists(name: string): boolean {
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(['/usr/bin', '/usr/sbin', '/opt/homebrew/bin', '/usr/local/bin']);
  return dirs.some(d => { try { fs.accessSync(path.join(d, name), fs.constants.X_OK); return true; } catch { return false; } });
}

const WAIT_MIN = 50, WAIT_MAX = 5000;

/** How long a cross-application drag holds over the destination before releasing. A receiving app
 *  has to be scheduled, process dragging-entered, and decide it accepts the type; the intra-window
 *  path finishes in under 100ms, which is reliably too fast for a background application. */
const CROSS_APP_DRAG_DWELL_MS = 700;

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

/** Committing verbs whose summary must carry the evidence verdict inline. The structured
 * actionResult already states it, but models act on the summary SENTENCE: in a live WhatsApp run,
 * the model clicked to open a chat and reported "Sent the message. Done." with nothing typed or
 * sent. Put the verdict where it cannot be skipped so a non-committing action cannot read as done. */
const VERDICT_VERBS = new Set<DesktopAction>(['click', 'type', 'key', 'set_value', 'drag', 'scroll']);

export function stampSummaryVerdict(result: DesktopResult): DesktopResult {
  const outcome = result.actionResult;
  if (!result.ok || !outcome || !result.summary || !VERDICT_VERBS.has(result.action)) return result;
  if (outcome.confidence === 'proven') return result;
  const clause = outcome.observed === 'no-change'
    ? ' — screen did NOT change: the input landed but nothing visibly happened; re-observe and adjust rather than assuming it worked'
    : outcome.observed === 'unverified'
      ? ' — UNVERIFIED: no fresh evidence proves any effect; re-observe before relying on it'
      : outcome.observed === 'changed'
        ? ' — screen changed; confirm the intended result is actually visible in this frame before calling the task done'
        : '';
  return clause ? { ...result, summary: `${result.summary}${clause}` } : result;
}

/** The Bimax-branded label for the pinned sidecar, kept in ONE place so the version bump in
 * scripts/stage-computer-use-driver.sh has a single companion edit here instead of four. */
export const BIMAX_DRIVER_LABEL = 'bimax-computer-use 0.12.3';

/** App names vary slightly between APIs ("Calculator" vs "Calculator.app"). macOS also wraps
 * localized names in invisible bidi format marks — System Events on macOS 26 reports "‎WhatsApp"
 * — which `trim()` does NOT remove. Comparing without stripping them made a frontmost app look
 * not-frontmost, failing every keyboard action with "could not focus X; frontmost app is X". */
export function appNamesMatch(actual: string, expected: string): boolean {
  const clean = (s: string) => stripInvisibleMarks(s).toLowerCase().replace(/\.app$/, '');
  return !!clean(actual) && clean(actual) === clean(expected);
}

/** A marked name is poison beyond comparison: driver >=0.12 reports names WITH the marks (0.8
 * reported them clean), and once one enters target state, `open -a` cannot find the app — focus
 * and every keyboard action after it die on a name that renders identically to the working one.
 * Strip marks wherever a driver-reported name ENTERS Bimax state, not only where names compare. */
export function stripInvisibleMarks(name: string): string {
  return name.replace(/[\u200B-\u200F\u2060-\u2069\u061C\uFEFF]/g, '').trim();
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
        if (this.resolveHelper()) return stripInvisibleMarks(String((await this.helper(['frontmost'])).app || ''));
        const { stdout } = await exec('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true']);
        return stripInvisibleMarks(stdout);
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
    // Launch Services lookups, answered by osascript so they work at EVERY driver tier (osascript
    // ships with macOS; the Swift helper needs Xcode CLT). Asking the OS about an app beats keeping
    // a hand-written table of well-known bundle ids that only ever covers the apps someone thought
    // of. Both are best-effort: an unresolvable name simply falls back to launching by name.
    if (cmd.action === 'bundle_id') {
      const name = (cmd.app || '').trim();
      if (!name) return { summary: 'no app name to resolve' };
      try {
        const { stdout } = await exec('osascript', ['-e', `id of application ${JSON.stringify(name)}`], 10_000, signal);
        const id = stdout.trim();
        return { bundleId: /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(id) ? id : undefined, summary: `bundle id for ${name}` };
      } catch { return { summary: `no bundle id for ${name}` }; }
    }
    if (cmd.action === 'app_running') {
      const name = (cmd.app || '').trim();
      if (!name) return { running: false, summary: 'no app name to check' };
      try {
        const { stdout } = await exec('osascript', ['-e', `application ${JSON.stringify(name)} is running`], 10_000, signal);
        return { running: stdout.trim() === 'true', summary: `${name} running check` };
      } catch { return { running: false, summary: `could not check whether ${name} is running` }; }
    }
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
        case 'frontmost': { const r = await this.helper(['frontmost'], signal); const app = stripInvisibleMarks(String(r.app || '')); return { app, summary: `frontmost app: ${app || '(unknown)'}` }; }
        case 'move': {
          const r = await this.helper(['move', String(cmd.x), String(cmd.y)], signal);
          // The helper waits for the cursor to be observably at the point and reports where it
          // actually is; a miss is surfaced rather than smoothed over.
          const exact = r.exact !== false;
          return {
            x: r.x, y: r.y,
            summary: exact
              ? `moved to ${cmd.x},${cmd.y}`
              : `move to ${cmd.x},${cmd.y} ended at ${r.x},${r.y} — the cursor did not reach the point (is the mouse being held?)`,
          };
        }
        case 'click': {
          const r = await this.helper(['click', String(cmd.x), String(cmd.y), cmd.button || 'left', String(cmd.count || 1), (cmd.modifier || []).join(',')], signal);
          return { app: r.app, x: r.x, y: r.y, summary: `${cmd.count === 2 ? 'double-' : cmd.count === 3 ? 'triple-' : ''}${cmd.button || 'left'} click at ${cmd.x},${cmd.y}${r.app ? ` in ${r.app}` : ''}` };
        }
        case 'drag': {
          // dwellMs turns the fast intra-window path into the slower paced one a cross-application
          // drop requires; omitted, the helper keeps its original timing exactly.
          const dwell = Number(cmd.ms || 0) > 0 ? [String(Math.round(cmd.ms!)), '16'] : [];
          await this.helper(['drag', String(cmd.x), String(cmd.y), String(cmd.toX), String(cmd.toY), ...dwell], signal, 60_000);
          return { summary: `dragged ${cmd.x},${cmd.y} → ${cmd.toX},${cmd.toY}` };
        }
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
        case 'desktop_icons': {
          const r = await this.helper(['desktop-icons'], signal);
          return { icons: Array.isArray(r.icons) ? r.icons : [], summary: `found ${r.count || 0} desktop item(s)` };
        }
        case 'screens': {
          const r = await this.helper(['screens'], signal);
          return { screens: Array.isArray(r.screens) ? r.screens : [], summary: `found ${r.screens?.length || 0} screen(s)` };
        }
        case 'window_frame': {
          const r = await this.helper(['window-frame', String(cmd.pid)], signal);
          return { windowFrame: r.frame, fullscreen: !!r.fullscreen, summary: 'read the window frame' };
        }
        case 'window_at': {
          const r = await this.helper(['window-at', String(cmd.x), String(cmd.y)], signal, 5_000);
          return { windowAt: r.window || undefined, summary: r.window ? `${r.window.owner_name} window ${r.window.window_id}` : 'no window at that point' };
        }
        case 'window_raise': {
          const f = cmd.bounds!;
          const r = await this.helper(['window-raise', String(cmd.pid), String(f.x), String(f.y), String(f.w), String(f.h)], signal, 10_000);
          return { raised: !!r.raised, summary: r.raised ? 'raised the window' : 'the window could not be raised' };
        }
        case 'ax_enable': {
          const r = await this.helper(['ax-enable', String(cmd.pid)], signal, 5_000);
          return { applied: !!r.applied, summary: r.applied ? 'requested the full accessibility tree' : 'app declined the accessibility opt-in' };
        }
        case 'modal_frame': {
          const r = await this.helper(['modal-frame', String(cmd.pid)], signal, 5_000);
          return { modalFrame: r.modal || undefined, summary: r.modal ? 'a modal sheet or dialog is open' : 'no modal blocker' };
        }
        case 'window_set_frame': {
          const f = cmd.bounds!;
          const r = await this.helper(['window-set-frame', String(cmd.pid), String(f.x), String(f.y), String(f.w), String(f.h)], signal, 30_000);
          return { windowFrame: r.frame, requestedFrame: r.requested, summary: 'set the window frame' };
        }
        case 'window_fullscreen': {
          // The transition is animated and the helper polls until it settles, so allow well past
          // the ~1s animation before calling it a driver timeout.
          const r = await this.helper(['window-fullscreen', String(cmd.pid), cmd.value === 'true' ? 'true' : 'false'], signal, 30_000);
          return { fullscreen: !!r.fullscreen, fullscreenSupported: !!r.supported, fullscreenMatched: !!r.matched, summary: `fullscreen ${r.fullscreen ? 'on' : 'off'}` };
        }
        case 'clipboard_read': {
          const r = await this.helper(['clipboard-read'], signal);
          return {
            clipboard: {
              text: Buffer.from(String(r.textBase64 || ''), 'base64').toString('utf8'),
              files: Array.isArray(r.files) ? r.files.map(String) : [],
              types: Array.isArray(r.types) ? r.types.map(String) : [],
              changeCount: Number(r.changeCount ?? -1),
            },
            summary: 'read the clipboard',
          };
        }
        case 'clipboard_write': {
          const r = await this.helper(['clipboard-write', Buffer.from(cmd.text || '', 'utf8').toString('base64')], signal);
          return { clipboard: { text: cmd.text || '', files: [], types: [], changeCount: Number(r.changeCount ?? -1) }, summary: `wrote ${(cmd.text || '').length} chars to the clipboard` };
        }
        case 'clipboard_write_files': {
          const paths = (cmd.paths || []).filter(Boolean);
          if (!paths.length) throw new Error('clipboard file write needs at least one path');
          const r = await this.helper(['clipboard-write-files', ...paths], signal);
          return { clipboard: { text: '', files: paths, types: ['public.file-url'], changeCount: Number(r.changeCount ?? -1) }, summary: `put ${paths.length} file(s) on the clipboard` };
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
      // pbcopy/pbpaste ship with macOS, so the clipboard bridge keeps working without Xcode CLT.
      // The one thing this path CANNOT provide is NSPasteboard.changeCount, so it reports -1 and the
      // runtime falls back to comparing content across the copy instead of trusting a counter.
      case 'clipboard_read': {
        const { stdout } = await exec('pbpaste', [], 15_000, signal);
        return { clipboard: { text: stdout, files: [], types: [], changeCount: -1 }, summary: 'read the clipboard' };
      }
      case 'clipboard_write': {
        await execWithInput('pbcopy', [], cmd.text || '', 15_000, signal);
        return { clipboard: { text: cmd.text || '', files: [], types: [], changeCount: -1 }, summary: `wrote ${(cmd.text || '').length} chars to the clipboard` };
      }
      case 'clipboard_write_files':
        // Putting FILE REFERENCES on the pasteboard is an NSPasteboard operation; pbcopy only moves
        // text. Say so plainly rather than silently copying the paths as a string, which would paste
        // the literal text "/Users/…/photo.jpg" into the app instead of attaching the photo.
        throw new Error('putting files on the clipboard needs the native helper — install Xcode Command Line Tools (xcode-select --install), or attach the file through the app\'s own file picker instead');
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
      // X11 has no changeCount equivalent, so -1 sends the runtime down the content-comparison path.
      case 'clipboard_read': {
        if (!binExists('xclip')) throw new Error('reading the clipboard on Linux needs xclip');
        const { stdout } = await exec('xclip', ['-selection', 'clipboard', '-o'], 15_000, signal);
        return { clipboard: { text: stdout, files: [], types: [], changeCount: -1 }, summary: 'read the clipboard' };
      }
      case 'clipboard_write': {
        if (!binExists('xclip')) throw new Error('writing the clipboard on Linux needs xclip');
        await execWithInput('xclip', ['-selection', 'clipboard'], cmd.text || '', 15_000, signal);
        return { clipboard: { text: cmd.text || '', files: [], types: [], changeCount: -1 }, summary: `wrote ${(cmd.text || '').length} chars to the clipboard` };
      }
      case 'clipboard_write_files':
        // xclip can advertise text/uri-list, but only for as long as it stays running to serve the
        // selection — an ownership model this single-shot driver cannot satisfy. Refuse rather than
        // copy the paths as plain text, which would paste a filename string instead of the file.
        throw new Error('putting files on the clipboard is not supported on X11 from this driver — attach the file through the app\'s own file picker instead');
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
 * The sidecar is derived from trycua/cua 0.12.3 (MIT) but no Cua surface leaks into Bimax: the
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
  /** Newest desktop enumeration, so a move can be judged against where items were beforehand. */
  private desktopIcons: Array<{ name: string; frame: ScreenRect }> = [];
  private observedTarget: { pid: number; windowId?: number; degraded: boolean; width?: number; height?: number } | null = null;
  private observedWindowFrame: { x: number; y: number; w: number; h: number } | null = null;
  /** Frame identity (frame.ts) — binds an action to the exact picture it was planned from, so a
   * stale frame of the SAME window is caught, not just a target switch. */
  private readonly frames = new FrameRegistry();
  /** Backing scale of the main display, refreshed whenever screen geometry is read. Descriptive
   * only: window screenshots are already point-scaled, so no transform multiplies by it. */
  private mainDisplayScale = 1;
  /** Measured target-switch latencies (switch.ts), so the p95 target is reported, not asserted. */
  private readonly switchLatency = new SwitchLatencyLog();
  private lastSwitch: TargetSwitch | null = null;
  /** The ONE serialized native-input executor (input.executor.ts). There is one physical mouse; two
   * overlapping actions would interleave into a sequence nobody designed. Also the record of which
   * buttons are physically held, so a cancel/dispose can release them. */
  private readonly input = new InputExecutor();
  /** Where each window sat before this session last arranged it, keyed by pid — what layout=restore
   * puts back. Bounded by the number of apps a session touches. */
  private readonly priorWindowBounds = new Map<number, ScreenRect>();
  /** The window owned before the last turn boundary — remembered, never auto-acted on. */
  private lastOwnedTarget: ComputerTarget | null = null;
  /** Which surface the newest image describes. Context menus/popovers are separate OS windows that
   * a window-scoped PNG can never show, so right-click switches to a full-display observation:
   * image pixels == global display points (identity frame), and physical input skips activation
   * because bring_to_front would dismiss the very menu the model is about to click. */
  private observedSurfaceKind: 'window' | 'display' = 'window';
  /** System Settings reports a sheet as the first app window while its screenshot is composed in
   * the larger parent-window coordinate space. Track the sheet independently so pixels keep mapping
   * through the parent and background clicks can be rejected instead of silently doing nothing. */
  private transientDialogFrame: Frame | null = null;
  /** Processes already asked for a full accessibility tree — the opt-in is idempotent but not free. */
  private axEnabledPids = new Set<number>();
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
    return { driver: BIMAX_DRIVER_LABEL, ready: true, ...this.lastStatus };
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
  /** Measured target-switch latency this session (count/p50/p95/worst, ms). Nulls before any
   * switch has happened — an unmeasured percentile is reported as unknown, never as zero. */
  public switchLatencySummary(): { count: number; p50: number | null; p95: number | null; worst: number | null } {
    return this.switchLatency.summary();
  }

  /** Per-phase durations of the most recent switch. A slow switch is only actionable once the time
   * is attributed to the step that spent it, so the trace is kept rather than just the total. */
  public lastSwitchPhases(): Array<{ phase: string; ms: number }> {
    return this.lastSwitch ? this.lastSwitch.phaseDurations() : [];
  }

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

  /** Record an acting verb into the bounded history and persist the session state (throttled).
   * The frame the action was planned from is stamped from the registry, so the history answers
   * "which picture was this click chosen from" without the call sites having to thread it. */
  private recordAction(action: string, app: string | undefined, outcome?: string): void {
    this.actionHistory.record(action, { app, outcome, frameId: this.frames.current()?.frameId });
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
    // A takeover in the middle of a staged selection would leave the user's own mouse fighting a
    // button the agent is still holding. Hand the desktop back neutral. Deliberately not awaited:
    // pauseForUser must return instantly so the human regains control without waiting on IO.
    void this.releaseHeldInput('user took control');
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

  /**
   * Return the desktop to a neutral input state: post a mouse-up for every button the agent is
   * still physically holding.
   *
   * Called on dispose and on user takeover — the two moments a held button would otherwise outlive
   * the code that owns it. Failures are collected and reported, never retried in a loop: a button
   * that will not release is something the human needs told about, not something to hammer.
   */
  public async releaseHeldInput(reason: string): Promise<{ released: number; errors: string[] }> {
    const owed = this.input.takeReleasePlan();
    if (!owed.length) return { released: 0, errors: [] };
    const errors: string[] = [];
    for (const held of owed) {
      try {
        const result = await this.fallback.run({ action: 'mouse_up', x: held.x, y: held.y, button: held.button, normalized: false });
        if (!result.ok) errors.push(`${held.button} at ${held.x},${held.y}: ${result.error || result.summary}`);
      } catch (err: any) {
        errors.push(`${held.button} at ${held.x},${held.y}: ${String(err?.message || err)}`);
      }
    }
    const note = `released ${owed.length - errors.length}/${owed.length} held mouse button(s) (${reason})`;
    cliEvents.emit('status', errors.length ? `${note}; STILL HELD: ${errors.join('; ')}` : note);
    return { released: owed.length - errors.length, errors };
  }

  public describeTarget(cmd: DesktopCommand) {
    const key = cmd.elementToken ? `token:${cmd.elementToken}`
      : cmd.elementIndex != null ? `index:${Math.floor(cmd.elementIndex)}` : '';
    return key ? this.indexedElements.get(key) || null : null;
  }

  public async dispose(): Promise<void> {
    const wasRecording = this.recording.started;
    // Release anything the desktop is still physically holding BEFORE tearing state down. A turn
    // aborted between mouse_down and mouse_up leaves the button down at the OS level, which outlives
    // this process and breaks the user's own mouse. This is the one cleanup that must not be
    // best-effort-and-forget, so a failure is reported rather than swallowed silently.
    await this.releaseHeldInput('session ended');
    // Persist a final durable snapshot (active surface + compressed history) BEFORE tearing state
    // down, so an interrupted run can be resumed via loadPersistedState() on the next launch.
    try { writeSessionState(this.sessionStateFile(this.lastCwd), this.buildSessionState()); }
    catch { /* best-effort */ }
    // Session-scoped identity and observations must never leak into the next user turn. In
    // particular, closing the client is what removes the experimental PiP window.
    // The identity is REMEMBERED (not owned) across the boundary so a follow-up turn can re-acquire
    // the same window via observe — see reacquireLastTarget(). Remembering cannot deliver input:
    // ownership is still dropped here, and acting verbs still require a fresh frame.
    this.lastOwnedTarget = this.targets.current() ?? this.lastOwnedTarget;
    this.targets.clear();
    this.pipGeneration++;
    this.pipPaused = false;
    this.indexedElements.clear();
    this.observedElements = [];
    this.desktopIcons = [];
    this.observedTarget = null;
    this.observedWindowFrame = null;
    this.observedSurfaceKind = 'window';
    this.frames.invalidate();
    this.priorWindowBounds.clear();
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
    const tied = candidates.filter(candidate => candidate.score === candidates[0].score);
    // A heading and a button can carry the SAME text (WhatsApp's "Chats" titles its pane and its
    // sidebar button). Every caller of this resolver is about to interact, so a clickable control
    // beats an identically-named label outright rather than tying with it into a dead-end
    // "ambiguous" error. Only when the tie is between real controls is it genuinely unresolvable.
    const clickable = tied.filter(candidate => ACTIONABLE_AX_ROLES.has(String(candidate.element.role || '')));
    const best = clickable.length > 0 ? clickable : tied;
    const unique = new Map<string, typeof best[number]>();
    for (const candidate of best) {
      const key = `${clean(candidate.element.label)}|${JSON.stringify(candidate.element.frame || '')}`;
      if (!unique.has(key)) unique.set(key, candidate);
    }
    if (unique.size > 1) {
      // Name the handle for each choice: when duplicates share a label ("Chats" appears twice in
      // WhatsApp's sidebar) the labels alone give the model nothing to choose BETWEEN, and it
      // resorts to guessing coordinates. An elementIndex is something it can act on directly.
      const choices = Array.from(unique.values()).slice(0, 6)
        .map(candidate => `${candidate.element.role || 'element'} "${candidate.element.label || candidate.element.value || '?'}"`
          + (candidate.element.elementIndex != null ? ` (elementIndex ${candidate.element.elementIndex})` : ''))
        .join(', ');
      throw new Error(`semantic query "${query}" is ambiguous: ${choices}; retry with the exact elementIndex of the one you want, or observe with a narrower query`);
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

  /** Innermost observed actionable control whose visible frame contains a raw screenshot point.
   * The smallest containing frame wins, so a button inside a large row resolves to the button, not
   * its container. A raw x/y click is the model's GUESS; this reveals what the pixel actually hits
   * so the summary can NAME it and (for compact controls) snap to its center. */
  private actionableElementAtScreenshotPoint(point: { x: number; y: number }): { element: ObservedElement; screenshotFrame: Frame } | null {
    const shot = this.observedTarget;
    const windowFrame = this.observedWindowFrame;
    if (!shot?.width || !shot?.height || !windowFrame) return null;
    let best: { element: ObservedElement; screenshotFrame: Frame } | null = null;
    for (const element of this.observedElements) {
      if (!ACTIONABLE_AX_ROLES.has(String(element.role || ''))) continue;
      const frame = elementFrame(element);
      if (!frame) continue;
      const screenshotFrame = globalFrameToScreenshot(
        frame,
        { width: shot.width, height: shot.height },
        windowFrame,
      );
      if (!screenshotFrame || !pointInFrame(point, screenshotFrame)) continue;
      if (!best || screenshotFrame.w * screenshotFrame.h < best.screenshotFrame.w * best.screenshotFrame.h) {
        best = { element, screenshotFrame };
      }
    }
    return best;
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

  /**
   * Record the frame identity for a capture that has just been stored in `observedTarget` /
   * `observedWindowFrame`. Returns null when the capture has no usable mapping geometry — a frame
   * without bounds cannot anchor a coordinate, and minting one anyway would hand out an id that
   * validates but transforms wrongly.
   */
  private mintFrame(spec: {
    captureKind: 'window' | 'display';
    target: ComputerTarget;
    bounds: Frame | null;
    image: { width?: number; height?: number };
    frameHash?: string;
  }): FrameMetadata | null {
    const { bounds, image } = spec;
    if (!bounds?.w || !bounds?.h || !image.width || !image.height) return null;
    return this.frames.mint({
      captureKind: spec.captureKind,
      pid: spec.target.pid,
      windowId: spec.target.windowId,
      app: spec.target.app,
      bounds: { ...bounds },
      image: { width: image.width, height: image.height },
      // Window screenshots reach the model at POINT resolution (see the coordinate contract at the
      // top of this file), so the mapping never multiplies by the backing scale. It is recorded as
      // descriptive metadata — whenever a `screens` read has told us what it is.
      displayScale: this.mainDisplayScale,
      frameHash: spec.frameHash,
    });
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
    const frame = this.mintFrame({
      captureKind: 'display', target, frameHash,
      bounds: this.observedWindowFrame,
      image: { width: dims.width, height: dims.height },
    });
    return {
      screenshot: shot.screenshot, frameHash, frameId: frame?.frameId, width: dims.width, height: dims.height,
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
    await this.ensureTargetReceivesPoint(target, global, frame);
    return global;
  }

  /**
   * Prove the target app would actually RECEIVE a click at this point before posting one.
   *
   * A single-window capture excludes whatever covers the window, but a synthesized click goes to
   * whichever surface is topmost at that point on the real screen. When something is on top, the
   * picture and the input disagree: the model reasons about pixels from one window and the click
   * lands in another. Nothing here noticed that until now, which is what "the clicks are inaccurate
   * and the model doesn't know what it's clicking" was.
   *
   * The authority is the ACCESSIBILITY hit test, not the window stack. Measured live, the driver's
   * own click-through overlay sits at layer 0 across the whole target window, so a stack-based test
   * called every point blocked; AX resolves what would truly receive the event, so click-through
   * windows correctly fall through. Anything the probe cannot answer leaves the click alone —
   * a guard that cannot see must not veto.
   */
  private async ensureTargetReceivesPoint(
    target: ComputerTarget, point: { x: number; y: number }, frame: Frame | null,
  ): Promise<void> {
    const recipientAt = async (): Promise<{ pid: number; name: string; topName: string } | null> => {
      try {
        const probe = await this.fallback.run({ action: 'window_at', x: point.x, y: point.y });
        const hit = probe.ok ? probe.windowAt : undefined;
        if (!hit || !Number(hit.owner_pid)) return null;
        return { pid: Number(hit.owner_pid), name: String(hit.owner_name || ''), topName: String((hit as any).top_owner_name || '') };
      } catch { return null; }
    };
    let who = await recipientAt();
    if (!who || who.pid === target.pid) return;

    // Our own Live Preview is a floating panel: raising the target can never get above it (Apple
    // documents floating windows as staying above kAXRaiseAction), so ask the panel to step aside.
    if (this.livePip.pid?.() === who.pid && frame) {
      this.livePip.avoid?.(frame);
      await new Promise(resolve => setTimeout(resolve, 250));
      who = await recipientAt();
      if (!who || who.pid === target.pid) return;
    }

    // Some other window is over the point. Raise the target WINDOW (not merely its app) and re-test.
    if (frame) {
      try { await this.fallback.run({ action: 'window_raise', pid: target.pid, bounds: frame }); }
      catch { /* the re-test below is the real check */ }
      await new Promise(resolve => setTimeout(resolve, 200));
      who = await recipientAt();
      if (!who || who.pid === target.pid) return;
    }

    throw new Error(`${who.name || `pid ${who.pid}`} is on top of (${point.x},${point.y}), so the click would land there `
      + `instead of in ${target.app || `pid ${target.pid}`}. The screenshot does not show it, because a window capture `
      + `excludes whatever covers the window. Move or close that window (or use arrange to place them side by side), then re-observe.`);
  }

  private verifyPhysicalClick(target: ComputerTarget, requested: { x: number; y: number }, result: DesktopResult): void {
    if (result.x != null && result.y != null && Math.hypot(result.x - requested.x, result.y - requested.y) > 3) {
      throw new Error(`native cursor did not land at the requested point (${requested.x},${requested.y}); it reported ${result.x},${result.y}`);
    }
    if (result.app && !this.appNamesMatch(result.app, target.app)) {
      throw new Error(`physical click landed while ${result.app} was frontmost, not ${target.app || `pid ${target.pid}`}`);
    }
  }

  /**
   * Which application actually received the click. Answers the model's real question — "what did I
   * just click?" — with the OS's answer rather than "an event was delivered", which was true even
   * when a floating panel swallowed it.
   */
  private async clickRecipient(point: { x: number; y: number }): Promise<string> {
    try {
      const probe = await this.fallback.run({ action: 'window_at', x: point.x, y: point.y });
      return probe.ok && probe.windowAt ? String(probe.windowAt.owner_name || '') : '';
    } catch { return ''; }
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
    const driver = BIMAX_DRIVER_LABEL;
    const screenshotPoint = this.groundScreenshotPoint(target, cmd, primitive);
    const global = await this.preparePhysicalPoint(target, screenshotPoint);
    const native = await this.fallback.run({ action: primitive, x: global.x, y: global.y, button: cmd.button, ms: cmd.ms, app: target.app, normalized: false }, ctx);
    if (!native.ok) throw new Error(native.error || native.summary);
    // Held-button bookkeeping. `mouse_down` leaves a physical button down across calls, and a turn
    // that is aborted in that gap would otherwise leave the desktop wedged for the human. Recording
    // it here is what lets dispose/takeover compute the exact compensating mouse-up.
    if (primitive === 'mouse_down') this.input.noteButtonDown(heldButtonFor(cmd.button), global.x, global.y);
    else if (primitive === 'mouse_up') this.input.noteButtonUp(heldButtonFor(cmd.button));
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

  /**
   * Re-establish ownership of the window this runtime drove before the last turn boundary.
   *
   * dispose() deliberately drops target ownership after every user turn so a stale identity cannot
   * silently receive input. But the app it was driving is still on screen, and a follow-up request
   * ("now reply to her") continues the same workflow — so dropping the identity outright stranded
   * the model with no legal move: observe needs a target, input needs a frame only observe can
   * produce, and `open` looks wrong for an app that is demonstrably already open.
   *
   * Re-acquire only when the remembered process is STILL ALIVE and still has a real window: a
   * quit-and-relaunched app gets a new pid, and re-adopting a dead one would aim input at whatever
   * inherited it. Returns null when the app is gone, leaving the caller's honest error intact.
   */
  private async reacquireLastTarget(): Promise<ComputerTarget | null> {
    const remembered = this.lastOwnedTarget;
    if (!remembered?.pid) return null;
    const refreshed = await this.refreshTargetWindow({ ...remembered, windowId: undefined });
    if (!refreshed.windowId) return null;
    this.targets.set(refreshed);
    this.lastOwnedTarget = refreshed;
    cliEvents.emit('status', `re-acquired ${refreshed.app || `pid ${refreshed.pid}`} window ${refreshed.windowId} from the previous turn`);
    return refreshed;
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
    // The scan cap is the single biggest cost in an observe, so it is sized from MEASUREMENT.
    // Benchmarked on this machine against the 0.12.3 driver (Notes, screenshot off):
    //   cap   50 →   22ms      cap  400 → 1491ms
    //   cap  100 →   56ms      cap  800 → 3013ms
    //   cap  200 →  585ms      cap 2000 → 6125ms
    // ~3.7ms per node, linear — NOT the "~0.2s even at 2000" this code previously assumed. A flat
    // +500 "menu allowance" was added on that wrong estimate and made every observe walk 800 nodes,
    // so each one cost ~3s: the sluggishness the smaller floors below were introduced to remove.
    // The same measurement shows the premise was also wrong — the driver returned ZERO menu-role
    // nodes at every cap from 50 to 800, so the allowance bought nothing at all.
    //
    // The menu-first walk it guarded against is real for some apps, but it is already handled far
    // more cheaply by the escalation below: if the walk hit its cap without yielding a single
    // window element, rescan once at the ceiling. That pays 6s only for the apps that need it,
    // instead of 3s for every observe of every app.
    const DRIVER_MAX_SCAN = 2000;
    // Chromium apps publish a placeholder tree until asked; do it before the scan, not after, or
    // this observation is the thin one and the model acts on it.
    await this.enableRichAccessibility(target.pid);
    const scanElements = Math.min(DRIVER_MAX_SCAN, cmd.query
      ? Math.max(600, maxElements)
      : Math.max(300, maxElements));
    const requestWindowState = (cap: number) => this.call('get_window_state', {
      pid: target.pid,
      window_id: target.windowId,
      session,
      include_screenshot: cmd.includeScreenshot !== false,
      screenshot_out_file: screenshot,
      ...(cmd.query ? { query: cmd.query } : {}),
      max_elements: cap,
    });
    const menuRoles = new Set(['AXMenuBar', 'AXMenuBarItem', 'AXMenu', 'AXMenuItem']);
    // Describe the blanks only AFTER the generic-label pass, so a control that enrichControlLabels
    // could name from its row keeps that real name instead of a positional placeholder.
    const windowElementsOf = (raw: any[]) => describeUnlabeledControls(enrichControlLabels(
      raw.filter((element: any) => !menuRoles.has(String(element?.role || ''))),
    ));
    let data = await requestWindowState(scanElements);
    let rawElements: any[] = withoutWindowChrome(sanitizeDriverElements(Array.isArray(data?.elements) ? data.elements : []));
    let windowElements = windowElementsOf(rawElements);
    // An unusually large menu tree can still swallow the whole budget. When the walk hit the cap
    // without yielding a single window element, rescan once at the driver's ceiling before
    // declaring the window degraded.
    if (windowElements.length === 0 && rawElements.length >= scanElements && scanElements < DRIVER_MAX_SCAN) {
      data = await requestWindowState(DRIVER_MAX_SCAN);
      rawElements = withoutWindowChrome(sanitizeDriverElements(Array.isArray(data?.elements) ? data.elements : []));
      windowElements = windowElementsOf(rawElements);
    }
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
      // Do NOT assert a permission problem we have not established. This message used to name
      // Screen Recording as the cause outright, so on a minimized/other-Space window the model
      // relayed "please enable Screen Recording" to a user who already had it granted — a false
      // diagnosis that ended the task. A window that is hidden, minimized, or on another Space
      // captures empty for reasons that have nothing to do with TCC, and macOS strips AX detail
      // there too. Name what we actually know, and only raise permissions when it is still plausible.
      const permissionKnownGood = this.lastStatus.screenRecording === true;
      throw new Error(`the sidecar returned no usable pixels for ${target.app || `pid ${target.pid}`} window ${target.windowId}`
        + ' — the window is most likely minimized, hidden, or on another macOS Space (all of which also strip its accessibility detail).'
        + ` Bring it back with action=open app="${target.app}" and observe again`
        + (permissionKnownGood ? '.' : ', or run action=status if you suspect Screen Recording permission.'));
    }
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
    // Mint the frame identity this observation's coordinates belong to. Every acting verb planned
    // from this picture is checked against it, so a stale frame of the SAME window is caught rather
    // than silently clicking whatever now occupies those pixels.
    const frame = this.mintFrame({
      captureKind: 'window', target, frameHash,
      bounds: this.observedWindowFrame,
      image: { width: screenshotWidth, height: screenshotHeight },
    });
    return {
      ok: true, action: cmd.action === 'screenshot' ? 'screenshot' : 'observe', driver: BIMAX_DRIVER_LABEL,
      app: target.app, pid: target.pid, windowId: target.windowId,
      screenshot: screenshotFile, frameHash, frameId: frame?.frameId,
      width: screenshotWidth, height: screenshotHeight,
      coordinateSpace: { xY: 'screenshot_pixels', elementFrames: 'screenshot_pixels', normalized: '0-1000' },
      completionGuidance: [
        COMPUTER_COMPLETION_GUIDANCE,
        this.transientDialogFrame ? 'A foreground dialog is currently detected; dismiss it before attempting any background control.' : '',
        foregroundSurfaceNotice(elements) || '',
        thinTreeNotice(windowElements) || '',
      ].filter(Boolean).join(' '),
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
        // The post-action capture SUPERSEDES the frame the action was planned from, so the caller
        // must be handed the new id — otherwise the next action would echo back the pre-action
        // frameId and be correctly, but uselessly, refused as stale.
        screenshot: observed.screenshot, frameHash: observed.frameHash, frameId: observed.frameId,
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
      this.frames.invalidate();
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
        // A modal sheet can be listed before the main window, while the sidecar PNG is the full
        // composed main window. Pinning the sheet id therefore compressed every screenshot
        // coordinate into its tiny frame. Use the main surface for capture/mapping and retain the
        // sheet bounds as a modal input guard.
        //
        // Shape alone CANNOT identify a sheet, and assuming it could is what broke clicking in
        // ordinary apps: an Electron app (WhatsApp) enumerates incidental child windows that are
        // smaller than and inside the main window, so every one of them was read as a modal and
        // every click outside its rectangle was refused as "a foreground dialog is blocking that
        // background point". Geometry only NARROWS the candidates here; macOS itself confirms
        // modality via AX (see the helper's modal-frame probe), which is app-agnostic and correct.
        const candidate = visible.find((w: any) => Number(w.window_id) !== Number(largest.window_id)
          && area(w) >= 20_000 && area(w) < area(largest) * 0.5
          && rectMostlyInside(w?.bounds, largest?.bounds));
        // Direction of safety: an absent guard costs one refused click that the OS would have
        // blocked anyway, while a phantom guard blocks EVERY click in the app. So anything short of
        // a positive OS confirmation — no candidate, no helper, no permission — means no guard.
        this.transientDialogFrame = candidate ? await this.confirmedModalFrame(target) : null;
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

  /**
   * Ask macOS whether this app currently has a real modal blocker, and where it is.
   *
   * Only called once geometry has found a plausible candidate, so the common case (no contained
   * child window) never pays for the probe. Returns null on any doubt — see the caller for why the
   * failure direction matters.
   */
  /**
   * Ask a Chromium-based app to publish its real accessibility tree, once per process.
   *
   * Electron apps (WhatsApp, Slack, Discord, VS Code, Notion) ship a placeholder tree until a
   * client opts in: measured live, WhatsApp exposed 31 elements — 22 of them unlabeled buttons —
   * where a native app of the same size exposed 397 labelled ones. With nothing nameable in the
   * map, `query` cannot resolve anything and the model falls back to guessing raw pixels, which is
   * what "the clicks are inaccurate and meaningless" actually was.
   *
   * Best-effort by construction: native apps refuse the attribute, and a refusal (or a missing
   * helper) simply leaves the observation as it was.
   */
  private async enableRichAccessibility(pid: number): Promise<void> {
    if (process.platform !== 'darwin' || !pid || this.axEnabledPids.has(pid)) return;
    this.axEnabledPids.add(pid);
    try { await this.fallback.run({ action: 'ax_enable', pid }); }
    catch { /* the observation is still usable, just thinner */ }
  }

  private async confirmedModalFrame(target: ComputerTarget): Promise<Frame | null> {
    if (process.platform !== 'darwin' || !target.pid) return null;
    try {
      const probe = await this.fallback.run({ action: 'modal_frame', pid: target.pid });
      const rect = probe.ok ? probe.modalFrame : undefined;
      if (!rect || !(Number(rect.w) > 0) || !(Number(rect.h) > 0)) return null;
      return { x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h) };
    } catch {
      return null; // no helper / no Accessibility permission — never guess a blocker into existence
    }
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

  /** Fire the macOS "reopen" event (`open -a`, which triggers applicationShouldHandleReopen) to
   * materialize a CLOSED main window — WhatsApp/Spotify/Discord keep running with no window when you
   * close it, and `open` then captured a blank placeholder with no window controls (a degraded
   * observation). Re-acquire the window and re-capture. Returns the new target + evidence plus
   * whether the window is STILL unusable, so the caller can warn honestly. Best-effort; harmless
   * (a no-op that just fronts the app) when the window was already open. */
  private async reopenClosedMainWindow(
    target: ComputerTarget, cwd: string, session: string, ctx?: { cwd?: string; signal?: AbortSignal },
  ): Promise<{ target: ComputerTarget; evidence: Partial<DesktopResult>; stillClosed: boolean }> {
    try { await this.fallback.run({ action: 'open', app: target.app }, ctx); }
    catch { return { target, evidence: {}, stillClosed: true }; }
    // Poll for the window to materialize instead of sleeping a fixed 450 ms: WindowServer is
    // usually far quicker, and when it is not, a fixed wait would have declared failure early.
    const appeared = await waitFor(
      async () => {
        const candidate = await this.refreshTargetWindow({ ...target, windowId: undefined });
        return candidate.windowId ? candidate : null;
      },
      { timeoutMs: 1500, intervalMs: 80 },
    );
    const reacquired = appeared.value ?? await this.refreshTargetWindow({ ...target, windowId: undefined });
    this.targets.set(reacquired);
    if (!reacquired.windowId) return { target: reacquired, evidence: {}, stillClosed: true };
    const evidence = await this.postActionEvidence(reacquired, cwd, session);
    const stillClosed = !!evidence.visualEvidenceError || evidence.degraded === true;
    return { target: reacquired, evidence, stillClosed };
  }

  /**
   * Bring a target forward, settle it, and capture its first trustworthy frame.
   *
   * Shared by `open` (after launch_app) and `focus` (which switches to an app the session already
   * has open, without re-launching it). These two must never drift: the activation escalation and
   * the closed-window recovery below are the difference between a frame that describes the intended
   * app and one that describes whatever was in front of it.
   */
  private async activateAndCapture(
    initial: ComputerTarget, cwd: string, session: string,
    delivery: 'foreground' | 'background', ctx?: { cwd?: string; signal?: AbortSignal },
    /** The target that was active BEFORE the caller claimed ownership of `initial`. Both `open` and
     * `focus` register the new target first, so reading it here would always report the new app and
     * every switch would look like a no-op re-focus — which is exactly how the latency measurement
     * silently recorded nothing. Callers that reassign ownership must pass the real predecessor. */
    previous: ComputerTarget | null = this.targets.current(),
  ): Promise<{ target: ComputerTarget; evidence: Partial<DesktopResult>; frontmostWarning?: string; switchMs?: number }> {
    let opened = initial;
    let frontmostWarning: string | undefined;
    // Phase 4 — the switch is a TRANSACTION, not a call. Freezing input is the first thing that
    // happens and it is enforced, not advisory: invalidating the frame registry means every acting
    // verb's freshness gate refuses until a frame of the NEW target exists. That is what closes the
    // window in which a click could still be delivered to the app we are switching away from.
    const transaction = new TargetSwitch(
      previous ? { app: previous.app, pid: previous.pid, windowId: previous.windowId } : null,
      { app: initial.app, pid: initial.pid, windowId: initial.windowId },
    );
    transaction.resolve();
    transaction.freezeInput('frame registry invalidated — no input can reach the previous target');
    this.frames.invalidate();
    if (delivery === 'foreground') {
      transaction.activate();
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
      // bring_to_front returning ok does NOT mean the app actually came forward — some apps
      // (Electron/Catalyst) accept the call yet leave the terminal frontmost. Verify the truth; if a
      // different app is positively still in front, escalate to the native `open -a` contract and
      // re-check. Only then do we trust that it is focused.
      //
      // POLL for that rather than sleeping a fixed 250 ms and hoping. An app that fronts in 30 ms
      // costs 30 ms; one that needs 600 ms gets 600 ms instead of being misjudged as failed. The
      // budget is the honest upper bound, not the normal cost.
      const fronted = await waitUntil(async () => !(await this.frontmostMismatch(opened.app)), { timeoutMs: 900, intervalMs: 40 });
      let stillWrong = fronted.settled ? '' : await this.frontmostMismatch(opened.app);
      if (stillWrong) {
        try { await this.fallback.run({ action: 'open', app: opened.app }, ctx); } catch { /* re-checked below */ }
        const retried = await waitUntil(async () => !(await this.frontmostMismatch(opened.app)), { timeoutMs: 900, intervalMs: 40 });
        stillWrong = retried.settled ? '' : await this.frontmostMismatch(opened.app);
      }
      if (stillWrong) {
        frontmostWarning = `${opened.app} was activated but ${stillWrong} is still frontmost — its window may be hidden or blocked; screenshots and clicks may land on the wrong app until it is brought forward`;
        cliEvents.emit('status', frontmostWarning);
      }
      opened = await this.refreshTargetWindow(opened);
      this.targets.set(opened);
      // An app can be genuinely frontmost while exposing no usable document window — a system app
      // showing only its menu/desktop proxy, or any app whose last window was closed. Ask the app
      // for a new window once (Cmd+N) and reacquire. Probed, never keyed on an app name, so every
      // app with this shape gets the same recovery.
      if (process.platform === 'darwin' && !await this.hasUsableTargetWindow(opened)) {
        const newWindow = await this.fallback.run({ action: 'key', combo: 'cmd+n', app: opened.app }, ctx);
        if (newWindow.ok) {
          // Wait for the new window to actually exist rather than assuming 350 ms was enough.
          const created = await waitFor(
            async () => {
              const candidate = await this.refreshTargetWindow({ ...opened, windowId: undefined });
              return candidate.windowId ? candidate : null;
            },
            { timeoutMs: 1200, intervalMs: 80 },
          );
          opened = created.value ?? await this.refreshTargetWindow({ ...opened, windowId: undefined });
          this.targets.set(opened);
        }
      }
      transaction.confirmFrontmost(frontmostWarning);
    } else {
      // Background delivery never fronts anything, so there is nothing to confirm — but the phases
      // must still be walked in order so the trace of a background switch is comparable.
      transaction.activate('background delivery — no activation performed');
      transaction.confirmFrontmost();
      if (!opened.windowId) {
        opened = await this.refreshTargetWindow(opened);
        this.targets.set(opened);
      }
    }
    transaction.confirmWindow(opened.windowId);
    let evidence = opened.windowId
      ? await this.postActionEvidence(opened, cwd, session)
      : { visualEvidenceError: 'target application has no capturable window yet' };
    // App running with its main window CLOSED: the first frame is a blank placeholder with no window
    // controls (degraded), which the model reads as "not the right window, can't proceed". Fire the
    // native reopen event once and re-capture; if it is still unusable, WARN plainly instead of
    // claiming a clean activation.
    if (delivery === 'foreground' && !evidence.visualEvidenceError && evidence.degraded === true) {
      const reopened = await this.reopenClosedMainWindow(opened, cwd, session, ctx);
      opened = reopened.target;
      this.targets.set(opened);
      if (!reopened.stillClosed && !reopened.evidence.visualEvidenceError) {
        evidence = reopened.evidence;
      } else {
        if (reopened.evidence.screenshot) evidence = reopened.evidence;
        // Never overwrite a focus warning with this one. When the app never came forward AND the
        // frame is empty, the focus failure is the likely CAUSE of the empty frame, and it names the
        // app actually holding the screen — drop that and the report blames a closed window for what
        // is really another app sitting in front.
        const closedWindowWarning = `${opened.app} is running but its main window appears closed — the captured frame has no window content. Reopen the window (click its Dock icon, or use the app's "Open main window" menu), then observe again.`;
        frontmostWarning = frontmostWarning
          ? `${frontmostWarning}; additionally, ${closedWindowWarning}`
          : closedWindowWarning;
        cliEvents.emit('status', frontmostWarning);
      }
    }
    if (evidence.visualEvidenceError) {
      transaction.abort(evidence.visualEvidenceError);
      throw new Error(evidence.visualEvidenceError);
    }
    // postActionEvidence may have re-acquired a better window — read the owned truth back.
    opened = this.targets.current() ?? opened;
    // The agent owns input on this surface only when it is genuinely frontmost in visible mode.
    // syncSurface also re-points PiP capture at the new target, so this IS the capture switch.
    this.syncSurface({ focusOwner: (delivery === 'foreground' && !frontmostWarning) ? 'agent' : 'none' });
    transaction.switchCapture(`PiP retargeted to ${opened.app} window ${opened.windowId ?? '(none)'}`);
    // A frame of the new target now exists (postActionEvidence minted it), so input may resume.
    transaction.acquireFrame(evidence.frameId);
    transaction.commit();
    this.lastSwitch = transaction;
    if (transaction.isRealSwitch) this.switchLatency.record(transaction.elapsedMs);
    return { target: opened, evidence, frontmostWarning, switchMs: transaction.elapsedMs };
  }

  /**
   * Deliver a Space / Mission-Control shortcut and then re-establish what the agent is looking at.
   *
   * The naive path — post the combo, screenshot the target window — is what made these shortcuts
   * unusable: after the switch the previously active window is on a Space that is no longer on
   * screen, its capture comes back empty, and the empty frame is indistinguishable from a crashed
   * app. So instead: deliver, let the animation finish, ask the OS what is actually in front now,
   * and re-target only if that app is one this session already knows. Anything else drops activation
   * (registrations survive) so the next input has to go through an explicit focus with a fresh frame.
   */
  private async runSpaceCombo(
    cmd: DesktopCommand, target: ComputerTarget, kind: 'switch' | 'overview',
    cwd: string, session: string, driver: string, ctx?: { cwd?: string; signal?: AbortSignal },
  ): Promise<DesktopResult> {
    // Start from the target's own Space, so "next Space" means next relative to what the agent was
    // working on rather than relative to whatever the user last touched.
    await this.ensurePhysicalTargetFrontmost(target);
    const delivered = await this.fallback.run({ action: 'key', combo: cmd.combo, app: target.app }, ctx);
    if (!delivered.ok) throw new Error(delivered.error || delivered.summary);
    // The Space transition is animated; capturing mid-flight catches a half-slid screen.
    await new Promise(resolve => setTimeout(resolve, 900));
    // A new Space is an entirely fresh visual context — never judge progress against the old one.
    this.prevFrameHash = undefined;
    this.noChangeStreak = 0;
    this.recovery.reset();

    if (kind === 'overview') {
      // Mission Control / App Exposé overlay every window. No single app window is a meaningful
      // capture target until the overlay is dismissed, so do not pretend to still own one.
      this.targets.deactivate();
      this.syncLivePip();
      return {
        ok: true, action: cmd.action, driver, app: target.app, pid: target.pid,
        actionResult: { delivered: true, observed: 'changed', confidence: 'likely' },
        summary: `pressed ${cmd.combo} — the window overview is now covering the screen. No app window can be captured while it is open: press escape to dismiss it, then focus the app you want.`,
      };
    }

    const frontmost = await this.frontmostApp().catch(() => '');
    const known = frontmost ? this.targets.find(frontmost) : null;
    if (known) {
      this.targets.activate(known.pid);
      const reacquired = await this.refreshTargetWindow(known);
      this.targets.set(reacquired);
      const evidence = await this.postActionEvidence(reacquired, cwd, session);
      this.syncSurface({ focusOwner: 'agent' });
      const samePlace = reacquired.pid === target.pid;
      return {
        ok: true, action: cmd.action, driver, app: reacquired.app, pid: reacquired.pid,
        windowId: reacquired.windowId, ...evidence,
        actionResult: {
          delivered: true, observed: samePlace ? 'no-change' : 'changed',
          postcondition: { query: 'a different Space is now showing', matched: !samePlace },
          confidence: samePlace ? 'unknown' : 'proven',
        },
        summary: samePlace
          ? `pressed ${cmd.combo} but ${reacquired.app} is still frontmost — there may be no further Space in that direction (only fullscreen apps and additional desktops are switchable)`
          : `pressed ${cmd.combo} — now on the Space showing ${reacquired.app}; it is already open in this session and is now the active target; fresh screen attached`,
      };
    }
    // Landed somewhere this session does not manage. Keep every registration, but stop claiming an
    // active target: the old window is on a hidden Space and would capture empty.
    this.targets.deactivate();
    this.syncLivePip();
    const registered = this.targets.all().map(t => t.app).filter(Boolean);
    return {
      ok: true, action: cmd.action, driver,
      actionResult: { delivered: true, observed: 'changed', postcondition: { query: 'a different Space is now showing', matched: true }, confidence: 'proven' },
      summary: `pressed ${cmd.combo} — now on a Space showing ${frontmost || 'an app this session has not opened'}. `
        + `No app is the active target any more, because ${target.app} is on a Space that is no longer visible and would capture empty. `
        + (registered.length ? `Use action=focus for one of: ${registered.join(', ')}, or ` : 'Use ')
        + `action=open for ${frontmost || 'the app you want'} to control what is on screen now.`,
    };
  }

  /**
   * Drag from the active window into ANOTHER application's window.
   *
   * Two things make this different from an ordinary drag, and both were why cross-app drops
   * silently failed:
   *
   *  1. Coordinate space. The source point is a pixel in the source window's screenshot; the
   *     destination is a pixel in a DIFFERENT window's screenshot. Each has to be mapped through its
   *     own live window frame into global screen points before either is usable.
   *  2. Physical timing. A drop is only accepted after the receiving app has processed
   *     dragging-entered; the intra-window drag path completes far faster than a background app is
   *     typically scheduled, so the button came back up before the destination knew a drag existed.
   *
   * Both windows must be simultaneously visible, which is what `arrange` is for. If the source
   * window covers the drop point this refuses rather than dropping onto the source itself.
   */
  private async runCrossAppDrag(
    cmd: DesktopCommand, source: ComputerTarget, cwd: string, session: string, driver: string,
    ctx?: { cwd?: string; signal?: AbortSignal },
  ): Promise<DesktopResult> {
    const wantedApp = cmd.toApp!.trim();
    const destination = this.targets.find(wantedApp);
    if (!destination) {
      const known = this.targets.all().map(t => t.app).filter(Boolean);
      throw new Error(`drag destination "${wantedApp}" is not open in this session${known.length ? ` (open: ${known.join(', ')})` : ''} — open it first, and make sure both windows are visible at once (arrange one left and the other right)`);
    }
    if (destination.pid === source.pid) {
      throw new Error(`drag toApp "${wantedApp}" is the app already being dragged from — omit toApp for a drag inside one window`);
    }
    // The source must be frontmost to originate the press, and its frame is needed to map the
    // source pixel. Both come from the normal single-window path.
    if (!this.observedTarget || this.observedTarget.pid !== source.pid) {
      throw new Error('drag needs a fresh image of the source window — observe it first');
    }
    const sw = this.observedTarget.width, sh = this.observedTarget.height;
    if (!sw || !sh) throw new Error('latest screenshot has no usable dimensions');
    const hasSourceHandle = !!(cmd.query?.trim() || cmd.elementToken || cmd.elementIndex != null);
    if (!hasSourceHandle && (cmd.x == null || cmd.y == null)) {
      throw new Error('drag needs a source: query/elementToken/elementIndex from the newest observation, or x+y screenshot pixels');
    }
    const sourcePixel = hasSourceHandle
      ? (() => {
        const resolved = cmd.query?.trim()
          ? this.resolveObservedElement(cmd.query, source)
          : this.resolveObservedHandle(source, cmd);
        const point = this.elementCenterInScreenshot(resolved.frame);
        if (!point) throw new Error('drag source element has no visible screenshot rectangle; observe again');
        return point;
      })()
      : {
        x: cmd.normalized ? scaleNormalizedPoint(cmd.x!, sw - 1) : Math.round(cmd.x!),
        y: cmd.normalized ? scaleNormalizedPoint(cmd.y!, sh - 1) : Math.round(cmd.y!),
      };

    await this.ensurePhysicalTargetFrontmost(source);
    const sourceFrame = await this.liveWindowFrame(source);
    const globalFrom = this.screenshotPixelToGlobalPoint(sourcePixel, sourceFrame);
    if (!globalFrom) throw new Error('could not map the drag source into screen coordinates — re-observe the source window');

    // The destination window's own live frame is the only correct basis for its point; the source
    // window's screenshot says nothing about where the destination is on screen.
    const destFrame = await this.liveWindowFrame(destination);
    if (!destFrame || !destFrame.w || !destFrame.h) {
      throw new Error(`could not locate ${destination.app}'s window on screen — it may be minimized or on another Space; bring it into view (action=focus, then arrange) so both windows are visible at once`);
    }
    // Default to the destination window's centre: for a drop target that fills its window (a chat
    // transcript, a document body, a folder view) the centre is the sane landing point.
    const globalTo = {
      x: Math.round(cmd.toX != null ? destFrame.x + (cmd.normalized ? scaleNormalizedPoint(cmd.toX, destFrame.w - 1) : cmd.toX) : destFrame.x + destFrame.w / 2),
      y: Math.round(cmd.toY != null ? destFrame.y + (cmd.normalized ? scaleNormalizedPoint(cmd.toY, destFrame.h - 1) : cmd.toY) : destFrame.y + destFrame.h / 2),
    };
    if (!pointInFrame(globalTo, destFrame)) {
      throw new Error(`the drop point falls outside ${destination.app}'s window (${destFrame.w}x${destFrame.h}) — pass toX/toY inside it, or omit them to drop on its centre`);
    }
    // The source is frontmost, so wherever it overlaps the drop point it will receive the drop
    // instead of the destination. Refuse rather than dropping the file back into the app it came
    // from, and name the fix.
    if (sourceFrame && pointInFrame(globalTo, sourceFrame)) {
      throw new Error(`${source.app}'s window is covering the drop point in ${destination.app}, so the drop would land back on ${source.app}. Put them side by side first: focus ${source.app} → arrange layout=left, focus ${destination.app} → arrange layout=right.`);
    }

    const machine = new DragMachine(globalFrom, globalTo);
    machine.locateSource();
    const sourceInside = !sourceFrame || pointInFrame(globalFrom, sourceFrame);
    machine.verifySource(sourceInside, sourceInside ? 'source is inside the source window' : 'source point is outside the source window');
    if (!sourceInside) {
      return {
        ok: false, action: cmd.action, driver, app: source.app, pid: source.pid, windowId: source.windowId,
        details: { dragTrace: machine.trace },
        error: 'drag source is outside the source window — re-observe and pick a point that is on it',
        summary: `cross-app drag refused: source is outside ${source.app || `pid ${source.pid}`}`,
      };
    }
    machine.mouseDown().startDrag().moveThrough([globalTo]).locateDestination();
    machine.verifyDestination(true, `destination is inside ${destination.app}'s window (cross-application drop)`);
    const delivered = await this.fallback.run({
      action: 'drag', x: globalFrom.x, y: globalFrom.y, toX: globalTo.x, toY: globalTo.y,
      app: source.app, normalized: false,
      // Paced delivery: without this the button is released before the destination app has been
      // scheduled to process the drag at all.
      ms: CROSS_APP_DRAG_DWELL_MS,
    }, ctx);
    if (!delivered.ok) {
      machine.cancel('native drag failed');
      if (machine.releaseOwed) {
        try { await this.fallback.run({ action: 'mouse_up', x: globalTo.x, y: globalTo.y, app: source.app, normalized: false }, ctx); }
        catch { /* best-effort release so a failed drag never leaves the button stuck */ }
      }
      throw new Error(delivered.error || delivered.summary);
    }
    machine.mouseUp('native drag completed');
    // The RESULT of the drop is in the destination app, so that is the window worth capturing —
    // photographing the source would show the app the file left, which proves nothing.
    this.targets.activate(destination.pid);
    const reacquired = await this.refreshTargetWindow(destination);
    this.targets.set(reacquired);
    this.prevFrameHash = undefined;
    const evidence = await this.postActionEvidence(reacquired, cwd, session);
    machine.verifyResult(true, `fresh post-drop screen captured from ${destination.app}`);
    this.syncSurface();
    return {
      ok: true, action: cmd.action, driver, app: reacquired.app, pid: reacquired.pid, windowId: reacquired.windowId,
      details: { path: 'cross-app-global-cgevent', from: globalFrom, to: globalTo, sourceApp: source.app, destinationApp: reacquired.app, dragTrace: machine.trace },
      ...evidence,
      // Delivery is not acceptance: an app can refuse a drop type without any error. The caller has
      // to confirm the content arrived from the attached frame.
      actionResult: {
        delivered: true, observed: evidence.progressCheck?.outcome || 'changed',
        postcondition: { query: `content dropped into ${reacquired.app}`, matched: false },
        confidence: 'unknown',
      },
      summary: `dragged from ${source.app || `pid ${source.pid}`} into ${reacquired.app} at (${globalTo.x},${globalTo.y}); ${reacquired.app} is now the active target. Confirm from the attached frame that it accepted the drop — apps silently ignore content types they do not handle.`,
    };
  }

  /** Ask the OS for an app's bundle id. Best-effort: undefined simply means "launch it by name". */
  private async resolveBundleId(app?: string): Promise<string | undefined> {
    if (!app?.trim() || process.platform !== 'darwin') return undefined;
    try {
      const found = await this.fallback.run({ action: 'bundle_id', app });
      return found.ok ? found.bundleId : undefined;
    } catch { return undefined; }
  }

  /** Is this app already running? Used to decide whether a second instance is even possible. */
  private async isAppRunning(app?: string, bundleId?: string): Promise<boolean> {
    if (process.platform !== 'darwin') return false;
    // Prefer the live process list — it is authoritative and needs no extra process spawn.
    try {
      const data = await this.call('list_apps');
      const apps = Array.isArray(data?.apps) ? data.apps : [];
      const wanted = app?.trim();
      if (wanted && apps.some((a: any) => appNamesMatch(String(a?.name || ''), wanted))) return true;
      if (bundleId && apps.some((a: any) => String(a?.bundle_id || '').toLocaleLowerCase() === bundleId.toLocaleLowerCase())) return true;
      if (apps.length) return false;
    } catch { /* fall through to the scripting check */ }
    try {
      const running = await this.fallback.run({ action: 'app_running', app });
      return running.ok && !!running.running;
    } catch { return false; }
  }

  /** Read the pasteboard through whichever driver tier is available. */
  private async readClipboard(ctx?: { cwd?: string; signal?: AbortSignal }): Promise<ClipboardSnapshot> {
    const read = await this.fallback.run({ action: 'clipboard_read' }, ctx);
    if (!read.ok || !read.clipboard) throw new Error(read.error || read.summary || 'could not read the clipboard');
    return read.clipboard;
  }

  /**
   * Does the newest observation contain this text anywhere? Used to verify a paste actually landed
   * in the target — the pasted content should now be readable in the app's accessibility tree.
   * Whitespace-insensitive and case-insensitive, because apps re-wrap and re-case what they display;
   * long content is checked by its leading slice, since a text view may truncate what it exposes.
   */
  private observedTextIncludes(text: string): boolean {
    const needle = text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (!needle) return false;
    const probe = needle.length > 120 ? needle.slice(0, 120) : needle;
    return this.observedElements.some(element => {
      for (const value of [element.label, element.value, element.description, element.contextLabel, element.originalLabel]) {
        if (typeof value !== 'string') continue;
        if (value.replace(/\s+/g, ' ').trim().toLocaleLowerCase().includes(probe)) return true;
      }
      return false;
    });
  }

  /** Resolve a human app name for a pid from the sidecar's app list. launch_app sometimes returns
   * an empty or bundle-id-looking name; without this the model and the user saw "opened ?". */
  private async resolveAppName(pid: number, fallback: string): Promise<string> {
    const looksLikeBundleId = (s: string) => /^[a-z0-9_-]+(\.[a-z0-9_-]+){1,}$/i.test(s);
    const clean = stripInvisibleMarks(fallback);
    if (clean && clean !== '?' && !looksLikeBundleId(clean)) return clean;
    try {
      const data = await this.call('list_apps');
      const apps = Array.isArray(data?.apps) ? data.apps : [];
      const name = stripInvisibleMarks(String(apps.find((a: any) => Number(a?.pid) === pid)?.name || ''));
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
    // Ask the cheapest authority that can actually answer.
    //
    // This used to go straight to the sidecar's `list_apps`, which enumerates every running
    // application in order to read one name. Measured on this machine: 642ms median, versus 4ms for
    // the native helper's NSWorkspace read — 160× cheaper, and the two agree. It matters because
    // this is the activation-confirmation probe, called on every target switch and polled while
    // waiting: at 642ms per probe the "poll every 40ms" loop managed a single sample inside its
    // 900ms budget, so the switch paid ~750ms to learn something it could have had in 4ms AND the
    // poll could not actually track the app coming forward.
    // Only take the fast path when the helper is ALREADY built. `quickStatus` never compiles, so
    // this cannot turn a 4ms read into a first-use swiftc build on the critical path — which is
    // exactly what it did when the preference was unconditional.
    if (this.fallback.quickStatus().driver === 'native-helper') {
      try {
        const native = await this.fallback.frontmostApp();
        if (native) return native;
      } catch { /* the helper may have gone away — the sidecar can still answer */ }
    }
    if (!this.transport.available()) return this.fallback.frontmostApp();
    try {
      const data = await this.call('list_apps');
      const active = (Array.isArray(data?.apps) ? data.apps : []).find((app: any) => app.active);
      return String(active?.name || '');
    } catch {
      return '';
    }
  }

  public async run(cmd: DesktopCommand, ctx?: { cwd?: string; signal?: AbortSignal }): Promise<DesktopResult> {
    // Defense in depth: the tool layer already normalizes before gating, but /computer and other
    // direct callers reach the runtime without passing through it.
    cmd = { ...cmd, action: normalizeDesktopAction(cmd.action) as DesktopCommand['action'] };
    // Serialize acting verbs through the ONE input executor. Two overlapping actions share one
    // physical mouse, so concurrency here does not mean parallelism — it means a mouse-up from one
    // gesture landing inside another. Observation verbs stay concurrent: they move nothing.
    const result = ACTING_VERBS.has(cmd.action)
      ? await this.input.run(async () => stampSummaryVerdict(ensureActionResult(await this.runInner(cmd, ctx))))
      : stampSummaryVerdict(ensureActionResult(await this.runInner(cmd, ctx)));
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
    const driver = BIMAX_DRIVER_LABEL;
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
        // Frame identity (Phase 2). The gate above proves the newest capture is of the right WINDOW;
        // this proves it is the right PICTURE — the stale-frame-of-the-same-window case that pid and
        // windowId cannot see. Deliberately LAST of the refusal checks: the recovery and repeated-
        // failure latches carry more specific diagnoses, and a generic staleness message must not
        // mask them.
        //
        // Applied only when a frame was actually minted, or when the caller named one. A capture
        // with no usable mapping geometry (a degraded window capture) mints no frame, and those
        // paths are already vouched for by the observe-before-act gate above — refusing them here
        // would break working behaviour in the name of a check that has nothing to check against.
        if (needsFreshFrame && (this.frames.current() || cmd.frameId)) {
          const check = this.frames.check({ frameId: cmd.frameId, pid: target?.pid, windowId: target?.windowId });
          if (!check.ok) {
            return {
              ok: false, action: cmd.action, driver,
              error: `stale frame (${check.reason}): ${check.note}`,
              summary: `${cmd.action} refused: ${check.reason} — observe again before acting`,
            };
          }
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
          // Surface the session's measured switch latency alongside permissions: the p95 target for
          // target switching is only meaningful if the number is readable without a debugger.
          const switchStats = this.switchLatency.summary();
          return {
            ok: overall !== 'failed', action: cmd.action, driver, ...this.lastStatus,
            details: { ...(details as Record<string, unknown>), targetSwitchLatencyMs: switchStats },
            summary: `Bimax Computer Use ${overall}${switchStats.count ? ` · target switch p50 ${switchStats.p50}ms / p95 ${switchStats.p95}ms over ${switchStats.count}` : ''}`,
          };
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
          // The sidecar's name lookup can miss an app whose bundle id launches fine, so resolve the
          // bundle id from the OS when the caller gave only a name. Asking Launch Services covers
          // every app on the machine instead of a hand-maintained list of well-known aliases.
          const requestedBundleId = cmd.bundleId?.trim() || await this.resolveBundleId(requestedApp);
          // A second instance is only meaningful for an app the OS is willing to run twice. Rather
          // than carrying a list of macOS singletons, ask whether this app is ALREADY running: a
          // running system process cannot be duplicated, and requesting it fails confusingly.
          const alreadyRunning = cmd.newInstance
            ? await this.isAppRunning(requestedApp, requestedBundleId)
            : false;
          const data = await this.call('launch_app', {
            ...(requestedBundleId ? { bundle_id: requestedBundleId } : { name: requestedApp! }),
            ...(cmd.newInstance && !alreadyRunning ? { creates_new_application_instance: true } : {}),
          });
          const window = Array.isArray(data?.windows) ? data.windows[0] : undefined;
          let opened: ComputerTarget = {
            app: stripInvisibleMarks(String(data?.name || cmd.app || cmd.bundleId || '')),
            pid: Number(data?.pid || 0),
            windowId: Number(window?.window_id || 0) || undefined,
          };
          if (!opened.pid) throw new Error(`opened ${opened.app || 'application'} but received no target pid`);
          // Never surface a bundle id or an empty "?" as the app name — resolve the human name.
          opened.app = await this.resolveAppName(opened.pid, opened.app);
          // Remember who was active BEFORE ownership moves, so the switch transaction below knows
          // what it is switching FROM (and can tell a real switch from a re-open of the same app).
          const previousTarget = this.targets.current();
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
          const activated = await this.activateAndCapture(opened, cwd, session, delivery, ctx, previousTarget);
          opened = activated.target;
          const frontmostWarning = activated.frontmostWarning;
          return {
            ok: true, action: cmd.action, driver, app: opened.app, pid: opened.pid,
            windowId: opened.windowId, details: data, ...activated.evidence, frontmostWarning,
            summary: `opened ${opened.app} as pid ${opened.pid}${opened.windowId ? ` window ${opened.windowId}` : ''}${frontmostWarning ? `; WARNING: ${frontmostWarning}` : '; fresh screen attached'}`,
          };
        }
        case 'focus': {
          // Switch to an app this session ALREADY has open, without re-launching it. Re-launching a
          // running app risks a second instance and discards whatever state the app is in — which is
          // exactly what every cross-app workflow (copy here, paste there; pick a file here, drop it
          // there) needs to preserve. focus returns a fresh frame, so input is legal immediately
          // afterwards under the same "act only on the newest frame of the exact target" rule.
          const wanted = cmd.app?.trim();
          const byPid = Number(cmd.pid || 0);
          const registered = byPid
            ? this.targets.all().find(t => t.pid === byPid) || null
            : wanted ? this.targets.find(wanted) : this.targets.current();
          if (!registered) {
            const known = this.targets.all().map(t => t.app).filter(Boolean);
            throw new Error(wanted || byPid
              ? `${wanted || `pid ${byPid}`} is not open in this session${known.length ? ` (open: ${known.join(', ')})` : ''} — use action=open to launch it`
              : 'focus needs app or pid');
          }
          // Capture the predecessor before activation moves ownership, so the switch transaction
          // measures a real app-to-app switch rather than reading the destination as its own origin.
          const previousTarget = this.targets.current();
          this.targets.activate(registered.pid);
          // A different app is a different visual context: the no-progress baseline must not compare
          // this app's first frame against the one we just switched away from.
          this.prevFrameHash = undefined;
          this.noChangeStreak = 0;
          this.recovery.reset();
          const switched = await this.activateAndCapture(registered, cwd, session, delivery, ctx, previousTarget);
          return {
            ok: true, action: cmd.action, driver, app: switched.target.app, pid: switched.target.pid,
            windowId: switched.target.windowId, ...switched.evidence, frontmostWarning: switched.frontmostWarning,
            summary: `focused ${switched.target.app} as pid ${switched.target.pid}${switched.target.windowId ? ` window ${switched.target.windowId}` : ''}${switched.frontmostWarning ? `; WARNING: ${switched.frontmostWarning}` : '; fresh screen attached'}`,
          };
        }
        case 'observe':
        case 'screenshot': {
          // Ownership is cleared at every user-turn boundary (dispose), but the APP stays open and
          // the conversation carries straight on ("the chat is open, now send it"). Turn 2 then hit
          // a dead end: observe refused for want of a target, every acting verb refused for want of
          // a fresh frame, and the model never called `open` because — correctly — the app was
          // already open. Re-acquire the remembered window here instead. This restores identity
          // only: no input can ride on it, because acting verbs still demand a fresh frame that
          // only this observation can produce, and the governor still gates them individually.
          let capture = target ?? await this.reacquireLastTarget();
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
            // Name the app and the ONE verb that fixes this. The bare "open or select an application
            // window first" read as advice rather than an instruction, and the model answered it by
            // retrying observe and click in a loop until the turn was interrupted.
            const stale = this.lastOwnedTarget?.app;
            throw new Error(stale
              ? `no window is currently owned — ${stale} is no longer open at the window Bimax was driving. Call action=open with app="${stale}" to establish a target, then observe.`
              : 'no application window is owned yet; call action=open with the app you want to control before observe or any input');
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
            // Resolve what the guessed pixel ACTUALLY lands on: a slider is redirected to set_value;
            // any other control gets NAMED in the summary (so a near-miss onto the wrong icon is
            // visible, not an anonymous "click delivered"), and a compact control is re-centered so
            // an edge-graze can't deliver-but-activate-nothing — the exact WhatsApp send-miss.
            const landed = this.actionableElementAtScreenshotPoint({ x, y });
            if (landed?.element.role === 'AXSlider') {
              throw new Error(`screenshot point ${x},${y} is inside "${landed.element.label || 'Slider'}"; use set_value with its fresh semantic handle so the requested value is exact`);
            }
            if (landed) {
              resolvedLabel = landed.element.label || landed.element.value || '';
              if (SNAP_TO_CENTER_AX_ROLES.has(String(landed.element.role || ''))) {
                const center = frameCenter(landed.screenshotFrame);
                if (pixelInImage(center, { width, height })) {
                  args.x = center.x; args.y = center.y;
                  coordinateSource = `${coordinateSource}, centered in "${resolvedLabel || landed.element.role}"`;
                }
              }
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
          // Space/Mission-Control shortcuts change which windows exist on screen, so they cannot go
          // down the ordinary "press it, then screenshot the target window" path — that window may
          // no longer be visible to capture.
          const spaceCombo = process.platform === 'darwin' ? classifySpaceCombo(cmd.combo || '') : null;
          if (spaceCombo) return await this.runSpaceCombo(cmd, target, spaceCombo, cwd, session, driver, ctx);
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
        case 'desktop': {
          // The desktop is deliberately NOT modelled as an app window. It has no title bar, no close
          // button and no window id the driver will hand out, so every window-scoped code path either
          // skips it or substitutes the file manager's menu-bar proxy. Its items are plain
          // accessibility elements with global frames, so they are enumerated natively and addressed
          // in the same global screen points every pointer command already speaks.
          const listed = await this.fallback.run({ action: 'desktop_icons' }, ctx);
          if (!listed.ok) throw new Error(listed.error || listed.summary);
          const icons = listed.icons || [];
          this.desktopIcons = icons;
          if (!cmd.query?.trim()) {
            return {
              ok: true, action: cmd.action, driver, icons,
              summary: icons.length
                ? `${icons.length} item(s) on the desktop: ${icons.map(i => i.name).filter(Boolean).join(', ')}. Move one with action=desktop query="<name>" and either toQuery="<folder name>" to file it, or toX/toY screen points to reposition it.`
                : 'the desktop has no items on it',
            };
          }
          const from = resolveDesktopIcon(icons, cmd.query);
          const centre = (r: ScreenRect) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
          const globalFrom = centre(from.frame);
          let globalTo: { x: number; y: number };
          let intent: string;
          if (cmd.toQuery?.trim()) {
            const into = resolveDesktopIcon(icons, cmd.toQuery);
            if (into.name === from.name) throw new Error(`"${from.name}" cannot be dropped onto itself`);
            globalTo = centre(into.frame);
            intent = `onto "${into.name}"`;
          } else if (cmd.toX != null && cmd.toY != null) {
            globalTo = { x: Math.round(cmd.toX), y: Math.round(cmd.toY) };
            intent = `to (${globalTo.x},${globalTo.y})`;
          } else {
            throw new Error('moving a desktop item needs a destination: toQuery="<name of a folder on the desktop>" to file it into that folder, or toX/toY screen points to reposition it');
          }
          const delivered = await this.fallback.run({
            action: 'drag', x: globalFrom.x, y: globalFrom.y, toX: globalTo.x, toY: globalTo.y,
            normalized: false, ms: CROSS_APP_DRAG_DWELL_MS,
          }, ctx);
          if (!delivered.ok) throw new Error(delivered.error || delivered.summary);
          // Re-enumerate and compare: the item's rectangle is the honest postcondition. A drop into a
          // folder removes it from the desktop entirely; a reposition moves its frame. Either way the
          // OS is the witness, not the fact that a drag was delivered.
          await new Promise(resolve => setTimeout(resolve, 450));
          const after = await this.fallback.run({ action: 'desktop_icons' }, ctx);
          const nowIcons = after.ok ? (after.icons || []) : icons;
          this.desktopIcons = nowIcons;
          const stillThere = nowIcons.find(i => i.name === from.name);
          const filedAway = !stillThere;
          const moved = !!stillThere && (stillThere.frame.x !== from.frame.x || stillThere.frame.y !== from.frame.y);
          const landed = filedAway || moved;
          return {
            ok: landed, action: cmd.action, driver, icons: nowIcons,
            details: { from: globalFrom, to: globalTo, item: from.name },
            actionResult: {
              delivered: true, observed: landed ? 'confirmed' : 'no-change',
              postcondition: { query: `"${from.name}" moved ${intent}`, matched: landed },
              confidence: 'proven',
              ...(landed ? {} : { failureReason: 'the item is still in its original position' }),
            },
            ...(landed ? {} : {
              error: `"${from.name}" did not move — the desktop may be using an automatic arrangement (sort/stacks), which snaps every item back to a computed position. Turn off Use Stacks / Sort By on the desktop before rearranging items by hand.`,
            }),
            summary: landed
              ? filedAway
                ? `moved "${from.name}" ${intent}; it is no longer on the desktop`
                : `moved "${from.name}" ${intent}; it is now at (${stillThere!.frame.x},${stillThere!.frame.y})`
              : `"${from.name}" was dragged ${intent} but is still at (${from.frame.x},${from.frame.y})`,
          };
        }
        case 'arrange': {
          // Window management through the accessibility API rather than by dragging a title bar to
          // a screen edge or hunting through the green button's hover menu: it is one call, it is
          // exact, and it behaves identically for every app because it never touches app UI.
          if (!target) throw new Error('arrange needs an active app — open or focus one first');
          const layout = cmd.layout;
          if (!layout && !cmd.bounds) throw new Error('arrange needs layout (left/right/top/bottom, quadrants, thirds, restore, maximize/center/fullscreen/unfullscreen) or explicit bounds');
          // Fullscreen only engages for the frontmost app: macOS silently refuses the attribute for
          // a background window, which read as "this app cannot go fullscreen".
          await this.ensurePhysicalTargetFrontmost(target);

          if (layout === 'fullscreen' || layout === 'unfullscreen') {
            const want = layout === 'fullscreen';
            const toggled = await this.fallback.run({ action: 'window_fullscreen', pid: target.pid, value: want ? 'true' : 'false' }, ctx);
            if (!toggled.ok) throw new Error(toggled.error || toggled.summary);
            const evidence = await this.postActionEvidence(target, cwd, session);
            const settled = !!toggled.fullscreenMatched;
            if (!settled) {
              return {
                ok: false, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
                fullscreen: toggled.fullscreen, fullscreenSupported: toggled.fullscreenSupported, ...evidence,
                actionResult: { delivered: true, observed: 'no-change', postcondition: { query: `window ${want ? 'entered' : 'left'} fullscreen`, matched: false }, confidence: 'proven', failureReason: 'the window did not change fullscreen state' },
                error: toggled.fullscreenSupported === false
                  ? `${target.app || `pid ${target.pid}`} has no window that supports fullscreen (panels, utility and inspector windows cannot go fullscreen) — use layout=maximize to fill the screen instead`
                  : `${target.app || `pid ${target.pid}`} did not ${want ? 'enter' : 'leave'} fullscreen. It must be the frontmost app for macOS to accept the change; bring it forward (action=focus) and try again.`,
                summary: `fullscreen ${want ? 'on' : 'off'} was refused by ${target.app || `pid ${target.pid}`}`,
              };
            }
            return {
              ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
              fullscreen: toggled.fullscreen, fullscreenSupported: toggled.fullscreenSupported, ...evidence,
              actionResult: { delivered: true, observed: 'confirmed', postcondition: { query: `window ${want ? 'entered' : 'left'} fullscreen`, matched: true }, confidence: 'proven' },
              summary: `${target.app || `pid ${target.pid}`} is now ${want ? 'fullscreen' : 'windowed'}; fresh screen attached`,
            };
          }

          // Resolve the target rectangle against the screen this window is actually on, so a layout
          // on a second display tiles within THAT display rather than jumping to the main one.
          // Remember where the window was BEFORE we move it, so a later arrange can put it back.
          // Read once and reuse below — window_frame is a helper round-trip, not free.
          const before = await this.fallback.run({ action: 'window_frame', pid: target.pid }, ctx);
          const priorFrame = before.ok ? before.windowFrame : undefined;

          let want = cmd.bounds;
          if (!want && layout === 'restore') {
            const saved = this.priorWindowBounds.get(target.pid);
            if (!saved) throw new Error('nothing to restore — this window has not been arranged in this session, so there is no previous rectangle to put it back to');
            want = saved;
          }
          if (!want) {
            const screensResult = await this.fallback.run({ action: 'screens' }, ctx);
            const screens = screensResult.ok && screensResult.screens?.length ? screensResult.screens : [];
            const mainScreen = screens.find(s => s.main) || screens[0];
            if (mainScreen?.scale) this.mainDisplayScale = mainScreen.scale;
            if (!screens.length) throw new Error('could not read screen geometry, so a named layout cannot be resolved — pass explicit bounds instead');
            // An explicit display index MOVES the window to that screen; without one it tiles within
            // whichever screen the window already sits on, so a layout on a second display does not
            // yank the window back to the main one.
            const screen = cmd.display
              ? screens.find(s => s.index === Number(cmd.display))
              : screenForRect(priorFrame, screens);
            if (!screen) {
              throw new Error(cmd.display
                ? `display ${cmd.display} does not exist — this Mac reports ${screens.length} screen(s) (indexes ${screens.map(s => s.index).join(', ')})`
                : 'could not determine which screen this window is on');
            }
            want = layoutRect(layout!, screen.visible);
          }
          if (priorFrame) this.priorWindowBounds.set(target.pid, priorFrame);
          const placed = await this.fallback.run({ action: 'window_set_frame', pid: target.pid, bounds: want }, ctx);
          if (!placed.ok) throw new Error(placed.error || placed.summary);
          const got = placed.windowFrame;
          const exact = frameMatches(want, got);
          const evidence = await this.postActionEvidence(target, cwd, session);
          return {
            ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
            windowFrame: got, requestedFrame: want, ...evidence,
            actionResult: {
              delivered: true, observed: exact ? 'confirmed' : 'changed',
              postcondition: { query: `window placed at ${want.w}x${want.h}+${want.x}+${want.y}`, matched: exact },
              confidence: exact ? 'proven' : 'likely',
            },
            // An app that enforces a minimum size gets the position it was asked for but not the
            // size. Saying so is the difference between "tiled" and "tiled, and still overlapping
            // the other half" — which the caller can only account for if it is told.
            summary: exact
              ? `${target.app || `pid ${target.pid}`} placed at ${got!.w}x${got!.h} (${got!.x},${got!.y})${layout ? ` [${layout}]` : ''}; fresh screen attached`
              : `${target.app || `pid ${target.pid}`} moved, but the app adjusted the size: asked ${want.w}x${want.h} at (${want.x},${want.y}), got ${got?.w}x${got?.h} at (${got?.x},${got?.y}) — the app enforces its own minimum size or size increments`,
          };
        }
        case 'clipboard': {
          // Explicit pasteboard access. `paths` puts FILES on it (so an app can receive them by
          // paste), `value` puts text on it, neither reads it. Nothing here is app-specific: the
          // pasteboard is an OS service, so this is the same operation for every application.
          if (cmd.paths?.length) {
            const written = await this.fallback.run({ action: 'clipboard_write_files', paths: cmd.paths }, ctx);
            if (!written.ok) throw new Error(written.error || written.summary);
            return {
              ok: true, action: cmd.action, driver, clipboard: written.clipboard,
              actionResult: { delivered: true, observed: 'confirmed', postcondition: { query: `${cmd.paths.length} file(s) on the clipboard`, matched: true }, confidence: 'proven' },
              summary: `put ${cmd.paths.length} file(s) on the clipboard: ${cmd.paths.join(', ')}`,
            };
          }
          if (cmd.value != null) {
            const written = await this.fallback.run({ action: 'clipboard_write', text: cmd.value }, ctx);
            if (!written.ok) throw new Error(written.error || written.summary);
            return {
              ok: true, action: cmd.action, driver, clipboard: written.clipboard,
              actionResult: { delivered: true, observed: 'confirmed', postcondition: { query: 'text on the clipboard', matched: true }, confidence: 'proven' },
              summary: `wrote ${cmd.value.length} chars to the clipboard`,
            };
          }
          const clip = await this.readClipboard(ctx);
          return {
            ok: true, action: cmd.action, driver, clipboard: clip,
            summary: describeClipboard(clip),
          };
        }
        case 'copy': {
          // Copy is the classic "delivered but did nothing" action: with no selection, Cmd+C is
          // accepted by every app and changes nothing. NSPasteboard.changeCount is the OS's own
          // monotonic write counter, so comparing it across the keystroke proves whether anything
          // was actually placed — evidence, not delivery.
          if (!target) throw new Error('copy needs an active app — open or focus one first');
          const combo = process.platform === 'darwin' ? 'cmd+c' : 'ctrl+c';
          const before = await this.readClipboard(ctx).catch(() => null);
          await this.ensurePhysicalTargetFrontmost(target);
          await this.ensureCursorInTargetWindow(target, ctx);
          const delivered = await this.fallback.run({ action: 'key', combo, app: target.app }, ctx);
          if (!delivered.ok) throw new Error(delivered.error || delivered.summary);
          // Apps write the pasteboard asynchronously after the keystroke, so poll rather than
          // sampling once and declaring failure on a race.
          let after = before;
          let landed = false;
          for (const settleMs of [80, 120, 200, 300]) {
            await new Promise(resolve => setTimeout(resolve, settleMs));
            after = await this.readClipboard(ctx).catch(() => after);
            if (!before || !after) break;
            landed = clipboardAdvanced(before, after);
            if (landed) break;
          }
          const evidence = await this.postActionEvidence(target, cwd, session);
          if (before && after && !landed) {
            return {
              ok: false, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
              clipboard: after, ...evidence,
              actionResult: { delivered: true, observed: 'no-change', postcondition: { query: 'clipboard received new content', matched: false }, confidence: 'proven', failureReason: 'the clipboard did not change' },
              error: `${combo} reached ${target.app || `pid ${target.pid}`} but the clipboard did not change — nothing was selected, or this surface does not support copy. Select the content first (click into it, then drag or use select-all), then copy again.`,
              summary: `copy delivered to ${target.app || `pid ${target.pid}`} but nothing landed on the clipboard`,
            };
          }
          return {
            ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
            clipboard: after || undefined, ...evidence,
            ...(after ? { actionResult: { delivered: true, observed: 'confirmed' as const, postcondition: { query: 'clipboard received new content', matched: true }, confidence: 'proven' as const } } : {}),
            summary: after
              ? `copied from ${target.app || `pid ${target.pid}`} — ${describeClipboard(after)}`
              : `copy delivered to ${target.app || `pid ${target.pid}`} (this driver cannot read the clipboard back, so the content is unverified)`,
          };
        }
        case 'paste': {
          if (!target) throw new Error('paste needs an active app — open or focus one first');
          const clip = await this.readClipboard(ctx).catch(() => null);
          if (clip && !clip.text && !clip.files.length) {
            throw new Error('the clipboard is empty — copy something (action=copy) or put content on it (action=clipboard with value or paths) before pasting');
          }
          const combo = process.platform === 'darwin' ? 'cmd+v' : 'ctrl+v';
          await this.ensurePhysicalTargetFrontmost(target);
          await this.ensureCursorInTargetWindow(target, ctx);
          const delivered = await this.fallback.run({ action: 'key', combo, app: target.app }, ctx);
          if (!delivered.ok) throw new Error(delivered.error || delivered.summary);
          const evidence = await this.postActionEvidence(target, cwd, session);
          // A paste leaves the clipboard untouched, so it cannot self-verify the way copy does.
          // What it CAN do is check the fresh frame for the text that was pasted — a real semantic
          // postcondition rather than "the keystroke was accepted".
          if (clip?.text && evidence.progressCheck) {
            const seen = this.observedTextIncludes(clip.text);
            evidence.actionResult = toActionResult(evidence.progressCheck, {
              query: `pasted text visible in ${target.app || 'the target'}`, matched: seen,
            });
          }
          return {
            ok: true, action: cmd.action, driver, app: target.app, pid: target.pid, windowId: target.windowId,
            clipboard: clip || undefined, ...evidence,
            summary: `pasted into ${target.app || `pid ${target.pid}`}${clip ? ` — ${describeClipboard(clip)}` : ''}; fresh screen attached`,
          };
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
          // A destination in ANOTHER application cannot be expressed in the source window's
          // screenshot space — the two windows have different origins and the source's pixels stop
          // at its own edge. Resolve that case against the destination window's live frame instead.
          // `await` matters: returning the promise unawaited from inside run()'s try block means a
          // rejection escapes the error handler entirely and surfaces as an unhandled throw instead
          // of the {ok:false, error} contract every other refusal uses.
          if (cmd.toApp?.trim()) return await this.runCrossAppDrag(cmd, target, cwd, session, driver, ctx);
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
            // Forget only THIS app. A session can have several apps open at once (copy from one,
            // paste into another); closing one window must not erase the others' registrations and
            // force a re-launch. No other app is auto-activated: switching the input target without
            // being asked is exactly how coordinates end up delivered to the wrong window. The model
            // picks the next surface explicitly with focus, which returns a fresh frame.
            this.targets.forget(target.pid);
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
          // Drop only the quit app — other apps this session opened stay registered and focusable.
          this.targets.forget(target.pid);
          // A quit app must not linger as a re-acquirable identity: the next turn's observe would
          // chase a pid the OS may already have recycled onto an unrelated process.
          if (this.lastOwnedTarget?.pid === target.pid) this.lastOwnedTarget = null;
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
