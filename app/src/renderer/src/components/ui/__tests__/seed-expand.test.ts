import { describe, expect, test } from '@jest/globals';
import {
  DEFAULT_SIZING, inverseScaleKeyframes, panelBox, projectSeedInto, seedTransform,
  type Box, type Placement,
} from '../seed-expand';
import { easingFunction, resolveSpring, springFromCharacter, SPRINGS } from '../motion';

/**
 * The seeded expansion flies the panel from the clicked element's rect to its own.
 *
 * A wrong transform here does not look broken — it looks like a smooth animation arriving from the
 * wrong place, which is indistinguishable from "a modal appeared" and is the exact thing the effect
 * exists to avoid. So the geometry is pinned rather than eyeballed.
 */

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });

describe('seedTransform', () => {
  test('lands the panel centre exactly on the seed centre', () => {
    // A real measurement from the Mac lane: a 352x54 timeline row, a 560x190 panel centred at 1280x720.
    const seed = box(24, 300, 352, 54);
    const panel = box(360, 265, 560, 190);

    const { dx, dy, scaleX, scaleY } = seedTransform(seed, panel);

    // Apply the transform the way the compositor would: scale about the panel's centre, then translate.
    const centre = { x: panel.left + panel.width / 2, y: panel.top + panel.height / 2 };
    expect(centre.x + dx).toBeCloseTo(seed.left + seed.width / 2);
    expect(centre.y + dy).toBeCloseTo(seed.top + seed.height / 2);
    // …and the scaled panel is exactly the seed's size.
    expect(panel.width * scaleX).toBeCloseTo(seed.width);
    expect(panel.height * scaleY).toBeCloseTo(seed.height);
  });

  test('a seed to the left and above produces negative deltas', () => {
    const { dx, dy } = seedTransform(box(0, 0, 100, 40), box(500, 400, 600, 300));
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
  });

  test('a seed below and right produces positive deltas', () => {
    const { dx, dy } = seedTransform(box(900, 900, 100, 40), box(500, 400, 600, 300));
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
  });

  test('a seed already centred on the panel needs no travel', () => {
    const { dx, dy } = seedTransform(box(550, 500, 100, 40), box(400, 400, 400, 240));
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(0);
  });

  /**
   * A row scrolled out of view reports zero height. `scale(0)` is dropped outright by some
   * compositors, which would strand the panel invisible — the floor keeps it animatable.
   */
  test('a collapsed seed never yields a zero scale', () => {
    const { scaleX, scaleY } = seedTransform(box(24, 0, 0, 0), box(360, 265, 560, 190));
    expect(scaleX).toBeGreaterThan(0);
    expect(scaleY).toBeGreaterThan(0);
  });

  /**
   * The mirror of the collapsed-seed floor. A control BIGGER than the surface it opens — the whole
   * sidebar collapsing into a dialog, a maximised pane seeding a popover — would otherwise launch
   * the panel at many times its size and fill the screen with a smear on frame one.
   */
  test('an oversized seed never yields an unbounded scale', () => {
    const { scaleX, scaleY } = seedTransform(box(0, 0, 3440, 1440), box(600, 400, 240, 90));
    expect(scaleX).toBeLessThanOrEqual(8);
    expect(scaleY).toBeLessThanOrEqual(8);
  });
});

/**
 * ## The window-size matrix
 *
 * Everything above pins the flight for one window. These pin the LAYOUT the flight measures against,
 * across the shapes a desktop window actually takes: dragged small, split to a half-screen column,
 * squashed flat against the Dock, and thrown across an ultrawide.
 *
 * This is where a panel silently breaks. `w-[min(560px,calc(100vw-56px))]` is correct until the
 * window is 100px wide, at which point the gutter is bigger than the window and the panel is
 * negative; a centred panel is centred until rounding on an odd width pushes an edge a half pixel
 * off screen, which on macOS shows as a hairline of scrollbar. None of it is visible at the size
 * the developer had their window at.
 */
const WINDOWS: { label: string; width: number; height: number }[] = [
  { label: 'tiny — the smallest the window can be dragged', width: 320, height: 480 },
  { label: 'half-screen column', width: 720, height: 1080 },
  { label: 'small laptop', width: 1024, height: 640 },
  { label: 'default', width: 1280, height: 800 },
  { label: 'retina laptop', width: 1512, height: 945 },
  { label: 'full HD', width: 1920, height: 1080 },
  { label: 'ultrawide', width: 3440, height: 1440 },
  { label: 'squashed flat against the Dock', width: 1440, height: 320 },
  { label: 'tall and narrow', width: 380, height: 1200 },
  { label: 'odd width, so centring rounds', width: 1001, height: 733 },
  { label: 'degenerate — a window mid-restore reports nothing', width: 0, height: 0 },
];

