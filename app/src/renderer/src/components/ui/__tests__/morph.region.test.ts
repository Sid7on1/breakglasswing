import { MorphController } from '../morph/controller';
import type { MorphGeometry } from '../morph/geometry';
import { paintRegionClip, releaseRegion } from '../morph/paint';

/**
 * The overlay → layout handoff, graded as arithmetic.
 *
 * A structural region's flight has a second half that a popover's does not have: at the end of it
 * the animation has to *stop existing*, and the layout has to own the column with nothing left
 * driving it (Prompt 2 §46, §47). Almost every way that goes wrong is invisible at 60fps and
 * obvious frame by frame — the reveal that lands at 0.98 and leaves the inspector permanently
 * translucent, the clip that is never cleared so the column keeps a stale composited layer, the
 * shell that settles at a corner the region does not have and pops on the last frame.
 *
 * So this file steps the driver by hand and reads the styles that would have been written. It is
 * the same technique as `morph.controller.test.ts` — the driver has no timeline, so a test can walk
 * it — extended to the write half, which is what makes the handoff checkable at all.
 */

/** The right-hand column, as the panel group actually lays it out. */
const REGION: MorphGeometry = { x: 1100, y: 0, width: 340, height: 900, radius: 0 };
/** A composer control at the bottom *centre* — deliberately not inside the region it opens. */
const SEED: MorphGeometry = { x: 620, y: 840, width: 96, height: 26, radius: 13 };

interface FakeStyle {
  clipPath: string;
  opacity: string;
  pointerEvents: string;
  willChange: string;
}

function fakeRegion(): { style: FakeStyle } {
  return { style: { clipPath: '', opacity: '', pointerEvents: '', willChange: '' } };
}

/** `inset(T R B L round Rr)` back into numbers, so the assertions can be about geometry. */
function parseInset(clip: string): { top: number; right: number; bottom: number; left: number; radius: number } {
  const match = /^inset\(([-\d.]+)px ([-\d.]+)px ([-\d.]+)px ([-\d.]+)px round ([-\d.]+)px\)$/.exec(clip);
  if (!match) throw new Error(`not an inset clip: ${clip}`);
  return {
    top: Number(match[1]),
    right: Number(match[2]),
    bottom: Number(match[3]),
    left: Number(match[4]),
    radius: Number(match[5]),
  };
}

/**
 * What the user can actually see of the region, in window coordinates.
 *
 * The insets are not the interesting value — a shell entirely outside the region produces insets
 * that *overlap*, which CSS resolves to an empty area, and asserting on the raw numbers would be
 * asserting on the arithmetic's choice of how to express nothing. This resolves them the way the
 * paint engine does, so every assertion below is about what is on screen.
 */
function exposed(clip: string, region: MorphGeometry): { x: number; y: number; width: number; height: number } {
  const inset = parseInset(clip);
  return {
    x: region.x + inset.left,
    y: region.y + inset.top,
    width: region.width - inset.left - inset.right,
    height: region.height - inset.top - inset.bottom,
  };
}

function makeRegionController(overrides: {
  seed?: MorphGeometry | null;
  region?: MorphGeometry;
  onSettled?: () => void;
  onClosed?: () => void;
} = {}): { controller: MorphController; element: { style: FakeStyle }; clips: string[] } {
  const region = overrides.region ?? REGION;
  const seed = overrides.seed === undefined ? SEED : overrides.seed;
  const element = fakeRegion();
  const clips: string[] = [];

  const controller = new MorphController({
    kind: () => 'inspector',
    reducedMotion: () => false,
    onSettled: overrides.onSettled,
    onClosed: overrides.onClosed,
    resolve: () => ({ seed, destination: region }),
  });

  controller.subscribe((frame) => {
    paintRegionClip(element as unknown as HTMLElement, frame, region);
    clips.push(element.style.clipPath);
  });

  return { controller, element, clips };
}

function runToRest(controller: MorphController, max = 400): number {
  let i = 0;
  while (i < max && (controller.state === 'opening' || controller.state === 'closing')) {
    controller.advance(1 / 60);
    i += 1;
  }
  return i;
}

