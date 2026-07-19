/**
 * Coordinate transformation layer for computer use.
 *
 * A single computer-use action crosses several coordinate spaces, and mixing them is THE classic
 * source of "the click landed 40px off" bugs (Retina doubling, window offsets, normalized VLM
 * output). This module is the ONE audited, round-trip-tested place those conversions live, instead
 * of the same arithmetic being copied inline at every call site in the runtime.
 *
 * Spaces (all origins top-left):
 *  - normalized      — 0–1000 per axis, the resolution-independent space some VLMs emit (Gemini).
 *  - screenshotPixel — a pixel in the window screenshot the model is currently looking at.
 *  - windowLocal     — a point relative to the window's top-left, expressed in global screen points.
 *  - globalPoint     — a CoreGraphics global screen point (origin = top-left of the main display).
 *  - physicalPixel   — a backing-store pixel (globalPoint × scale on a Retina display).
 *
 * The window screenshot and the window's on-screen frame describe the SAME window in two units, so
 * the ratio frame⇄image converts between screenshot pixels and global points in both directions.
 * All transforms are pure and null-safe (they return null rather than emit a NaN coordinate that a
 * driver would happily click).
 */

export interface Point { x: number; y: number }
export interface ImageSize { width: number; height: number }
/** A rectangle in GLOBAL screen points (CoreGraphics space). */
export interface Frame { x: number; y: number; w: number; h: number }

/** 0–1000 normalized value → pixel along an axis of `extent` px (clamped to [0, extent]). */
export function normalizedToPixel(v: number, extent: number): number {
  const clamped = Math.max(0, Math.min(1000, v));
  return Math.round((clamped / 1000) * extent);
}

/** Pixel along an axis of `extent` px → 0–1000 normalized value (clamped). Inverse of the above. */
export function pixelToNormalized(px: number, extent: number): number {
  if (extent <= 0) return 0;
  const clamped = Math.max(0, Math.min(extent, px));
  return Math.round((clamped / extent) * 1000);
}

/** Screenshot pixel → global screen point, using the window's on-screen frame. */
export function screenshotToGlobal(p: Point, image: ImageSize, frame: Frame): Point | null {
  if (!image.width || !image.height || !frame.w || !frame.h) return null;
  return {
    x: Math.round(frame.x + p.x * (frame.w / image.width)),
    y: Math.round(frame.y + p.y * (frame.h / image.height)),
  };
}

/** Global screen point → screenshot pixel. Inverse of {@link screenshotToGlobal}. */
export function globalToScreenshot(p: Point, image: ImageSize, frame: Frame): Point | null {
  if (!image.width || !image.height || !frame.w || !frame.h) return null;
  return {
    x: Math.round((p.x - frame.x) * (image.width / frame.w)),
    y: Math.round((p.y - frame.y) * (image.height / frame.h)),
  };
}

/**
 * Center of an accessibility element — whose frame is reported in global screen points — expressed
 * as a screenshot pixel of the window image. Returns null when the center falls outside the image
 * (a stale AX frame from before a scroll/resize), so a mis-anchored click is refused rather than
 * clamped onto the wrong control.
 */
export function elementCenterToScreenshot(elementFrame: Frame, image: ImageSize, windowFrame: Frame): Point | null {
  if (!image.width || !image.height || !windowFrame.w || !windowFrame.h) return null;
  const localX = (elementFrame.x + elementFrame.w / 2) - windowFrame.x;
  const localY = (elementFrame.y + elementFrame.h / 2) - windowFrame.y;
  const x = Math.round(localX * (image.width / windowFrame.w));
  const y = Math.round(localY * (image.height / windowFrame.h));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  return { x, y };
}

/** Retina: global (logical) point → physical backing pixel. */
export function logicalToPhysical(p: Point, scale: number): Point {
  return { x: Math.round(p.x * scale), y: Math.round(p.y * scale) };
}

/** Retina: physical backing pixel → global (logical) point. */
export function physicalToLogical(p: Point, scale: number): Point {
  const s = scale || 1;
  return { x: Math.round(p.x / s), y: Math.round(p.y / s) };
}

/** Is a global point inside a window frame (inclusive of edges)? */
export function pointInFrame(p: Point, frame: Frame): boolean {
  return p.x >= frame.x && p.x <= frame.x + frame.w && p.y >= frame.y && p.y <= frame.y + frame.h;
}

/** Center of a frame, in the frame's own space. */
export function frameCenter(frame: Frame): Point {
  return { x: Math.round(frame.x + frame.w / 2), y: Math.round(frame.y + frame.h / 2) };
}

/** A screenshot pixel is valid only when it falls strictly inside the image it was chosen from. */
export function pixelInImage(p: Point, image: ImageSize): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= 0 && p.y >= 0 && p.x < image.width && p.y < image.height;
}
