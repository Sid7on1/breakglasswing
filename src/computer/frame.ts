/**
 * Frame identity for computer use — binding an action to the picture it was planned from.
 *
 * An agent plans a click by looking at a screenshot. Between that screenshot and the CGEvent, the
 * window can move, resize, change display, or be replaced by a different window of the same app.
 * The coordinate is then still *arithmetically* valid and lands somewhere real — just not on the
 * control the model chose. That is the single most dangerous failure mode in computer use, because
 * it is invisible: the driver reports success and the wrong thing gets clicked.
 *
 * Matching on pid + windowId (what the runtime did before) catches a target SWITCH but not a stale
 * frame of the SAME window, which is the common case. So every observation mints an immutable
 * {@link FrameMetadata} carrying a monotonic `frameId` plus the geometry the transform depends on,
 * and every acting verb is checked against it. OpenAI's window API does the same thing with
 * `screenshotId` on click/scroll/drag; this is that idea in BiMax's shape.
 *
 * The record is IMMUTABLE by construction (frozen). A transform that reads geometry off a frozen
 * frame cannot be silently re-pointed at a newer window rectangle half-way through an action — the
 * mismatch has to surface as a staleness verdict instead.
 */

import { Frame, ImageSize, Point } from './coordinates';

/** What a capture covered: one window, or a whole display. The coordinate space differs. */
export type CaptureKind = 'window' | 'display';

/**
 * Everything an action needs to know about the picture it was planned from. Frozen at mint time.
 *
 * `windowBounds` is in GLOBAL SCREEN POINTS (top-left origin) and `image` is in SCREENSHOT PIXELS;
 * the pair is what converts between the two spaces, which is why they must travel together and
 * never be re-read independently.
 */
export interface FrameMetadata {
  readonly frameId: string;
  /** Monotonic sequence — a larger value always means a later frame of this registry. */
  readonly seq: number;
  readonly capturedAt: number;
  readonly captureKind: CaptureKind;
  /** Owning process and window. `windowId` is absent for a display capture. */
  readonly pid: number;
  readonly windowId?: number;
  readonly app?: string;
  /** The captured region in global screen points — the mapping frame for this image. */
  readonly bounds: Frame;
  /** The captured image's dimensions in screenshot pixels. */
  readonly image: ImageSize;
  /** Display the capture came from, and its backing scale (Retina = 2). */
  readonly displayId?: number;
  readonly displayScale: number;
  /** Digest of the captured pixels, when one was computed. */
  readonly frameHash?: string;
}

export type StaleReason =
  | 'unknown-frame'      // the id names no frame this registry ever minted
  | 'superseded'         // a newer frame exists; this one no longer describes the screen
  | 'expired'            // older than the freshness budget
  | 'target-changed'     // a different app/window is now current
  | 'geometry-changed';  // the same window, but it moved or resized since the capture

export interface FrameCheck {
  ok: boolean;
  reason?: StaleReason;
  /** Human-readable, and actionable: every message names the verb that fixes it. */
  note?: string;
  frame?: FrameMetadata;
}

/** How far a window may move or resize before a frame planned against it is refused, in points. */
export const GEOMETRY_TOLERANCE_PT = 2;

/**
 * Default freshness budget. Deliberately generous: a model turn (think + tool round-trip) routinely
 * takes seconds, and expiring a frame the model is legitimately still reasoning about would refuse
 * correct actions. Movement and supersession are the precise signals; age is only the backstop for
 * a screen that changed without the window's rectangle changing.
 */
export const DEFAULT_FRAME_MAX_AGE_MS = 30_000;

export interface FrameMintSpec {
  captureKind: CaptureKind;
  pid: number;
  windowId?: number;
  app?: string;
  bounds: Frame;
  image: ImageSize;
  displayId?: number;
  displayScale?: number;
  frameHash?: string;
}

/**
 * Mints and validates frames. One instance per runtime — it holds the CURRENT frame, and a frame
 * that is not the current one is by definition superseded.
 *
 * Deliberately keeps only the newest frame rather than a history. Accepting an action against an
 * older frame is the exact hazard this exists to prevent, so there is nothing to look up: the only
 * question is whether the id the caller presents is the one that is current.
 */
export class FrameRegistry {
  private frame: FrameMetadata | null = null;
  private seq = 0;