const PLACEMENTS: Placement[] = ['center', 'left', 'right'];

describe('panelBox across window sizes', () => {
  for (const viewport of WINDOWS) {
    for (const placement of PLACEMENTS) {
      test(`${placement}: stays on screen at ${viewport.label} (${viewport.width}x${viewport.height})`, () => {
        const panel = panelBox(viewport, DEFAULT_SIZING, placement);

        // Never negative, never zero: a zero-size panel is not "small", it is gone — and it also
        // makes the flight's scale factors divide by zero.
        expect(panel.width).toBeGreaterThan(0);
        expect(panel.height).toBeGreaterThan(0);

        // Fully inside. `>= 0` and `<= extent` rather than a tolerance: a half-pixel outside is a
        // visible hairline, not a rounding detail.
        expect(panel.left).toBeGreaterThanOrEqual(0);
        expect(panel.top).toBeGreaterThanOrEqual(0);
        expect(panel.left + panel.width).toBeLessThanOrEqual(Math.max(1, viewport.width));
        expect(panel.top + panel.height).toBeLessThanOrEqual(Math.max(1, viewport.height));
      });
    }
  }

  test('the margin yields before the panel does', () => {
    // 320 wide, a 28px gutter each side, a 560px panel: the naive clamp leaves 264px and the panel
    // is squeezed to a sliver between two full-width margins. The gutter gives way instead.
    const panel = panelBox({ width: 320, height: 480 });
    expect(panel.width).toBeGreaterThan(320 * 0.55);
  });

  test('a panel that fits is centred, and one that does not still fills the window', () => {
    const roomy = panelBox({ width: 1920, height: 1080 });
    expect(roomy.width).toBe(DEFAULT_SIZING.width);
    expect(roomy.left + roomy.width / 2).toBeCloseTo(960, 0);
    expect(roomy.top + roomy.height / 2).toBeCloseTo(540, 0);

    const cramped = panelBox({ width: 400, height: 480 });
    expect(cramped.width).toBeLessThan(DEFAULT_SIZING.width);
  });

  test('a bar owns its edge and the full height at every size', () => {
    for (const viewport of WINDOWS) {
      const height = Math.max(1, viewport.height);
      const left = panelBox(viewport, DEFAULT_SIZING, 'left');
      const right = panelBox(viewport, DEFAULT_SIZING, 'right');

      expect(left.left).toBe(0);
      expect(left.height).toBe(height);
      expect(right.left + right.width).toBe(Math.max(1, viewport.width));
      expect(right.height).toBe(height);
    }
  });

  test('a short window clamps by height, not by the height ratio alone', () => {
    // 78% of 320 is 250, which fits — but the gutter still has to come out of the same 320.
    const panel = panelBox({ width: 1440, height: 320 });
    expect(panel.top).toBeGreaterThanOrEqual(0);
    expect(panel.top + panel.height).toBeLessThanOrEqual(320);
  });
});

describe('the flight lands correctly at every window size', () => {
  test('a seed anywhere on screen still puts the panel centre on the seed centre', () => {
    for (const viewport of WINDOWS) {
      if (!viewport.width || !viewport.height) continue;
      const panel = panelBox(viewport);
      // The four corners and the middle — a trigger can be any of these (a title-bar toggle, a
      // footer settings button, a row in the middle of a list).
      const seeds: Box[] = [
        box(0, 0, 32, 32),
        box(viewport.width - 32, 0, 32, 32),
        box(0, viewport.height - 32, 32, 32),
        box(viewport.width - 32, viewport.height - 32, 32, 32),
        box(viewport.width / 2 - 16, viewport.height / 2 - 16, 32, 32),
      ];
      for (const seed of seeds) {
        const { dx, dy, scaleX, scaleY } = seedTransform(seed, panel);
        expect(panel.left + panel.width / 2 + dx).toBeCloseTo(seed.left + seed.width / 2, 6);
        expect(panel.top + panel.height / 2 + dy).toBeCloseTo(seed.top + seed.height / 2, 6);
        expect(scaleX).toBeGreaterThan(0);
        expect(scaleY).toBeGreaterThan(0);
      }
    }
  });
});

