import {
  normalizedToPixel, pixelToNormalized, screenshotToGlobal, globalToScreenshot,
  elementCenterToScreenshot, globalFrameToScreenshot, logicalToPhysical, physicalToLogical, pointInFrame, pixelInImage,
} from '../computer/coordinates';

describe('coordinate transforms', () => {
  it('normalized ⇄ pixel is stable and clamped', () => {
    expect(normalizedToPixel(500, 1470)).toBe(735);
    expect(normalizedToPixel(0, 1470)).toBe(0);
    expect(normalizedToPixel(1000, 956)).toBe(956);
    expect(normalizedToPixel(-50, 1470)).toBe(0);   // clamp low
    expect(normalizedToPixel(2000, 1470)).toBe(1470); // clamp high
    expect(pixelToNormalized(735, 1470)).toBe(500);
    expect(pixelToNormalized(0, 1470)).toBe(0);
    expect(pixelToNormalized(956, 956)).toBe(1000);
    expect(pixelToNormalized(5, 0)).toBe(0); // degenerate extent
  });

  it('reproduces the exact numbers the runtime relies on (regression lock)', () => {
    // Foreground normalized click 750,250 in a 1400×1600 image, window frame {100,50,700,800}.
    // The runtime scales normalized against extent-1, then maps the screenshot pixel to a global
    // point; these were 1049/400 → 625/250 in bimax.computer.runtime.test.ts.
    expect(normalizedToPixel(750, 1399)).toBe(1049);
    expect(normalizedToPixel(250, 1599)).toBe(400);
    expect(screenshotToGlobal({ x: 1049, y: 400 }, { width: 1400, height: 1600 }, { x: 100, y: 50, w: 700, h: 800 }))
      .toEqual({ x: 625, y: 250 });
    // Native label frame {150,100,100,40} in window {100,50,350,400}, image 700×800 → pixel 200,140.
    expect(elementCenterToScreenshot({ x: 150, y: 100, w: 100, h: 40 }, { width: 700, height: 800 }, { x: 100, y: 50, w: 350, h: 400 }))
      .toEqual({ x: 200, y: 140 });
    expect(globalFrameToScreenshot({ x: 150, y: 100, w: 100, h: 40 }, { width: 700, height: 800 }, { x: 100, y: 50, w: 350, h: 400 }))
      .toEqual({ x: 100, y: 100, w: 200, h: 80 });
  });

  it('screenshot ⇄ global round-trips within rounding for a Retina-scaled capture', () => {
    // 800×600-point window captured at 2× → 1600×1200 screenshot pixels. A pixel maps to a global
    // point and back to (approximately) itself.
    const image = { width: 1600, height: 1200 };
    const frame = { x: 200, y: 100, w: 800, h: 600 };
    for (const p of [{ x: 0, y: 0 }, { x: 800, y: 600 }, { x: 1599, y: 1199 }, { x: 400, y: 900 }]) {
      const g = screenshotToGlobal(p, image, frame)!;
      const back = globalToScreenshot(g, image, frame)!;
      expect(Math.abs(back.x - p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.y - p.y)).toBeLessThanOrEqual(1);
    }
  });

  it('recomputes the global target after the window MOVES (same image, new frame)', () => {
    const image = { width: 700, height: 800 };
    const before = screenshotToGlobal({ x: 350, y: 400 }, image, { x: 100, y: 50, w: 350, h: 400 })!;
    const after = screenshotToGlobal({ x: 350, y: 400 }, image, { x: 900, y: 300, w: 350, h: 400 })!;
    expect(before).toEqual({ x: 275, y: 250 });
    expect(after).toEqual({ x: 1075, y: 500 }); // window moved +800/+250 → the same pixel lands elsewhere
  });

  it('recomputes the global target after the window RESIZES (frame w/h change)', () => {
    const image = { width: 700, height: 800 };
    const small = screenshotToGlobal({ x: 700, y: 800 }, image, { x: 0, y: 0, w: 350, h: 400 })!;
    const large = screenshotToGlobal({ x: 700, y: 800 }, image, { x: 0, y: 0, w: 700, h: 800 })!;
    expect(small).toEqual({ x: 350, y: 400 });
    expect(large).toEqual({ x: 700, y: 800 });
  });

  it('handles two displays with different scale factors', () => {
    // A point at physical 3000,2000 on a 2× external display is logical 1500,1000; a 1× display
    // leaves it unchanged.
    expect(physicalToLogical({ x: 3000, y: 2000 }, 2)).toEqual({ x: 1500, y: 1000 });
    expect(logicalToPhysical({ x: 1500, y: 1000 }, 2)).toEqual({ x: 3000, y: 2000 });
    expect(physicalToLogical({ x: 1280, y: 720 }, 1)).toEqual({ x: 1280, y: 720 });
    expect(physicalToLogical({ x: 10, y: 10 }, 0)).toEqual({ x: 10, y: 10 }); // scale 0 → treat as 1
  });

  it('refuses an element center that falls outside the image (stale AX frame)', () => {
    const image = { width: 700, height: 800 };
    const window = { x: 100, y: 50, w: 350, h: 400 };
    // Element scrolled off the top of the window → negative local Y → out of image → null.
    expect(elementCenterToScreenshot({ x: 150, y: -500, w: 100, h: 40 }, image, window)).toBeNull();
  });

  // A click on a control inside a save/confirm sheet was refused live, with preflight reporting
  // that the point resolved to the text area behind it. Two explanations were possible: the sheet
  // was observed mid-animation (preflight working exactly as designed), or sheet-hosted element
  // frames map through a different space than ordinary window elements.
  //
  // The second is false, and this pins why: there is ONE transform, keyed on the window frame, and
  // it knows nothing about what kind of container an element lives in. A sheet's element carries a
  // global screen rect like every other element and round-trips like every other element. So a
  // refusal of this shape means the geometry genuinely moved — which is the point of the check.
  it('round-trips any element frame through the window transform, container-agnostic', () => {
    const image = { width: 600, height: 500 };
    const window = { x: 120, y: 80, w: 1200, h: 1000 }; // 2× between global points and pixels
    const roundTrip = (element: { x: number; y: number; w: number; h: number }) => {
      const local = globalFrameToScreenshot(element, image, window)!;
      const centre = { x: local.x + local.w / 2, y: local.y + local.h / 2 };
      return screenshotToGlobal(centre, image, window)!;
    };

    // An ordinary window control.
    expect(roundTrip({ x: 220, y: 180, w: 200, h: 40 })).toEqual({ x: 320, y: 200 });
    // A control hosted in a sheet: smaller, floating over the middle of the parent window. Same
    // transform, same fidelity — nothing special-cases it.
    expect(roundTrip({ x: 600, y: 480, w: 120, h: 32 })).toEqual({ x: 660, y: 496 });
    // Sheet geometry that has MOVED between observation and click does not round-trip to where the
    // control was seen. That divergence is the signal preflight refuses on.
    const seen = roundTrip({ x: 600, y: 480, w: 120, h: 32 });
    const moved = roundTrip({ x: 600, y: 560, w: 120, h: 32 }); // sheet slid 80pt further down
    expect(moved).not.toEqual(seen);
  });

  it('point/pixel containment predicates', () => {
    const frame = { x: 100, y: 50, w: 350, h: 400 };
    expect(pointInFrame({ x: 100, y: 50 }, frame)).toBe(true);   // top-left edge, inclusive
    expect(pointInFrame({ x: 450, y: 450 }, frame)).toBe(true);  // bottom-right edge, inclusive
    expect(pointInFrame({ x: 99, y: 50 }, frame)).toBe(false);
    expect(pixelInImage({ x: 0, y: 0 }, { width: 10, height: 10 })).toBe(true);
    expect(pixelInImage({ x: 10, y: 0 }, { width: 10, height: 10 })).toBe(false); // right edge is exclusive
    expect(pixelInImage({ x: NaN, y: 0 }, { width: 10, height: 10 })).toBe(false);
  });
});
