import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/cn';
import { easingFunction, prefersReducedMotion, springFor, type SpringPreset } from './motion';
import { recentIntentRect } from './intent';

/**
 * A surface that grows out of the thing you clicked, and shrinks back into it when dismissed.
 *
 * A modal that fades in at the centre of the screen makes the user re-find their place: nothing
 * connects the control they pressed to the surface that appeared. Seeding the expansion from the
 * click keeps that thread — the button *is* the window, mid-flight — and the reverse on close puts
 * them back exactly where they were looking. The industry calls this a container transform or a
 * shared-element transition; Apple ships it as the zoom transition. Here it is a *seed*.
 *
 * Built on Radix Dialog rather than a bare portal so the boring, load-bearing parts are still real:
 * focus trap, `aria-modal`, focus restore to the trigger, Escape. Only the motion is ours.
 *
 * ## Why it animates the way it does
 *
 * This is a FLIP: the panel is laid out at its FINAL geometry, then inverted onto the seed rect and
 * played to identity, so the browser only ever animates `transform`/`opacity` — the constraint the
 * rest of the motion system already holds itself to.
 *
 * The seed and the panel have very different aspect ratios (a round button is square and tiny; the
 * panel is a wide sheet), so the inverse transform is non-uniform. Scaling text by 0.6 x 0.15 and
 * letting it stretch back is the classic way this effect looks cheap, so two things prevent it:
 *
 *   1. the content wrapper counter-scales by the EXACT inverse at every instant — not by
 *      interpolating between two inverse endpoints, which is only correct at the endpoints and is
 *      off by 2x in the middle of a big flight (see `inverseScaleKeyframes`), and
 *   2. content does not appear until the box is most of the way open — there is nothing to distort
 *      during the part of the flight where the distortion is largest.
 *
 * What the user reads is: the control became the window, and its contents arrived once there was
 * room.
 */

/** The measured origin of an expansion. Null means "no seed" — fall back to a plain fade. */
export type Seed = DOMRect | null;

/** A rect, structurally — so the geometry can be exercised without a layout engine. */
export interface Box { left: number; top: number; width: number; height: number }

/** Where a seeded surface lands. The bars are edge-anchored; everything else is centred. */
export type Placement = 'center' | 'left' | 'right';

/**
 * Capture the rect of whatever was clicked.
 *
 * Returns the handler AND the live seed so a caller can dim the source element while its content is
 * "away" — two copies of the same card on screen is the one thing that breaks the illusion.
 */
