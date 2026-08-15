import { isAtRest, settle, step, type SpringState } from '../morph/spring-value';

/**
 * The spring is the half of the morph that can be smoothly, plausibly wrong.
 *
 * An over-damped config still produces a beautiful animation — it just never overshoots, so "is
 * this actually springy?" is not answerable by looking at it. And an unstable integrator looks
 * perfect at 60fps and explodes only on the frames nobody is watching for. Both are graded here
 * directly, against the physics, rather than against a screenshot.
 */

const HOUSE = { stiffness: 520, ratio: 0.82 };

/** Run a spring to rest and report what it did on the way. */
function fly(
  from: number,
  to: number,
  spec = HOUSE,
  dt = 1 / 60,
  maxFrames = 600,
): { frames: number; peak: number; samples: number[] } {
  let state: SpringState = settle(from);
  const samples: number[] = [from];
  let peak = from;
  let frames = 0;
  while (frames < maxFrames && !isAtRest(state, to)) {
    state = step(state, to, spec, dt);
    samples.push(state.value);
    if (Math.abs(state.value - from) > Math.abs(peak - from)) peak = state.value;
    frames += 1;
  }
  return { frames, peak, samples };
}

describe('analytic spring', () => {
  test('arrives at the target and stops', () => {
    const { frames, samples } = fly(0, 300);
    expect(frames).toBeLessThan(120);
    expect(samples[samples.length - 1]).toBeCloseTo(300, 1);
  });

  test('a Mac-grade spring overshoots, but only just', () => {
    // The distinction the brief draws between "premium spring" and "cartoon bounce" is a number,
    // and this is the number. Present enough to read as a settle; small enough that at 300px of
    // travel the surface goes past its target by under five pixels.
    const { peak } = fly(0, 300);
    expect(peak).toBeGreaterThan(300);
    expect(peak).toBeLessThan(305);
  });

  test('critically damped never passes its target', () => {
    const { peak } = fly(0, 300, { stiffness: 400, ratio: 1 });
    expect(peak).toBeLessThanOrEqual(300.001);
  });

  test('over-damped never passes its target either', () => {
    const { peak } = fly(0, 300, { stiffness: 400, ratio: 1.6 });
    expect(peak).toBeLessThanOrEqual(300.001);
  });

  /**
   * The reason this file exists.
   *
   * Semi-implicit Euler — the usual implementation — is only conditionally stable: at stiffness 520
   * it needs dt below about 2/ω ≈ 88ms, and a single stalled frame past that makes the spring gain
   * energy instead of losing it. In this app a 200ms main-thread stall is an ordinary consequence of
   * rendering streaming markdown, so the failure would be routine and would look like a panel
   * flinging itself off screen after a hitch. The closed form has no such limit.
   */
  test('a stalled frame lands settled instead of exploding', () => {
    // Total energy: ½k·x² (in the spring) + ½m·v² (in the motion). A damped spring can only ever
    // shed it. This is the invariant an unstable integrator breaks — and the only one worth
    // asserting, because velocity alone is not a bug: 2800 px/s at 50ms into a 300px flight is
    // simply what a spring at that stiffness does, and a threshold picked by eye would pin the
    // wrong thing.
    const energy = (x: number, v: number): number => 0.5 * HOUSE.stiffness * x * x + 0.5 * v * v;
    const initial = energy(300, 0);

    for (const stall of [0.05, 0.2, 0.5, 1, 4]) {
      const state = step(settle(0), 300, HOUSE, stall);
      expect(Number.isFinite(state.value)).toBe(true);
      // Never past the target by more than the spring's own honest overshoot, whatever dt was.
      expect(state.value).toBeLessThan(306);
      expect(energy(state.value - 300, state.velocity)).toBeLessThan(initial);
    }
    // And a long enough gap arrives fully settled, so a morph resumed after the window was
    // occluded is simply *finished* rather than mid-flight.
    const long = step(settle(0), 300, HOUSE, 2);
    expect(long.value).toBeCloseTo(300, 3);
    expect(long.velocity).toBeCloseTo(0, 3);
  });

  test('the trajectory does not depend on how it was sampled', () => {
    // Exactness at any dt is what lets the shared clock run at whatever rate the compositor gives
    // it. Stepping once by 100ms and sixty times by 1.67ms must reach the same place.
    const coarse = step(settle(0), 300, HOUSE, 0.1);
    let fine: SpringState = settle(0);
    for (let i = 0; i < 60; i++) fine = step(fine, 300, HOUSE, 0.1 / 60);
    expect(fine.value).toBeCloseTo(coarse.value, 4);
    expect(fine.velocity).toBeCloseTo(coarse.velocity, 3);
  });

  /**
   * Retargeting is the entire architectural claim of v2 — "the animation should continue from its
   * current visual state instead of jumping" (Prompt 1 §20). Physically that means momentum has to
   * survive the change of target, so a spring aimed backwards mid-flight must keep travelling
   * FORWARD for at least one more frame before it turns round.
   */
  test('retargeting carries momentum through the reversal', () => {
    let state = settle(0);
    for (let i = 0; i < 6; i++) state = step(state, 400, HOUSE, 1 / 60);
    const atReversal = state.value;
    expect(state.velocity).toBeGreaterThan(0);

    // Now aim it home.
    const next = step(state, 0, HOUSE, 1 / 60);
    expect(next.value).toBeGreaterThan(atReversal);
    // …and it does eventually get there, without ringing.
    let home = next;
    for (let i = 0; i < 200 && !isAtRest(home, 0); i++) home = step(home, 0, HOUSE, 1 / 60);
    expect(home.value).toBeCloseTo(0, 1);
  });

  test('rest is sub-pixel, and reached promptly', () => {
    const { frames } = fly(0, 300);
    // ~60 frames at 60Hz. The brief's governing constraint for a Mac app is that a frequent
    // interaction must never feel like something to wait for (Prompt 2 §8); a full second of
    // settling on a popover would be exactly that.
    expect(frames).toBeLessThan(40);
    expect(isAtRest({ value: 300.05, velocity: 0.5 }, 300)).toBe(true);
    expect(isAtRest({ value: 300.5, velocity: 0 }, 300)).toBe(false);
  });
});
