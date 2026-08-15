import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/cn';
import { destinationFor, type DestinationKind, type MorphGeometry } from './morph/geometry';
import { useMorphDriver } from './morph/use-morph';
import { useIntentSeed } from './morph/use-seed';

/**
 * shadcn-pattern Dialog on Radix primitives — real focus trap, aria-modal, focus restore.
 * `locked` disables Esc/overlay dismissal: the engine's prompt round-trips (governor veto, diff
 * approval) block the agent loop until answered, so the modal must not silently close.
 *
 * ## The seeded flight lives here, not in each dialog
 *
 * Every dialog in the app renders `<Dialog open><DialogContent className=…>`. Putting the container
 * morph in this one component means all of them grow out of the control that opened them and shrink
 * back into it on close, and a dialog added later gets it without opting in — which is the only
 * version of "every component has the same animation" that stays true after this change.
 *
 * The origin comes from `./morph/use-seed`, which watches what the user actually pressed. A dialog
 * nobody triggered (an engine approval prompt arriving on its own) finds no fresh intent and
 * materialises in place, because flying out of an unrelated button would be a false claim about
 * what caused it (Prompt 2 §45).
 *
 * ## Why Radix still owns the node
 *
 * The alternative — rendering the dialog *inside* a `MorphSurface` — would put our portal between
 * Radix's Content and its Portal, and Radix's focus trap, `aria-modal`, outside-press detection and
 * focus restore are all things this app relies on and none of them are worth reimplementing for an
 * animation. So the morph drives the node Radix already made: `useMorphDriver` writes the geometry
 * onto `Content` and reveals the box inside it. Radix keeps every guarantee; the motion is ours.
 *
 * ## Why there are two boxes
 *
 * The shell carries the geometry — position, size, radius, material — and the inner box carries the
 * caller's layout. They cannot be one element: dialogs put their layout on `DialogContent`
 * (`flex-row` for Settings' nav-plus-page, `flex-col` for Models) and address their children
 * directly, so a wrapper *inside* would collapse those layouts to a single item. Keeping the split
 * this way round means `className`, `style` and the children still land exactly where they used to.
 *
 * The inner box is also what makes the reveal honest: it is laid out once at the destination's size
 * and then *clipped* by the growing shell (Prompt 1 §13), so no text is ever scaled. v1 had to
 * counter-scale it by the exact inverse at every instant, which worked and was the fragile way.
 *
 * ## Why this manages its own mounting
 *
 * Radix's `Presence` keeps a closing element mounted by watching for a CSS *animation* to end. The
 * collapse is a spring over a geometry only known at runtime, which Presence cannot see — so a
 * plain `<DialogContent>` would be torn out of the DOM on the first frame of its own exit. Hence
 * `forceMount` throughout: `open` is the caller's intent, and the gap between `open === false` and
 * the driver going inactive is exactly the collapse.
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
     * What this surface is, semantically (Prompt 2 §43).
     *
     * Decides where it lands and how it is dressed. `floatingPanel` is the right default for a
     * modal sheet; the command palette passes `palette`, which sits high the way every Mac palette
     * does — placement that used to be a `positionClassName` full of Tailwind offsets that the
     * flight knew nothing about.
     */
    kind?: Extract<DestinationKind, 'floatingPanel' | 'palette' | 'workspaceSurface'>;
  }
>(({ className, style, locked, kind = 'floatingPanel', children, ...props }, forwardedRef) => {
  const open = React.useContext(OpenContext);
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
  const boxNode = React.useRef<HTMLDivElement | null>(null);
  const setBoxNode = React.useCallback((node: HTMLDivElement | null) => {
    boxNode.current = node;
    setBox(node);
  }, []);

  const seed = useIntentSeed();
  /**
   * The width the caller's box wants, measured once from its own CSS.
   *
   * Every dialog states its size in classes — `w-[min(760px,calc(100vw-40px))]` — and the morph
   * needs that as a number, because a spring cannot animate toward `min()`. Measuring beats
   * duplicating it as a prop: a second declaration is a second thing to keep in agreement, and when
   * they disagree the surface flies smoothly to the wrong size, which reads as deliberate.
   *
   * Taken on the opening commit, while the box is still laid out by its own class — after that the
   * width is pinned, and re-reading would only measure the pin.
   */
  const naturalWidth = React.useRef<number | null>(null);
  const [width, setWidth] = React.useState<number | null>(null);

  const resolve = React.useCallback(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const origin = seed.measure();
    const node = boxNode.current;
    if (node && naturalWidth.current === null) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 1) naturalWidth.current = rect.width;
    }
    // Height is measured *live*, every time. The command palette is the reason: its list shrinks as
    // the query filters, and a sheet pinned to the height it opened at would leave a growing block
    // of empty glass under the results. Because this is a spring and not a timeline, a new height
    // is simply a new target — the surface resizes as you type instead of at the end of it.
    const height = node?.getBoundingClientRect().height;
    // `destinationFor` re-clamps against the *current* window every time it is asked, so a window
    // dragged smaller mid-flight shrinks the target rather than leaving the sheet hanging off the
    // edge — the natural size is a preference, not a promise.
    return {
      seed: origin,
      destination: destinationFor(
        { kind, width: naturalWidth.current ?? 560, height: height && height > 1 ? height : undefined },
        viewport,
        origin,
      ),
    };
  }, [kind, seed]);

  const elements = React.useMemo(() => (shell ? { surface: shell, content: box } : null), [shell, box]);

  const { active, controller } = useMorphDriver({
    open,
    kind: () => kind,
    resolve,
    // The box's own height is the target, so a change in it has to reach the spring. Nothing else
    // reports it: filtering a list fires no resize event and moves no window.
    observe: box,
    elements,
  });

  // The box's width as a layout value, set at the edges of a flight rather than per frame — it is
  // laid out once and then merely clipped by the shell growing over it (Prompt 1 §13).
  React.useLayoutEffect(() => {
    if (!active) {
      naturalWidth.current = null;
      setWidth(null);
      return;
    }
    // Nothing to measure yet — the portal above renders null on its first commit. Pinning a
    // fallback width here would be worse than doing nothing: the box would arrive already wearing
    // it, and the "natural" width measured a moment later would be the pin reading itself back.
    if (!box) return;
    setWidth(resolve().destination.width);
  }, [active, box, resolve]);

  React.useEffect(() => {
    if (!active) return;
    const onResize = (): void => {
      setWidth(resolve().destination.width);
      controller()?.remeasure();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active, resolve, controller]);

  if (!active) return null;

  const block = locked ? (event: { preventDefault: () => void }) => event.preventDefault() : undefined;

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
          // No positioning classes: `armSurface` pins this to `fixed; left: 0; top: 0` and the
          // driver writes the real geometry. A `-translate-x-1/2` here would be a second writer of
          // the same property, and whoever writes last silently wins.
          'morph-surface z-50 overflow-hidden',
          'liquid-glass liquid-glass-panel focus:outline-none',
        )}
        {...props}
      >
        {/*
          The caller's box, unchanged from what `DialogContent` used to be: its className, its style,
          its children as direct descendants. Pinned to the destination's size so the layout inside
          settles once, on the first frame, and the shell grows over a surface that is already final
          — which is why nothing here is ever scaled or re-flowed mid-flight.
        */}
        <div
          ref={setBoxNode}
          className={cn('absolute top-0 left-0 max-h-[80vh] w-[min(680px,calc(100vw-min(64px,40vw)))] overflow-y-auto p-5', className)}
          style={width !== null ? { width: `${Math.round(width)}px`, ...style } : style}
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
