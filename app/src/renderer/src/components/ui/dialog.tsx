import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from './motion';
import { playSeedFlight, type Seed } from './seed-expand';
import { clearIntent, recentIntentRect } from './intent';

/**
 * shadcn-pattern Dialog on Radix primitives — real focus trap, aria-modal, focus restore.
 * `locked` disables Esc/overlay dismissal: the engine's prompt round-trips (governor veto, diff
 * approval) block the agent loop until answered, so the modal must not silently close.
 *
 * ## The seeded flight lives here, not in each dialog
 *
 * Every dialog in the app renders `<Dialog open><DialogContent className=…>`. Putting the container
 * transform in this one component means all of them grow out of the control that opened them and
 * shrink back into it on close, and a dialog added later gets it without opting in — which is the
 * only version of "every component has the same animation" that stays true after this change.
 *
 * The origin comes from `./intent`, which watches what the user actually pressed. A dialog that
 * nobody triggered (an engine approval prompt arriving on its own) finds no fresh intent and plainly
 * fades, because flying out of an unrelated button would be a false claim about what caused it.
 *
 * ## Why there are two boxes
 *
 * The flight scales the surface non-uniformly — a 32px round button is square, a settings window is
 * a wide sheet — so the content must counter-scale by the inverse or every glyph stretches. That
 * needs a second element, and it cannot be inserted *around* the caller's children: dialogs put
 * their layout on `DialogContent` (`flex flex-row` for Settings' nav-plus-page, `flex flex-col` for
 * Models) and address their children directly, so a box between them collapses the layout to a
 * single item.
 *
 * So the split runs the other way. The OUTER element is the flight shell — position, material,
 * radius, the animated transform — and it shrink-wraps. The INNER element is the caller's box: it
 * takes `className`, `style` and the children, exactly as `DialogContent` used to, and carries the
 * counter-scale. Callers that need different anchoring pass `positionClassName`, which is the one
 * concern that genuinely belongs to the shell.
 *
 * ## Why this manages its own mounting
 *
 * Radix's `Presence` keeps a closing element mounted by watching for a CSS *animation* to end. The
 * flight is a WAAPI animation over a geometry only known at runtime, which Presence cannot see — so
 * a plain `<DialogContent>` would be torn out of the DOM on the first frame of its own exit. Hence
 * `forceMount` throughout and an explicit `mounted` state here: `open` is the caller's intent, and
 * the gap between `open === false` and `mounted === false` is exactly the collapse.
 */

/** Lets `DialogContent` see the open state that `Dialog` was given, so it can own the exit. */
const OpenContext = React.createContext<boolean>(false);

export function Dialog({
  open = false, children, ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>): React.ReactElement {
  return (
    <OpenContext.Provider value={open}>
      <DialogPrimitive.Root open={open} {...props}>{children}</DialogPrimitive.Root>
    </OpenContext.Provider>
  );
}

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    locked?: boolean;
    /**
     * Anchoring for the shell, when centred is wrong. The command palette sits high on the screen
     * the way Spotlight does, so it passes `top-[18%] -translate-y-0`.
     */
    positionClassName?: string;
  }
