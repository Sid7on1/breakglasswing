/**
 * A spring you can aim somewhere else while it is still moving.
 *
 * ## Why this exists next to `../motion.ts` rather than replacing it
 *
 * `motion.ts` compiles a spring into a CSS `linear()` easing ahead of time, and for the great
 * majority of BiMAX's motion that is the better tool: the browser composites the whole flight on the
 * GPU, so a press highlight or a menu fade keeps playing at full rate while the engine is streaming
 * tokens through the transcript on the main thread. Nothing here changes that. A compiled curve is
 * the right answer whenever the destination is known at launch and never moves.
 *
 * The morph is the case where it is the wrong answer, for one structural reason: **a compiled curve
 * has no state.** It is a function of elapsed time, so the only thing an interruption can do is
 * cancel it and start a new one — from rest, from wherever the element happens to be, with the
 * velocity thrown away. That is exactly the discontinuity Prompt 1 §9/§20 and Prompt 2 §9/§78/§79
 * describe: close a panel while it is opening and it stops dead and reverses; resize the window
 * mid-flight and the surface either finishes at the stale size or teleports to the new one.
 *
 * A spring carrying `(value, velocity)` retargets for free. Aim it somewhere else and it curves into
 * the new target with the momentum it already had — which is what "the animation should continue
 * from its current visual state instead of jumping" means physically.
 *
 * ## Why the analytic solution and not Euler
 *
 * The usual implementation steps `v += a·dt; x += v·dt` per frame. That is conditionally stable: at
 * the stiffnesses this system uses (up to ~620) a 40ms frame — routine in this app, which stalls the
 * main thread to render markdown — puts it past the stability limit, and the spring gains energy
 * instead of losing it. The visible result is a surface that jitters or flies off after a hitch,
 * precisely when the user is most likely to notice.
 *
 * The closed-form solution of a damped harmonic oscillator has no such limit. `step()` is exact for
 * any `dt`, so a 4ms frame and a 400ms stall produce the same trajectory through the same point.
 * Frame pacing stops being a correctness concern and goes back to being a smoothness concern, which
 * is where Prompt 2 §82 wants it.
 */

/** Position and momentum. This pair is the entire reason the morph is interruptible. */
export interface SpringState {
  value: number;
  velocity: number;
}

/** A spring's shape, named the way `../motion.ts` names it: pull, and how much it rings. */
export interface SpringSpec {
  stiffness: number;
  /** ζ. Below 1 it overshoots, 1 is critically damped, above 1 it crawls in. */
  ratio: number;
  mass?: number;
}

/**
 * Close enough to the target, and slow enough, that no further frame would be visible.
 *
 * In px and px/s, because that is what this spring drives. A tenth of a pixel is below a Retina
 * device pixel, so nothing is given up by stopping there — whereas the textbook 0.001 threshold
 * would keep the rAF loop alive for hundreds of milliseconds after the surface visually arrived,
 * burning frames on an animation that finished.
 */
const REST_DISPLACEMENT = 0.1;
const REST_VELOCITY = 1;

/**
 * Advance a spring toward `target` by `dt` seconds.
 *
 * Returns a new state; the caller owns storage. Pure, so the physics can be graded without a clock.
 */
export function step(state: SpringState, target: number, spec: SpringSpec, dt: number): SpringState {
  if (dt <= 0) return state;

  const mass = spec.mass ?? 1;
  // Angular frequency and damping ratio — the two numbers the closed form is written in.
  const omega = Math.sqrt(spec.stiffness / mass);
  const zeta = spec.ratio;

  // Displacement from the target, and its rate. The solution below is written about the target as
  // the origin, which is what makes retargeting trivial: change `target` and the same equations
  // describe the new motion from the current (x, v) without any bookkeeping.
  const x0 = state.value - target;
  const v0 = state.velocity;

  // A stall long enough to be a page fault should not be integrated as one enormous step that lands
  // the surface at its target with a jerk; it should land it *settled*. The closed form does this
  // correctly on its own — the exponential has decayed to nothing by then — so no clamp is needed
  // for stability. This bound exists only to keep `Math.exp` out of denormal territory.
  const t = Math.min(dt, 1);

  let x: number;
  let v: number;

  if (zeta < 1 - 1e-6) {
    // Under-damped: it overshoots and rings. The house springs live here.
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    const a = x0;
    const b = (v0 + zeta * omega * x0) / wd;
    x = decay * (a * cos + b * sin);
    v = decay * (
      (-zeta * omega) * (a * cos + b * sin)
      + wd * (b * cos - a * sin)
    );
  } else if (zeta > 1 + 1e-6) {
    // Over-damped: two real exponentials, no overshoot at all.
    const root = omega * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * omega + root;
    const r2 = -zeta * omega - root;
    const c2 = (v0 - r1 * x0) / (r2 - r1);
    const c1 = x0 - c2;
    const e1 = Math.exp(r1 * t);
    const e2 = Math.exp(r2 * t);
    x = c1 * e1 + c2 * e2;
    v = c1 * r1 * e1 + c2 * r2 * e2;
  } else {
    // Critically damped: the repeated-root case. Handled separately because the under-damped form
    // divides by `wd`, which is zero here — the fastest approach with no overshoot, and the shape
    // `calm` and the reduced-motion springs use.
    const decay = Math.exp(-omega * t);
    const c = v0 + omega * x0;
    x = decay * (x0 + c * t);
    v = decay * (c - omega * (x0 + c * t));
  }

  return { value: target + x, velocity: v };
}

/** Whether a spring has arrived and stopped, so the driver can park its rAF loop. */
export function isAtRest(state: SpringState, target: number, scale = 1): boolean {
  const tolerance = Math.max(1, Math.abs(scale));
  return Math.abs(state.value - target) < REST_DISPLACEMENT * tolerance
    && Math.abs(state.velocity) < REST_VELOCITY * tolerance;
}

/** Park a spring exactly on its target. Used when settling, and under reduced motion. */
export function settle(target: number): SpringState {
  return { value: target, velocity: 0 };
}