export function useSeed(): {
  seed: Seed;
  seedFrom: (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => void;
  clearSeed: () => void;
} {
  const [seed, setSeed] = useState<Seed>(null);
  const seedFrom = useCallback((event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    setSeed(event.currentTarget.getBoundingClientRect());
  }, []);
  const clearSeed = useCallback(() => setSeed(null), []);
  return { seed, seedFrom, clearSeed };
}

/**
 * The inverse transform that puts `to` exactly on top of `seed`.
 *
 * Pure, and exported, because this is the half that can silently be wrong: a sign error or a
 * corner-based (rather than centre-based) delta still produces a smooth, plausible animation that
 * simply flies in from the wrong place. `transform-origin` is the panel's own centre, so matching
 * CENTRES — not corners — is what lands it on the seed.
 *
 * The scale floor keeps a zero-height seed (a row scrolled out of view, a collapsed container) from
 * producing a degenerate `scale(0)` that some compositors drop entirely. The ceiling is the mirror
 * case: a seed larger than the panel it opens (a whole sidebar collapsing into a dialog) would
 * otherwise launch the panel at 12x and fill the screen with a smear on frame one.
 */
export function seedTransform(seed: Box, to: Box): { dx: number; dy: number; scaleX: number; scaleY: number } {
  return {
    scaleX: Math.min(Math.max(seed.width / to.width, 0.04), 8),
    scaleY: Math.min(Math.max(seed.height / to.height, 0.04), 8),
    dx: (seed.left + seed.width / 2) - (to.left + to.width / 2),
    dy: (seed.top + seed.height / 2) - (to.top + to.height / 2),
  };
}

/** How big a seeded surface wants to be, before the window gets a say. */
export interface PanelSizing {
  /** Preferred width in px. */
  width: number;
  /** Ceiling on height, as a fraction of the viewport. */
  heightRatio: number;
  /** Breathing room between the panel and the window edge, when there is room for it. */
  margin: number;
}

export const DEFAULT_SIZING: PanelSizing = { width: 560, heightRatio: 0.78, margin: 28 };

/**
 * The panel's final rect for a given window.
 *
 * This is the whole window-size story in one pure function, and it is a function rather than a
 * clamp() in CSS because the flight needs the same numbers the layout gets — a panel that CSS sizes
 * one way and the transform assumes another flies to the wrong place, smoothly.
 *
 * The ordering matters and is the part worth pinning:
 *
 *   1. Margin yields first. On a 320px-wide window a fixed 28px gutter each side leaves 264px for a
 *      560px panel, so the margin collapses toward zero instead of the panel going negative.
 *   2. Width and height are then clamped to what actually remains.
 *   3. The result is centred, then nudged back inside the viewport.
 *
 * Step 3 is not redundant with step 2: rounding a half-pixel centre on an odd-width window pushes
 * one edge out by a fraction, and a panel whose left edge is -0.5 has a visible hairline of
 * scrollbar on macOS.
 */
export function panelBox(
  viewport: { width: number; height: number },
  sizing: PanelSizing = DEFAULT_SIZING,
  placement: Placement = 'center',
): Box {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);

  // The gutter the window can actually afford, per axis. Never more than 40% of the axis, so a very
  // narrow window still shows a panel rather than two margins with a sliver between them.
  const gutterX = Math.min(sizing.margin, width * 0.2);
  const gutterY = Math.min(sizing.margin, height * 0.2);

  if (placement !== 'center') {
    // A bar owns its edge and the full height: it is a region of the window, not a sheet floating
    // over it. Only its width negotiates.
    const barWidth = Math.min(sizing.width, width);
    return {
      left: placement === 'left' ? 0 : width - barWidth,
      top: 0,
      width: barWidth,
      height,
    };
  }

  const panelWidth = Math.min(sizing.width, width - gutterX * 2);
  const panelHeight = Math.min(height * sizing.heightRatio, height - gutterY * 2);

  const left = Math.round((width - panelWidth) / 2);
  const top = Math.round((height - panelHeight) / 2);

  return {
    left: Math.min(Math.max(left, 0), Math.max(0, width - panelWidth)),
    top: Math.min(Math.max(top, 0), Math.max(0, height - panelHeight)),
    width: panelWidth,
    height: panelHeight,
  };
}

/**
 * Move a seed inside a container without changing its size.
 *
 * The bars need this and the dialogs do not, because a dialog is portalled and can fly across the
 * whole window, while a bar is a column in a resizable layout whose panel clips its own overflow.
 * A sidebar seeded from a toggle button in the title bar would spend the first half of its flight
 * outside its column — which is to say, invisible — and then appear from the clipped edge. What the
 * user would read is not "the button unfolded", it is "something slid in from the top", which is
 * the animation this whole mechanism exists to replace.
 *
 * So the origin is projected to the nearest point inside the column. The flight then starts from
 * the corner closest to the control that opened it: press the toggle at the top-left and the
 * sidebar grows out of its own top-left corner. The direction still points back at the trigger,
 * which is the part the eye actually follows, and nothing is ever clipped.
 *
 * A seed larger than the container is shrunk to fit first — otherwise there is no position that
 * satisfies "inside", and clamping alone would silently leave it hanging out of one edge.
 */
export function projectSeedInto(seed: Box, container: Box): Box {
  const width = Math.min(seed.width, container.width);
  const height = Math.min(seed.height, container.height);
  return {
    width,
    height,
    left: Math.min(Math.max(seed.left, container.left), container.left + container.width - width),
    top: Math.min(Math.max(seed.top, container.top), container.top + container.height - height),
  };
}