>(({ className, style, locked, positionClassName, children, ...props }, forwardedRef) => {
  const open = React.useContext(OpenContext);
  const [mounted, setMounted] = React.useState(open);
  /*
    The nodes live in state, not in refs, and that is load-bearing.

    Radix's `Portal` returns `null` on its own first render — it sets a `mounted` flag in a layout
    effect so that server rendering has no `document.body` to reach for. So on the commit where this
    component first renders its tree, the content element does NOT exist yet, and a layout effect
    reading `ref.current` here sees null. A ref would then never be revisited: the effect's
    dependencies have not changed by the time the portal actually mounts, so the flight is simply
    never started and every dialog silently falls back to appearing. (Measured exactly that.)

    A callback ref that writes to state turns "the node arrived" into a render, which is a
    dependency the effect can wait on.
  */
  const [shell, setShell] = React.useState<HTMLDivElement | null>(null);
  const [box, setBox] = React.useState<HTMLDivElement | null>(null);
  const seedRef = React.useRef<Seed>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    setMounted(true);
    // Claimed here, on the commit where the caller opened us — the freshest possible moment, and
    // before the portal costs us a frame. Cleared so a second surface opening from the same press
    // cannot also claim it.
    seedRef.current = recentIntentRect();
    clearIntent();
  }, [open]);

  // Grow, once the portal has actually produced a node.
  React.useLayoutEffect(() => {
    if (!open || !mounted) return;
    const origin = seedRef.current;
    if (!shell || !origin || prefersReducedMotion()) return;
    const flown = playSeedFlight(shell, box, origin, 'grow', 'glass');
    // `fill: both` would pin the shell at its INVERTED first frame if the renderer stops painting —
    // a sliver at 40% opacity, indefinitely. A wall clock releases it to the plain visible state.
    const settle = window.setTimeout(() => flown.cancel(), flown.duration + 200);
    return () => {
      window.clearTimeout(settle);
      flown.cancel();
    };
  }, [open, mounted, shell, box]);

  // Collapse, then unmount.
  React.useLayoutEffect(() => {
    if (open || !mounted) return;
    const origin = seedRef.current;
    if (!shell || !origin || prefersReducedMotion()) { setMounted(false); return; }
    let done = false;
    const finish = (): void => { if (!done) { done = true; setMounted(false); } };
    const flown = playSeedFlight(shell, box, origin, 'shrink', 'glass');
    flown.finished.then(finish).catch(() => { /* re-opened mid-flight; the guard still releases it */ });
    // The unmount is NOT the animation's to grant. A window that stops painting never resolves
    // `finished`, and with the overlay still mounted the user is left under an opaque scrim with no
    // way back. The wall clock is the authority; the promise is only the fast path.
    const guard = window.setTimeout(finish, flown.duration + 200);
    return () => {
      done = true;
      window.clearTimeout(guard);
      flown.cancel();
    };
  }, [open, mounted, shell, box]);

  if (!mounted) return null;

  const block = locked ? (event: { preventDefault: () => void }) => event.preventDefault() : undefined;
  // Peeked, not read back from the ref. The ref is filled by the layout effect below, which runs
  // AFTER this render — so reading it here reported "no seed" on the opening frame and shipped the
  // fallback CSS animation alongside the flight that was about to start, putting two animations on
  // one `transform`. `recentIntentRect()` is a pure read of an already-captured rect, so asking it
  // the same question a moment earlier gives the same answer.
  const seeded = !prefersReducedMotion() && (open ? recentIntentRect() !== null : seedRef.current !== null);

  return (
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
        ref={mergeRefs(setShell, forwardedRef)}
        onEscapeKeyDown={block}
        onPointerDownOutside={block}
        onInteractOutside={block}
        className={cn(
          'fixed top-1/2 left-1/2 z-50',
          // Tailwind v4 writes these to the native `translate` property, which composes with
          // `transform` rather than overwriting it — so the centring and the flight coexist, and a
          // caller can still cancel one axis (`-translate-y-0`) without touching the other.
          '-translate-x-1/2 -translate-y-1/2',
          // Only when there is no flight to own the transform. Two animations on one property is a
          // race decided by declaration order, and the loser is invisible.
          !seeded && (open ? 'anim-dialog-in' : 'anim-dialog-out'),
          'liquid-glass liquid-glass-panel overflow-hidden rounded-[22px]',
          'focus:outline-none',
          positionClassName,
        )}
        style={{ transformOrigin: 'center center', willChange: 'transform, opacity' }}
        {...props}
      >
        {/*
          The caller's box, unchanged from what `DialogContent` used to be: its className, its style,
          its children as direct descendants. It additionally carries the counter-scale, which is why
          it must be a real element and not `display: contents`.
        */}
        <div
          ref={setBox}
          className={cn('max-h-[80vh] w-[min(680px,calc(100vw-min(64px,40vw)))] overflow-y-auto p-5', className)}
          style={{ transformOrigin: 'center center', ...style }}
        >
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = 'DialogContent';

/** Radix hands callers a ref to the content node; the flight needs the same node. */
function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value);
      else if (ref) (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}
