# Seed Morph — Phase A/B audit

Answers the two questions the brief demands before any code changes: *what is BiMAX actually built
from* (Prompt 2 §1) and *what does the installed Apple SDK actually offer* (Prompt 2 §2). Measured
2026-08-15 on this machine, not assumed.

---

## A. What BiMAX actually is

| Layer | Reality |
|---|---|
| Shell | **Electron 43** (`electron-vite`), `app/src/main` |
| Renderer | **React 18 + Tailwind v4 + Radix** — web-rendered, `app/src/renderer` |
| Editor / terminal | CodeMirror 6, xterm.js — web |
| Native code | **only** the computer-use XPC service (`app/native-service/BimaxCuService.xpc`) and the engine sidecar |
| Animation deps | **none**. No framer-motion, no `motion`, no GSAP |
| Existing motion | hand-built: `components/ui/motion.ts` (spring → CSS `linear()` compiler) and `components/ui/seed-expand.tsx` (FLIP seed morph) |

So: **the entire user interface is web-rendered.** There is no AppKit view hierarchy, no SwiftUI, no
`NSHostingView`, no native toolbar or sidebar. The only native surface in the product is a headless
XPC service for driving other apps.

### What that means for Prompt 2

Prompt 2 is written for a native Mac app and repeatedly names Apple APIs. Honestly reported:

- `NSGlassEffectView`, `NSGlassEffectContainerView`, `effectIsInteractive`, SwiftUI `glassEffect` /
  `GlassEffectContainer`, `NSViewCornerConfiguration.containerConcentric`, `appearsActive`,
  toolbar `visibilityPriority` / `ToolbarOverflowMenu` — **none of these are reachable from BiMAX's
  UI code.** They govern AppKit/SwiftUI view trees. BiMAX's views are DOM.
- Prompt 2 §1 is explicit: *"Do NOT rewrite the entire application into SwiftUI… Preserve the
  existing architecture unless a change provides a clear technical benefit."* Rewriting a shipped
  Electron IDE into AppKit to obtain a corner-radius API is not that.

**Resolution adopted:** every Apple API named in Prompt 2 is honoured as a *behaviour contract*
implemented in TS/CSS, not as an import. Concentric corners become a radius function; interactive
glass becomes a pointer-state material; `appearsActive` becomes an Electron `blur`/`focus` →
`data-window-active` attribute; toolbar priority becomes explicit tiers. Where a behaviour genuinely
cannot be reproduced in Chromium it is recorded here rather than faked.

Native things Electron *does* give us and that are worth using (Prompt 2 §100/§101): vibrancy on the
`BrowserWindow`, `systemPreferences.getAccentColor()`, `nativeTheme` (dark mode, **and**
`shouldUseHighContrastColors`), traffic-light position, and the native menu bar. Those are host-layer
wins that don't require a rewrite.

---

## B. Installed Apple platform — measured

```
ProductVersion : 26.5.2   (macOS 26, NOT 27)
BuildVersion   : 25F84
Xcode          : 26.6 (17F113)
macOS SDK      : 26.5
```

Prompt 2 targets "macOS 27 / Apple 2027" and says (§2) *"If the local SDK contradicts assumptions in
this prompt: the installed current Apple SDK/documentation wins."* It does contradict them:

- **`NSGlassEffectView` — exists** in the 26.5 SDK
  (`AppKit.framework/Headers/NSGlassEffectView.h`). Liquid Glass is a macOS 26 feature, so the
  material is real on this machine; it is the *macOS 27 refinements* that are not.
- **`NSViewCornerConfiguration` / `containerConcentric` — absent** from the 26.5 SDK. The concentric
  corner API Prompt 2 §10 leans on does not exist here even for a native app. It is implemented
  from first principles instead (`concentricRadius()`), which is the same arithmetic Apple's API
  performs: `inner = outer − inset`, floored.
- **`xcrun agent skills export` — not available.** `xcrun mcpbridge run-agent skills export` is the
  actual entry point in Xcode 26.6. Not used: nothing in it applies to a Chromium renderer, and
  Prompt 2 §2 warns against committing generated skill files.

Consequence: **macOS 27-specific claims in Prompt 2 are treated as design direction, not as APIs to
call.** They describe where Apple is going, and BiMAX can move the same way in CSS.

---

## C. Reference repo (Prompt 1, "study the motion characteristics")

`github.com/Jakubantalik/Libraries` — two packages, `border-beam` and `liquid-gooey`.