/**
 * The content layer's counter-scale, sampled against the panel's own easing.
 *
 * The naive version animates the content from `scale(1/sx)` to `scale(1)` on the same curve as the
 * panel and calls it inverse. It is not: the compositor interpolates both scale VALUES linearly
 * between their endpoints, and 1/x is not linear. Halfway through a flight with sx = 0.15 the panel
 * sits at 0.575 while the "inverse" sits at 3.83 — a product of 2.2, so every glyph is more than
 * twice its intended size at the moment the user is most likely to be looking at it.
 *
 * Sampling fixes it exactly. At each uniform time t we evaluate the panel's easing to get its real
 * progress, compute the scale the panel will actually have at that instant, and emit its true
 * reciprocal. The keyframes are then played with a LINEAR easing so the samples land on the clock
 * they were computed for.
 *
 * `stops` is the sample count; between them the compositor interpolates linearly, which is a chord
 * across a very short arc of 1/x and stays sub-pixel.
 */
export function inverseScaleKeyframes(
  scaleX: number,
  scaleY: number,
  easing: string,
  stops = 32,
): { offset: number; scaleX: number; scaleY: number }[] {
  const progress = easingFunction(easing);
  const frames: { offset: number; scaleX: number; scaleY: number }[] = [];
  for (let i = 0; i <= stops; i++) {
    const offset = i / stops;
    const p = progress(offset);
    // What the panel's transform genuinely is at this instant, on this curve.
    const panelX = scaleX + (1 - scaleX) * p;
    const panelY = scaleY + (1 - scaleY) * p;
    frames.push({
      offset,
      // A spring can overshoot past its target but never through zero, so this floor is a guard
      // against a degenerate input (a caller passing 0), not against the physics.
      scaleX: 1 / Math.max(panelX, 0.001),
      scaleY: 1 / Math.max(panelY, 0.001),
    });
  }
  return frames;
}

/** The opacity ramp for content riding a seeded flight. */
function contentOpacity(offset: number, growing: boolean): number {
  // Growing: stay invisible while the box is at its most distorted, then arrive once there is room.
  // Shrinking: leave early, so what flies home is an empty card rather than shrinking text.
  return growing
    ? (offset < 0.5 ? 0 : Math.min(1, (offset - 0.5) / 0.35))
    : (offset > 0.35 ? 0 : 1 - offset / 0.35);
}