describe('revealing a region through the flight', () => {
  test('the first frame exposes only where the shell is — which is nowhere, for a seed outside it', () => {
    // The seed is a composer pill 380px to the left of the column. Nothing of the inspector may be
    // painted on frame one: the reveal is the *shell's* box, and the shell is still the pill.
    const { controller, element } = makeRegionController();
    controller.open();

    expect(exposed(element.style.clipPath, REGION).width).toBeLessThanOrEqual(0);
    expect(Number(element.style.opacity)).toBe(0);
    controller.dispose();
  });

  test('what is exposed is always exactly the shell ∩ the region', () => {
    // The one property the whole reveal rests on, asserted on every frame of a flight rather than
    // at its endpoints — a clip that is right at 0% and 100% and wrong in between is precisely the
    // bug that looks like a plausible animation.
    const { controller, element } = makeRegionController();
    const checked: number[] = [];
    controller.subscribe((frame) => {
      const shown = exposed(element.style.clipPath, REGION);
      const g = frame.geometry;
      const wantX = Math.max(REGION.x, g.x);
      const wantRight = Math.min(REGION.x + REGION.width, g.x + g.width);
      if (wantRight - wantX > 0.5) {
        expect(shown.x).toBeCloseTo(wantX, 1);
        expect(shown.width).toBeCloseTo(wantRight - wantX, 1);
        checked.push(frame.progress);
      }
    });
    controller.open();
    runToRest(controller);

    // The assertions above are inside a conditional; if the condition never held they all passed
    // vacuously, which is the classic way a loop-shaped test pins nothing.
    expect(checked.length).toBeGreaterThan(10);
    controller.dispose();
  });

  test('a seed inside the region exposes exactly the seed', () => {
    // A control that lives in the column itself — an inspector lane chip reopening its own panel.
    const inside: MorphGeometry = { x: 1140, y: 60, width: 120, height: 30, radius: 8 };
    const { controller, element } = makeRegionController({ seed: inside });
    controller.open();

    const clip = parseInset(element.style.clipPath);
    expect(clip.left).toBeCloseTo(inside.x - REGION.x, 1);
    expect(clip.top).toBeCloseTo(inside.y - REGION.y, 1);
    expect(clip.right).toBeCloseTo((REGION.x + REGION.width) - (inside.x + inside.width), 1);
    expect(clip.bottom).toBeCloseTo((REGION.y + REGION.height) - (inside.y + inside.height), 1);
    controller.dispose();
  });

  test('the reveal never runs backwards while opening', () => {
    // The content appearing, disappearing and reappearing is the "opacity flash" §117 lists as a
    // slow-motion failure. It cannot be seen at 1x and it is trivially checkable here.
    const { controller, element } = makeRegionController();
    const opacities: number[] = [];
    controller.subscribe(() => opacities.push(Number(element.style.opacity)));
    controller.open();
    runToRest(controller);

    for (let i = 1; i < opacities.length; i++) {
      expect(opacities[i]).toBeGreaterThanOrEqual(opacities[i - 1] - 1e-6);
    }
    controller.dispose();
  });

  test('no clip inset ever goes negative, however far outside the region the seed is', () => {
    // A negative inset grows the clip past the element's own box. Nothing is there to show, so the
    // visible result is identical — which is exactly why this has to be asserted rather than looked
    // at: it would silently become a wrong-but-invisible value that some later change relies on.
    const { controller, element } = makeRegionController({
      seed: { x: -200, y: 1200, width: 40, height: 40, radius: 20 },
    });
    const seen: ReturnType<typeof parseInset>[] = [];
    controller.subscribe(() => seen.push(parseInset(element.style.clipPath)));
    controller.open();
    runToRest(controller);

    for (const clip of seen) {
      expect(clip.top).toBeGreaterThanOrEqual(0);
      expect(clip.right).toBeGreaterThanOrEqual(0);
      expect(clip.bottom).toBeGreaterThanOrEqual(0);
      expect(clip.left).toBeGreaterThanOrEqual(0);
    }
    controller.dispose();
  });

  test('the clip corner tracks the shell corner, so the handoff cannot pop', () => {
    // The region is square-cornered (it is flush with the window edge). If the reveal kept the
    // seed's 13px pill corner while the shell interpolated to 0, the last frame would jump.
    const { controller, element } = makeRegionController();
    controller.open();
    const launch = parseInset(element.style.clipPath);
    expect(launch.radius).toBeCloseTo(SEED.radius, 1);

    runToRest(controller);
    expect(parseInset(element.style.clipPath).radius).toBeCloseTo(REGION.radius, 1);
    controller.dispose();
  });
});