describe('projectSeedInto', () => {
  /** The bars: a column of the window, at a few of the widths the splitter allows. */
  const COLUMNS: Box[] = [
    { left: 0, top: 44, width: 190, height: 436 },
    { left: 0, top: 44, width: 248, height: 756 },
    { left: 1180, top: 44, width: 300, height: 276 },
    { left: 3140, top: 44, width: 300, height: 1396 },
  ];

  test('the projected seed is always inside the column', () => {
    // The trigger is a title-bar toggle: above the column, and often outside it horizontally too.
    const triggers: Box[] = [
      box(8, 8, 28, 28),
      box(1400, 8, 28, 28),
      box(3400, 8, 28, 28),
      box(-40, -40, 28, 28),
    ];
    for (const column of COLUMNS) {
      for (const trigger of triggers) {
        const seed = projectSeedInto(trigger, column);
        expect(seed.left).toBeGreaterThanOrEqual(column.left);
        expect(seed.top).toBeGreaterThanOrEqual(column.top);
        expect(seed.left + seed.width).toBeLessThanOrEqual(column.left + column.width);
        expect(seed.top + seed.height).toBeLessThanOrEqual(column.top + column.height);
      }
    }
  });

  test('a seed that already fits inside is not moved', () => {
    const column = COLUMNS[1];
    const inside = box(column.left + 20, column.top + 30, 28, 28);
    expect(projectSeedInto(inside, column)).toEqual(inside);
  });

  test('the size is preserved unless the column is smaller than the seed', () => {
    const column = COLUMNS[0];
    expect(projectSeedInto(box(8, 8, 28, 28), column).width).toBe(28);
    // A seed wider than the column has no position that is "inside" — it is shrunk to fit rather
    // than clamped, which would leave it hanging out of one edge while claiming to be contained.
    const wide = projectSeedInto(box(8, 8, 900, 28), column);
    expect(wide.width).toBe(column.width);
    expect(wide.left).toBe(column.left);
  });

  test('the projection keeps the direction of the trigger', () => {
    const column = COLUMNS[1]; // left bar, x ∈ [0, 248]
    // A trigger at the top-left projects to the top-left corner, so the bar unfolds toward it.
    const near = projectSeedInto(box(8, 8, 28, 28), column);
    expect(near.left).toBe(8);
    expect(near.top).toBe(column.top);
    // A trigger far to the right projects to the column's right edge, not to its centre.
    const far = projectSeedInto(box(1400, 8, 28, 28), column);
    expect(far.left).toBe(column.width - 28);
  });
});

describe('inverseScaleKeyframes', () => {
  const easing = resolveSpring(springFromCharacter(SPRINGS.glass)).easing;

  /**
   * The claim the whole content layer rests on: at every instant, the content's scale is the exact
   * reciprocal of the panel's, so glyphs sit at 1:1 for the entire flight.
   *
   * The panel's scale is recomputed here the way the compositor arrives at it — linear interpolation
   * between the seeded and settled keyframes, in eased progress — rather than read back out of the
   * function under test.
   */
  test('content scale x panel scale is 1 at every sample', () => {
    const progress = easingFunction(easing);
    // A deliberately brutal ratio: a 32px round button opening a 560x600 sheet.
    for (const [scaleX, scaleY] of [[0.057, 0.053], [0.6, 0.15], [0.95, 0.9], [4, 2]]) {
      for (const frame of inverseScaleKeyframes(scaleX, scaleY, easing)) {
        const p = progress(frame.offset);
        expect((scaleX + (1 - scaleX) * p) * frame.scaleX).toBeCloseTo(1, 6);
        expect((scaleY + (1 - scaleY) * p) * frame.scaleY).toBeCloseTo(1, 6);
      }
    }
  });

  test('the two-endpoint version this replaced is off by more than 2x mid-flight', () => {
    // Not a test of our code — a test of the reasoning behind it, so that "just interpolate between
    // 1/sx and 1" cannot be reintroduced as a simplification. 1/x is not linear, so interpolating
    // its endpoints is only correct AT the endpoints.
    const [sx] = [0.15];
    const naiveAtHalf = (1 / sx) + (1 - 1 / sx) * 0.5;
    const panelAtHalf = sx + (1 - sx) * 0.5;
    expect(naiveAtHalf * panelAtHalf).toBeGreaterThan(2);
  });

  test('the samples run from 0 to 1 in order, as WAAPI requires', () => {
    // `animate()` rejects a non-monotonic offset list outright, taking the React tree down with it.
    const frames = inverseScaleKeyframes(0.1, 0.05, easing);
    expect(frames[0].offset).toBe(0);
    expect(frames[frames.length - 1].offset).toBe(1);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].offset).toBeGreaterThan(frames[i - 1].offset);
    }
  });

  test('no sample is degenerate, even where the spring overshoots', () => {
    for (const frame of inverseScaleKeyframes(0.04, 0.04, easing)) {
      expect(Number.isFinite(frame.scaleX)).toBe(true);
      expect(frame.scaleX).toBeGreaterThan(0);
      expect(Number.isFinite(frame.scaleY)).toBe(true);
      expect(frame.scaleY).toBeGreaterThan(0);
    }
  });
});