  constructor(
    private readonly maxAgeMs: number = DEFAULT_FRAME_MAX_AGE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Record a fresh capture and make it current. Returns the immutable record. */
  mint(spec: FrameMintSpec): FrameMetadata {
    const seq = ++this.seq;
    const frame: FrameMetadata = Object.freeze({
      frameId: `f${seq}-${spec.pid}${spec.windowId ? `-${spec.windowId}` : ''}`,
      seq,
      capturedAt: this.now(),
      captureKind: spec.captureKind,
      pid: spec.pid,
      windowId: spec.windowId,
      app: spec.app,
      bounds: Object.freeze({ ...spec.bounds }),
      image: Object.freeze({ ...spec.image }),
      displayId: spec.displayId,
      displayScale: spec.displayScale ?? 1,
      frameHash: spec.frameHash,
    });
    this.frame = frame;
    return frame;
  }

  current(): FrameMetadata | null { return this.frame; }

  /** Drop the current frame — after a target switch, a window move, or a dispose. */
  invalidate(): void { this.frame = null; }

  /**
   * Is it safe to act against this frame right now?
   *
   * `frameId` is OPTIONAL by design. A model that does not echo it back still gets the current
   * frame validated (age, target, geometry) — the check degrades to what the runtime already knew
   * rather than refusing every action from a client that has not been taught the field yet. When
   * the id IS supplied, supersession becomes detectable, which is the whole point.
   */
  check(opts: {
    frameId?: string;
    pid?: number;
    windowId?: number;
    /** The window's CURRENT rectangle, when the caller has just read it. */
    liveBounds?: Frame;
  } = {}): FrameCheck {
    const frame = this.frame;
    if (!frame) {
      return { ok: false, reason: 'unknown-frame', note: 'no observation has been captured yet — call action=observe before acting' };
    }
    if (opts.frameId && opts.frameId !== frame.frameId) {
      return {
        ok: false,
        reason: 'superseded',
        frame,
        note: `frame ${opts.frameId} has been superseded by ${frame.frameId}; the coordinates were planned from a picture that no longer describes the screen — observe again and re-pick the target`,
      };
    }
    if (opts.pid != null && opts.pid !== frame.pid) {
      return {
        ok: false,
        reason: 'target-changed',
        frame,
        note: `the newest frame belongs to pid ${frame.pid}, not ${opts.pid} — observe the app you intend to act on first`,
      };
    }
    if (opts.windowId != null && frame.windowId != null && opts.windowId !== frame.windowId) {
      return {
        ok: false,
        reason: 'target-changed',
        frame,
        note: `the newest frame is of window ${frame.windowId}, not ${opts.windowId} — observe that window before acting on it`,
      };
    }
    const age = this.now() - frame.capturedAt;
    if (age > this.maxAgeMs) {
      return {
        ok: false,
        reason: 'expired',
        frame,
        note: `the newest frame is ${Math.round(age / 1000)}s old (budget ${Math.round(this.maxAgeMs / 1000)}s) — observe again so the action is planned from the current screen`,
      };
    }
    if (opts.liveBounds && !boundsMatch(frame.bounds, opts.liveBounds)) {
      return {
        ok: false,
        reason: 'geometry-changed',
        frame,
        note: `the window moved or resized since the frame was captured (was ${describe(frame.bounds)}, now ${describe(opts.liveBounds)}) — every coordinate from that frame is offset; observe again`,
      };
    }
    return { ok: true, frame };
  }
}

function describe(f: Frame): string { return `${Math.round(f.w)}×${Math.round(f.h)} at ${Math.round(f.x)},${Math.round(f.y)}`; }

/** Same rectangle within the movement tolerance? */
export function boundsMatch(a: Frame, b: Frame, tolerance = GEOMETRY_TOLERANCE_PT): boolean {
  return Math.abs(a.x - b.x) <= tolerance
    && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.w - b.w) <= tolerance
    && Math.abs(a.h - b.h) <= tolerance;
}

// ---- frame-anchored transforms ----------------------------------------------------------------
// These are the ONLY conversions that should be used once a frame exists, because they read their
// geometry from the frozen record rather than from whatever the runtime's mutable "current window
// frame" happens to be at the moment the arithmetic runs.
//
// Precision rule (from OpenAI's remapping guidance): carry full floating point through the chain
// and round ONCE, at the boundary where a native event actually needs an integer. Rounding at each
// hop accumulates up to half a pixel per conversion, which is what turns a correct centre into an
// off-by-one on a 12pt traffic-light button.

/** Screenshot pixel → global screen point, at full precision (no rounding). */
export function toGlobalPrecise(frame: FrameMetadata, p: Point): Point | null {
  const { image, bounds } = frame;
  if (!image.width || !image.height || !bounds.w || !bounds.h) return null;
  return {
    x: bounds.x + p.x * (bounds.w / image.width),
    y: bounds.y + p.y * (bounds.h / image.height),
  };
}

/** Global screen point → screenshot pixel, at full precision. Inverse of {@link toGlobalPrecise}. */
export function toScreenshotPrecise(frame: FrameMetadata, p: Point): Point | null {
  const { image, bounds } = frame;
  if (!image.width || !image.height || !bounds.w || !bounds.h) return null;
  return {
    x: (p.x - bounds.x) * (image.width / bounds.w),
    y: (p.y - bounds.y) * (image.height / bounds.h),
  };
}

/**
 * The final boundary: a global point becomes the integer a CGEvent is posted at. This is the ONLY
 * place rounding is allowed in the chain, and every native-input call site must go through it.
 */
export function toNativeEventPoint(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Global screen point → physical backing pixel for this frame's display, at full precision. */
export function toPhysicalPrecise(frame: FrameMetadata, p: Point): Point {
  const s = frame.displayScale || 1;
  return { x: p.x * s, y: p.y * s };
}

/** Is a screenshot pixel inside the frame's image? */
export function inFrameImage(frame: FrameMetadata, p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= 0 && p.y >= 0 && p.x < frame.image.width && p.y < frame.image.height;
}