The finding that matters: **BiMAX's `motion.ts` is already a harvest of `liquid-gooey/src/spring.ts`**
and has since improved on it — presets named by damping *ratio* ζ instead of raw damping (so bounce
is portable across stiffness), size-graded springs, and a sample placed exactly on the spring's peak
so the compiled `linear()` doesn't shave the overshoot. Nothing left to take there.

Two techniques in `observer.ts` are still worth taking, and are what Prompt 1 §31/§32 is describing:

1. **Velocity stretch**: `stretch = min(maxStretch, speed × k)` applied along the velocity axis.
   Its default cap is `0.18` — 18%, correct for a gooey droplet and far too much for a Mac control.
   BiMAX caps at **3%** (Prompt 2 §51: *velocity perceived, not deformation observed*).
2. **Anchored stretch, not translation**: scale from the *trailing* edge so the leading edge runs
   ahead — which is exactly Prompt 1 §6's "one edge stays connected to the source".

Also confirmed from its comments: driving geometry from a **single shared rAF clock** (rather than
letting a compositor transition run independently) is what stops content tearing away from its own
surface during a main-thread stall. That argument applies directly here — BiMAX stalls the main
thread routinely, because it streams tokens.

---

## D. Seed Morph v1 — what already works

`seed-expand.tsx` + `intent.ts` are not a stub. Already correct, and kept:

- Real `getBoundingClientRect()` origins, never hard-coded coordinates (§2, §38).
- A capture-phase intent tracker with a **freshness window** — so an engine-raised prompt that
  nobody clicked honestly fades instead of falsely flying out of some button (§45's principle,
  arrived at independently).
- `panelBox()` — destination computed from the real viewport, margin yields before the panel does
  (§21).
- `projectSeedInto()` — a seed outside a clipping column is projected to its nearest inside point,
  so a bar's flight is never clipped (§23, §24).
- Exact reciprocal counter-scale sampled against the panel's own curve, rather than interpolating
  between two inverse endpoints (which is off by 2× mid-flight).
- Wall-clock guards on every flight, because a renderer that stops painting never resolves
  `Animation.finished` and would strand the user under an opaque scrim.

## E. Gaps — this is what v2 has to add

| # | Gap | Brief |
|---|---|---|
| 1 | **Not retargetable.** WAAPI keyframes are compiled at launch; an interrupt cancels and restarts *from the seed*. Velocity is lost. | P1 §9 §20, P2 §9 §78 §79 |
| 2 | **Radius is faked.** Hard-coded `999px → 22px`, riding a non-uniformly scaled box — so the corner is a wrong-sized ellipse for the whole flight. | P1 §7, P2 §10 §11 |
| 3 | **No concentric geometry.** Nothing relates a destination's corner to its container. | P2 §10 §11 §97 |
| 4 | **No velocity deformation.** | P1 §31 §32, P2 §51 |
| 5 | **Source never re-measured.** Open → resize → the reverse flies to a stale rect. | P1 §22, P2 §25 §79 |
| 6 | **Reduced motion = no motion.** The code returns early and the surface just appears — the brief asks for a *shortened* morph that keeps continuity. | P1 §27, P2 §32 |
| 7 | **Material is static** through the flight; only the box scales. | P1 §11 |
| 8 | **No destination semantics.** Every surface is "panel". | P2 §43–§48 |
| 9 | **Distance not in the physics** — springs grade on size only. | P1 §29 |
| 10 | **No debug overlay, no interruption/perf drills** in the harness. | P1 §34 §35, P2 §112 §116 |
| 11 | **Content is counter-scaled**, which works but is the fragile way; the brief prefers morphing the container and revealing content inside it. | P1 §13 |

## F. Decisions

1. **Extend, do not fork** (P1 §36 — "do not create duplicate animation systems"). `motion.ts` keeps
   owning CSS micro-motion: press, hover, selection, fades. It is the right tool there and it is
   already good. Only the *morph* moves to a new driver.
2. **The morph animates real geometry, not a FLIP transform.** A shell element at
   `position: fixed` with animated `width`/`height`/`translate`/`border-radius`, containing content
   laid out at final size and merely revealed. This is what P1 §13 asks for literally ("morph the
   container geometry, then reveal destination content within that geometry"), and it is the only
   way radius can interpolate honestly — gap 2 and 3 are unfixable under a scaled box. It also
   deletes the counter-scale from the morph path, so text is never resampled.
   *Cost:* per-frame layout on the shell. Contained (`contain: layout paint`, fixed position, no
   in-flow siblings) and measured in the lab under streaming load before it ships anywhere real.
3. **One shared rAF clock** for every live morph, read-then-write batched (P1 §26).
4. **Springs are retargetable state** (position + velocity + target), not compiled timelines — the
   single change that makes gaps 1, 4, 5 and 6 tractable at once.