function flight(
  panel: HTMLElement,
  content: HTMLElement | null,
  seed: DOMRect,
  direction: 'grow' | 'shrink',
  preset: SpringPreset,
): { animations: Animation[]; duration: number } {
  const to = panel.getBoundingClientRect();
  if (!to.width || !to.height) return { animations: [], duration: 0 };

  const { dx, dy, scaleX, scaleY } = seedTransform(seed, to);

  // The spring is chosen from the surface it has to move — a 40px pill and a 900px sheet get the
  // same character at different weights. See springFor().
  const spring = springFor(preset, Math.hypot(to.width, to.height));
  const growing = direction === 'grow';
  // Leaving is faster than arriving. The user has already decided; the flight is an acknowledgement,
  // not a presentation, and a full spring settle on the way out reads as the app being slow to obey.
  const duration = growing ? spring.duration : Math.round(spring.duration * 0.62);
  // Nothing bounces on the way out either: an overshoot on close means the panel grows briefly
  // after the user dismissed it.
  const easing = growing ? spring.easing : 'cubic-bezier(0.4, 0.0, 0.9, 0.35)';

  const seeded: Keyframe = {
    transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`,
    opacity: 0.4,
    // The seed's own radius, so the corners look continuous with the control it came from.
    borderRadius: '999px',
  };
  const settled: Keyframe = {
    transform: 'translate(0px, 0px) scale(1, 1)',
    opacity: 1,
    borderRadius: '22px',
  };

  const animations = [panel.animate(
    growing ? [seeded, settled] : [settled, seeded],
    { duration, easing, fill: 'both' },
  )];

  if (content) {
    const frames = inverseScaleKeyframes(scaleX, scaleY, easing);
    animations.push(content.animate(
      (growing ? frames : [...frames].reverse().map((f, i) => ({ ...f, offset: i / (frames.length - 1) })))
        .map((frame) => ({
          offset: frame.offset,
          transform: `scale(${frame.scaleX}, ${frame.scaleY})`,
          opacity: contentOpacity(frame.offset, growing),
        })),
      // Linear, deliberately: the frames were sampled against the panel's curve already, and
      // applying that curve a second time here would square it.
      { duration, easing: 'linear', fill: 'both' },
    ));
  }

  return { animations, duration };
}

/**
 * Play a seeded flight on an arbitrary element.
 *
 * The primitive behind both seeded surfaces: `SeedPanel` (a modal sheet) and the bars, which are
 * layout regions and cannot be portalled. Returns a canceller and the flight's real duration so the
 * caller can time an unmount against it.
 */
export function playSeedFlight(
  panel: HTMLElement,
  content: HTMLElement | null,
  seed: DOMRect,
  direction: 'grow' | 'shrink',
  preset: SpringPreset = 'glass',
): { cancel: () => void; finished: Promise<void>; duration: number } {
  const { animations, duration } = flight(panel, content, seed, direction, preset);
  return {
    duration,
    cancel: () => animations.forEach((animation) => { try { animation.cancel(); } catch { /* gone */ } }),
    finished: Promise.all(animations.map((animation) => animation.finished)).then(() => undefined),
  };
}

/**
 * The expanding panel.
 *
 * `open` is the caller's intent; the component keeps the content mounted past `open === false` for
 * exactly as long as the collapse takes, so the panel can fly home instead of vanishing.
 */
export function SeedPanel({
  open, onClose, seed, title, description, className, preset = 'glass', locked, children,
}: {
  open: boolean;
  onClose: () => void;
  seed: Seed;
  title: string;
  /** Screen-reader description. Visually the panel's own header carries the context. */
  description?: string;
  className?: string;
  /** Which spring. Small popovers want `bouncy`; sheets and windows want `glass`. */
  preset?: SpringPreset;
  /** Blocks Escape and outside-click, for prompts the engine is genuinely waiting on. */
  locked?: boolean;
  children: React.ReactNode;
}): React.ReactElement | null {
  // `open` from the caller vs `mounted` here: the gap between them is the collapse.
  const [mounted, setMounted] = useState(open);
  /*
    State, not refs — Radix's `Portal` renders `null` on its first commit (it defers to a layout
    effect so SSR has no `document.body` to reach for), so a layout effect here reading `ref.current`
    sees null and, because its dependencies never change again, never retries. The flight would
    simply never start. A callback ref writing to state makes "the node exists" a dependency.
  */
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const seedRef = useRef<Seed>(seed);
  if (open) seedRef.current = seed;

  useLayoutEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Grow. useLayoutEffect so the inverted first frame is committed before paint — starting one frame
  // late is exactly the flash of a full-size panel this whole component exists to avoid.
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const origin = seedRef.current;
    if (!panel || !origin || prefersReducedMotion()) return;
    const flown = playSeedFlight(panel, content, origin, 'grow', preset);
    // A window that is not painting does not advance animations, and `fill: both` would pin the
    // panel at its INVERTED first frame — a sliver at 40% opacity, indefinitely. Snap to the end
    // state on a wall clock so a frozen renderer yields a plain visible panel, never a stuck one.
    const settle = window.setTimeout(() => flown.cancel(), flown.duration + 200);
    return () => {
      window.clearTimeout(settle);
      flown.cancel();
    };
  }, [open, mounted, preset, panel, content]);

  // Collapse, then unmount.
  useLayoutEffect(() => {
    if (open || !mounted) return;
    const origin = seedRef.current;
    if (!panel || !origin || prefersReducedMotion()) { setMounted(false); return; }
    let done = false;
    const finish = (): void => { if (!done) { done = true; setMounted(false); } };
    const flown = playSeedFlight(panel, content, origin, 'shrink', preset);
    flown.finished
      .then(finish)
      .catch(() => { /* cancelled by a re-open mid-flight; the timer below still releases it */ });
    // The unmount must NOT be the animation's to grant. When the window stops painting, `finished`
    // never resolves — and because the overlay is still mounted, the user is left staring at an
    // opaque scrim over the whole app with no way back. Measured here on 2026-08-15 as a fully
    // black window. A wall clock is the authority; the promise is only the fast path.
    const guard = window.setTimeout(finish, flown.duration + 200);
    return () => {
      done = true;
      window.clearTimeout(guard);
      flown.cancel();
    };
  }, [open, mounted, preset, panel, content]);

  if (!mounted) return null;

  const block = locked ? (event: { preventDefault: () => void }) => event.preventDefault() : undefined;

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal forceMount>
        <DialogPrimitive.Overlay
          forceMount
          className={cn(
            'fixed inset-0 z-50 bg-[#0a0807]/45 backdrop-blur-[3px]',
            open ? 'anim-fade-in' : 'anim-fade-out',
          )}
        />
        <DialogPrimitive.Content
          forceMount
          ref={setPanel}
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex flex-col',
            // The window-size contract, mirrored from panelBox(): the margin yields before the
            // panel does, so a 320px window shows a panel rather than two gutters and a sliver.
            'max-h-[78vh] w-[min(560px,calc(100vw-min(56px,40vw)))]',
            // No Tailwind entrance animation here: the flight owns this element's transform, and a
            // second animation on the same property silently wins or loses depending on order.
            'liquid-glass liquid-glass-panel overflow-hidden rounded-[22px]',
            'focus:outline-none',
            className,
          )}
          style={{
            // Radix centres with a translate; the flight animates `transform`. Keeping the centring
            // on the separate `translate` property means the two compose instead of fighting.
            translate: '-50% -50%',
            transformOrigin: 'center center',
            willChange: 'transform, opacity',
          }}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
          ) : null}
          <div ref={setContent} className="flex min-h-0 flex-1 flex-col" style={{ transformOrigin: 'center center' }}>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * A seeded layout region — the left and right bars.
 *
 * Same flight, no portal and no scrim: a bar is part of the window, so it must animate in place
 * inside the layout it belongs to. It renders nothing of its own; it only drives the child.
 *
 * The bars seed from their toggle button, so opening the sidebar looks like the toggle unfolding
 * into a panel and closing looks like the panel folding back onto the toggle — the same
 * relationship a dialog has with the row that opened it.
 */
export function SeedRegion({
  open, seed, preset = 'glass', className, onCollapsed, children,
}: {
  open: boolean;
  /**
   * The origin. Omit it to use whatever the user last pressed (`./intent`) — which is what the bars
   * do, since their triggers live in the title bar and threading a rect down would mean the title
   * bar owning a piece of the sidebar's animation.
   */
  seed?: Seed;
  preset?: SpringPreset;
  className?: string;
  /** Fired when the collapse has finished, so the parent can drop the region from the layout. */
  onCollapsed?: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const regionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const seedRef = useRef<Seed>(null);
  // The latest callback, read at fire time. The effect below must not list `onCollapsed` as a
  // dependency — parents pass an inline arrow, so it is a new function on every render, and
  // depending on it restarts the flight from its seed on every unrelated keystroke in the app.
  const collapsedRef = useRef(onCollapsed);
  collapsedRef.current = onCollapsed;

  useLayoutEffect(() => {
    const region = regionRef.current;
    if (open) seedRef.current = seed ?? recentIntentRect();
    const raw = seedRef.current;
    if (!region || !raw || prefersReducedMotion()) {
      if (!open) collapsedRef.current?.();
      return;
    }
    // Into its own column, so the flight is never clipped — see projectSeedInto().
    const bounds = region.getBoundingClientRect();
    const inside = projectSeedInto(raw, bounds);
    const origin = new DOMRect(inside.left, inside.top, inside.width, inside.height);

    const flown = playSeedFlight(region, contentRef.current, origin, open ? 'grow' : 'shrink', preset);
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (!open) collapsedRef.current?.();
    };
    flown.finished.then(finish).catch(() => { /* re-toggled mid-flight; the guard still fires */ });
    const guard = window.setTimeout(finish, flown.duration + 200);
    return () => {
      done = true;
      window.clearTimeout(guard);
      flown.cancel();
    };
  }, [open, preset, seed]);

  return (
    <div
      ref={regionRef}
      className={cn('h-full', className)}
      style={{ transformOrigin: 'center center', willChange: 'transform, opacity' }}
    >
      <div ref={contentRef} className="h-full" style={{ transformOrigin: 'center center' }}>
        {children}
      </div>
    </div>
  );
}