describe('the handoff', () => {
  test('settles fully open — not at 0.98', () => {
    const { controller, element } = makeRegionController();
    controller.open();
    runToRest(controller);

    expect(controller.state).toBe('open');
    const clip = parseInset(element.style.clipPath);
    expect(clip.top).toBe(0);
    expect(clip.right).toBe(0);
    expect(clip.bottom).toBe(0);
    expect(clip.left).toBe(0);
    expect(Number(element.style.opacity)).toBe(1);
    controller.dispose();
  });

  test('releaseRegion leaves no styles behind at all', () => {
    // Not "resets them to their resting values" — clears them. A column left at `opacity: 1` with a
    // clip path is still a composited layer with a stacking context, forever, for a flight that
    // finished, and that is how a z-index bug arrives in a panel someone adds next year.
    const { controller, element } = makeRegionController();
    controller.open();
    runToRest(controller);
    releaseRegion(element as unknown as HTMLElement);

    expect(element.style).toEqual({ clipPath: '', opacity: '', pointerEvents: '', willChange: '' });
    controller.dispose();
  });

  test('the region is not clickable until most of it is on screen', () => {
    const { controller, element } = makeRegionController();
    const states: { reveal: number; pointer: string }[] = [];
    controller.subscribe((frame) => states.push({ reveal: frame.reveal, pointer: element.style.pointerEvents }));
    controller.open();
    runToRest(controller);

    for (const state of states) {
      if (state.reveal <= 0.6) expect(state.pointer).toBe('none');
    }
    controller.dispose();
  });

  test('onSettled fires once, and only when the geometry has arrived', () => {
    let settled = 0;
    const { controller } = makeRegionController({ onSettled: () => { settled += 1; } });
    controller.open();
    expect(settled).toBe(0);
    runToRest(controller);
    expect(settled).toBe(1);
    // A second open of an already-open region must not re-announce a handoff that already happened.
    controller.open();
    runToRest(controller);
    expect(settled).toBe(1);
    controller.dispose();
  });
});

describe('closing', () => {
  test('the region empties before it contracts', () => {
    // Prompt 1 §14: content disappears, *then* the panel contracts. What flies home is a piece of
    // glass — a column of shrinking text is the cheap version of this animation.
    const { controller, element } = makeRegionController();
    controller.open();
    runToRest(controller);

    controller.close();
    const opacityAt: number[] = [];
    const widths: number[] = [];
    controller.subscribe((frame) => {
      opacityAt.push(Number(element.style.opacity));
      widths.push(frame.geometry.width);
    });
    runToRest(controller);

    const emptiedAt = opacityAt.findIndex((value) => value < 0.05);
    const halvedAt = widths.findIndex((value) => value < REGION.width / 2);
    expect(emptiedAt).toBeGreaterThanOrEqual(0);
    expect(emptiedAt).toBeLessThan(halvedAt);
    controller.dispose();
  });

  test('a region closing folds into the control as it is NOW, not as it was', () => {
    // The splitter was dragged and the composer reflowed while the inspector was open. v1 kept the
    // rect it opened from, so the collapse flew smoothly to a place the button no longer was.
    let seed = { ...SEED };
    const controller = new MorphController({
      kind: () => 'inspector',
      resolve: () => ({ seed, destination: REGION }),
    });
    controller.open();
    runToRest(controller);

    seed = { x: 300, y: 400, width: 96, height: 26, radius: 13 };
    controller.close();
    runToRest(controller);

    // The last published frame is the resting one; read it by subscribing after the fact.
    let landed: MorphGeometry | null = null;
    controller.subscribe((frame) => { landed = frame.geometry; });
    expect(landed).not.toBeNull();
    expect(landed!.x).toBeCloseTo(300, 0);
    expect(landed!.y).toBeCloseTo(400, 0);
    controller.dispose();
  });

  test('closing mid-open does not teleport', () => {
    const { controller, clips } = makeRegionController();
    controller.open();
    for (let i = 0; i < 6; i++) controller.advance(1 / 60);
    const before = parseInset(clips[clips.length - 1]);
    controller.close();
    const after = parseInset(clips[clips.length - 1]);

    // The reversal is a change of target, not a restart: the clip on the frame after the close is
    // the clip from the frame before it.
    expect(after.left).toBeCloseTo(before.left, 1);
    expect(after.top).toBeCloseTo(before.top, 1);
    runToRest(controller);
    controller.dispose();
  });
});
