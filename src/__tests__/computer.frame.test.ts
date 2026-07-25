/**
 * Frame identity + coordinate transform tests.
 *
 * Two halves:
 *  1. Deterministic cases for the staleness verdicts — each one is a real failure mode (a superseded
 *     picture, a window that moved under a planned click) rather than a synthetic edge case.
 *  2. Randomized property tests over thousands of display layouts, scale factors, negative origins
 *     and crop rectangles. These exist because the transform bugs that actually ship are not the
 *     ones a hand-written example catches — they are the ones that only appear on a second display
 *     at a fractional scale, which nobody has plugged in.
 */

import {
  FrameRegistry, FrameMetadata, boundsMatch,
  toGlobalPrecise, toScreenshotPrecise, toNativeEventPoint, toPhysicalPrecise, inFrameImage,
  GEOMETRY_TOLERANCE_PT, DEFAULT_FRAME_MAX_AGE_MS,
} from '../computer/frame';
import { Frame } from '../computer/coordinates';

const bounds = (x: number, y: number, w: number, h: number): Frame => ({ x, y, w, h });

function mintOne(reg: FrameRegistry, over: Partial<Parameters<FrameRegistry['mint']>[0]> = {}): FrameMetadata {
  return reg.mint({
    captureKind: 'window', pid: 100, windowId: 7, app: 'Notes',
    bounds: bounds(0, 0, 800, 600), image: { width: 800, height: 600 },
    ...over,
  });
}

describe('FrameRegistry — staleness verdicts', () => {
  it('mints an immutable record that a later mutation cannot re-point', () => {
    const reg = new FrameRegistry();
    const frame = mintOne(reg);
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.bounds)).toBe(true);
    // The whole safety argument rests on a transform being unable to read a newer rectangle off a
    // frame it was handed; a frozen record makes that a throw or a no-op, never a silent re-point.
    expect(() => { (frame.bounds as any).x = 999; }).toThrow();
    expect(frame.bounds.x).toBe(0);
  });

  it('refuses an action planned from a superseded frame', () => {
    const reg = new FrameRegistry();
    const first = mintOne(reg);
    const second = mintOne(reg);
    expect(second.frameId).not.toBe(first.frameId);

    const stale = reg.check({ frameId: first.frameId });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe('superseded');
    // The message must name the recovery, not merely state the problem.
    expect(stale.note).toMatch(/observe again/i);

    expect(reg.check({ frameId: second.frameId }).ok).toBe(true);
  });

  it('accepts an unlabelled action but still enforces age and target', () => {
    // A client that does not echo frameId must not be refused outright — the check degrades to what
    // the runtime already knew rather than breaking every caller that predates the field.
    const reg = new FrameRegistry();
    mintOne(reg);
    expect(reg.check({}).ok).toBe(true);
    expect(reg.check({ pid: 999 }).ok).toBe(false);
    expect(reg.check({ pid: 999 }).reason).toBe('target-changed');
  });

  it('refuses when the same window has moved or resized since capture', () => {
    const reg = new FrameRegistry();
    mintOne(reg, { bounds: bounds(100, 100, 800, 600) });

    // Within tolerance: a sub-pixel geometry jitter must not refuse a legitimate click.
    expect(reg.check({ liveBounds: bounds(100 + GEOMETRY_TOLERANCE_PT, 100, 800, 600) }).ok).toBe(true);

    // Beyond tolerance: this is the exact "click landed 40px off" case.
    const moved = reg.check({ liveBounds: bounds(140, 100, 800, 600) });
    expect(moved.ok).toBe(false);
    expect(moved.reason).toBe('geometry-changed');
    expect(moved.note).toMatch(/moved or resized/i);

    const resized = reg.check({ liveBounds: bounds(100, 100, 640, 480) });
    expect(resized.reason).toBe('geometry-changed');
  });

  it('expires a frame older than the freshness budget', () => {
    let now = 1_000_000;
    const reg = new FrameRegistry(DEFAULT_FRAME_MAX_AGE_MS, () => now);
    const frame = mintOne(reg);
    now += DEFAULT_FRAME_MAX_AGE_MS - 1;
    expect(reg.check({ frameId: frame.frameId }).ok).toBe(true);
    now += 2;
    const expired = reg.check({ frameId: frame.frameId });
    expect(expired.ok).toBe(false);
    expect(expired.reason).toBe('expired');
  });

  it('reports no-frame rather than pretending an action is safe', () => {
    const reg = new FrameRegistry();
    expect(reg.check().reason).toBe('unknown-frame');
    mintOne(reg);
    expect(reg.check().ok).toBe(true);
    reg.invalidate();
    expect(reg.check().reason).toBe('unknown-frame');
  });

  it('keeps seq monotonic so a later frame is always distinguishable', () => {
    const reg = new FrameRegistry();
    const seqs = Array.from({ length: 50 }, () => mintOne(reg).seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });
});

// ---- randomized property tests -----------------------------------------------------------------

/** Deterministic PRNG — a failing case must be reproducible from the seed, not a coin flip in CI. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe('coordinate transforms — randomized properties', () => {
  const SCALES = [1, 1.5, 2, 2.5, 3];

  it('round-trips screenshot → global → screenshot within subpixel tolerance (4000 cases)', () => {
    const rand = rng(0xBEEF);
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      // Deliberately include NEGATIVE origins: a display left of or above the main one has them, and
      // that is the layout where an origin sign error hides.
      const originX = Math.round((rand() * 6000) - 3000);
      const originY = Math.round((rand() * 4000) - 2000);
      const w = 40 + Math.round(rand() * 3000);
      const h = 40 + Math.round(rand() * 2000);
      const scale = SCALES[Math.floor(rand() * SCALES.length)];
      const imageW = Math.max(1, Math.round(w * scale));
      const imageH = Math.max(1, Math.round(h * scale));

      const reg = new FrameRegistry();
      const frame = reg.mint({
        captureKind: 'window', pid: 1, windowId: 1,
        bounds: bounds(originX, originY, w, h),
        image: { width: imageW, height: imageH },
        displayScale: scale,
      });

      const p = { x: rand() * (imageW - 1), y: rand() * (imageH - 1) };
      const global = toGlobalPrecise(frame, p)!;
      const back = toScreenshotPrecise(frame, global)!;
      worst = Math.max(worst, Math.abs(back.x - p.x), Math.abs(back.y - p.y));
    }
    // Full-precision round trip: error is float noise only, far below one screenshot pixel.
    expect(worst).toBeLessThan(1e-6);
  });

  it('never rounds mid-chain — precise transforms beat round-at-each-hop (2000 cases)', () => {
    // The reason toGlobalPrecise exists. Rounding at every conversion accumulates up to half a pixel
    // per hop, which is what turns a correct centre into an off-by-one on a 12pt control.
    const rand = rng(0x1234);
    let preciseWorst = 0, roundedWorst = 0;
    for (let i = 0; i < 2000; i++) {
      const w = 100 + Math.round(rand() * 1400);
      const h = 100 + Math.round(rand() * 900);
      const scale = SCALES[Math.floor(rand() * SCALES.length)];
      const imageW = Math.round(w * scale), imageH = Math.round(h * scale);
      const reg = new FrameRegistry();
      const frame = reg.mint({
        captureKind: 'window', pid: 1, bounds: bounds(0, 0, w, h),
        image: { width: imageW, height: imageH }, displayScale: scale,
      });
      const p = { x: rand() * (imageW - 1), y: rand() * (imageH - 1) };

      const precise = toScreenshotPrecise(frame, toGlobalPrecise(frame, p)!)!;
      preciseWorst = Math.max(preciseWorst, Math.abs(precise.x - p.x), Math.abs(precise.y - p.y));

      const viaRounded = toGlobalPrecise(frame, p)!;
      const rounded = toScreenshotPrecise(frame, { x: Math.round(viaRounded.x), y: Math.round(viaRounded.y) })!;
      roundedWorst = Math.max(roundedWorst, Math.abs(rounded.x - p.x), Math.abs(rounded.y - p.y));
    }
    expect(preciseWorst).toBeLessThan(1e-6);
    // The rounded path is measurably worse; this asserts the property that motivated the design
    // rather than pinning whatever number today's arithmetic happens to produce.
    expect(roundedWorst).toBeGreaterThan(preciseWorst);
  });

  it('maps a point inside the image to a point inside the window rectangle (3000 cases)', () => {
    const rand = rng(0xC0FFEE);
    for (let i = 0; i < 3000; i++) {
      const originX = Math.round((rand() * 4000) - 2000);
      const originY = Math.round((rand() * 3000) - 1500);
      const w = 50 + Math.round(rand() * 2000);
      const h = 50 + Math.round(rand() * 1500);
      const scale = SCALES[Math.floor(rand() * SCALES.length)];
      const reg = new FrameRegistry();
      const frame = reg.mint({
        captureKind: 'window', pid: 1,
        bounds: bounds(originX, originY, w, h),
        image: { width: Math.round(w * scale), height: Math.round(h * scale) },
        displayScale: scale,
      });
      const p = { x: rand() * (frame.image.width - 1), y: rand() * (frame.image.height - 1) };
      expect(inFrameImage(frame, p)).toBe(true);
      const g = toGlobalPrecise(frame, p)!;
      expect(g.x).toBeGreaterThanOrEqual(originX);
      expect(g.y).toBeGreaterThanOrEqual(originY);
      expect(g.x).toBeLessThanOrEqual(originX + w);
      expect(g.y).toBeLessThanOrEqual(originY + h);
    }
  });

  it('rounds exactly once, at the native-event boundary', () => {
    const p = { x: 10.4999, y: 20.5001 };
    expect(toNativeEventPoint(p)).toEqual({ x: 10, y: 21 });
    // Idempotent: rounding an already-integer point cannot drift it.
    expect(toNativeEventPoint(toNativeEventPoint(p))).toEqual(toNativeEventPoint(p));
  });

  it('scales logical points to backing pixels per the frame\'s own display', () => {
    const reg = new FrameRegistry();
    const retina = reg.mint({
      captureKind: 'window', pid: 1, bounds: bounds(0, 0, 100, 100),
      image: { width: 100, height: 100 }, displayScale: 2,
    });
    expect(toPhysicalPrecise(retina, { x: 50, y: 25 })).toEqual({ x: 100, y: 50 });
    const fractional = reg.mint({
      captureKind: 'window', pid: 1, bounds: bounds(0, 0, 100, 100),
      image: { width: 100, height: 100 }, displayScale: 1.5,
    });
    expect(toPhysicalPrecise(fractional, { x: 10, y: 10 })).toEqual({ x: 15, y: 15 });
  });

  it('returns null rather than NaN for a degenerate frame', () => {
    // A NaN coordinate is worse than a refusal: a driver will happily post it.
    const reg = new FrameRegistry();
    const zeroWidth = reg.mint({
      captureKind: 'window', pid: 1, bounds: bounds(0, 0, 0, 600),
      image: { width: 800, height: 600 },
    });
    expect(toGlobalPrecise(zeroWidth, { x: 10, y: 10 })).toBeNull();
    expect(toScreenshotPrecise(zeroWidth, { x: 10, y: 10 })).toBeNull();
  });

  it('boundsMatch tolerates jitter and rejects real movement', () => {
    const a = bounds(10, 20, 300, 400);
    expect(boundsMatch(a, bounds(10, 20, 300, 400))).toBe(true);
    expect(boundsMatch(a, bounds(11, 21, 301, 401))).toBe(true);
    expect(boundsMatch(a, bounds(10 + GEOMETRY_TOLERANCE_PT + 1, 20, 300, 400))).toBe(false);
    expect(boundsMatch(a, bounds(10, 20, 300, 400 + GEOMETRY_TOLERANCE_PT + 1))).toBe(false);
  });
});
