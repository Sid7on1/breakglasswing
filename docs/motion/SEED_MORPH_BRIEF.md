# BiMAX Seed Morph — the brief

Source: two prompts from the project owner (2026-08-15). Prompt 1 defines the interaction
primitive; Prompt 2 is an addendum that constrains it to macOS 27 / Apple 2027 platform behaviour.

**Precedence.** Prompt 2 wins over Prompt 1 wherever they conflict on macOS appearance, interaction
conventions, accessibility, native controls, window behaviour, or Liquid Glass. Prompt 1 still owns
the interaction architecture.

This file is the normative transcription kept in-repo so the requirements outlive the chat session.
Section numbers match the original prompts.

---

# PROMPT 1 — LIQUID GLASS SEED MORPH

## The core rule

**The destination UI must visually grow out of the element that triggered it.**

The trigger button and the resulting surface are not two components where one fades out and another
fades in. They are the same physical piece of glass changing shape, position, size and purpose.

Reference for *motion character only*: `https://github.com/Jakubantalik/Libraries.git` — study its
organic movement, springiness, elastic deformation, morphing, momentum, overshoot, follow-through.
Do **not** copy its visual design. The visual language is Apple Liquid Glass: restrained, premium,
polished, translucent, physically coherent, responsive, subtle spring physics, smooth shape
transformation. Never slime, jelly, cartoon UI, or exaggerated Material Design.

### 1. Core mental model
Every expandable element is a seed. The circle does not disappear — the circle *becomes* the panel.
Closing is the exact reverse: the panel returns into its originating seed.

### 2. This is a shared-element morph
A spring-driven shared-element container morph. Source and destination share geometry:

```ts
interface MorphGeometry { x: number; y: number; width: number; height: number; borderRadius: number }
```

`geometry(t) = interpolate(sourceGeometry, destinationGeometry, springProgress)`.

No hard-coded per-button coordinates. Origin comes from the trigger's real
`getBoundingClientRect()` (or platform equivalent).

### 3. Source element = seed
On click capture `x, y, width, height, borderRadius`. The morph layer begins at *exactly* the source
geometry. Rough shape of the flight: t=0 seed → t=0.2 translating + slightly stretching → t=0.45
capsule-like → t=0.7 approaching destination dimensions → t=0.9 small physically plausible overshoot
→ t=1 settled.

### 4. Position and size change simultaneously
Never move-then-resize-then-reveal. Translation, scale, shape, glass behaviour and material overlap
as one physical event.

### 5. Path depends on source position
Not every panel expands from its centre. Left seed expands rightward; right seed leftward;
bottom-right seed expands up-left. A sidebar control's panel visibly originates from that control.
The originating position is part of the interaction's meaning.

### 6. Preserve visual anchoring
One edge/corner should often stay perceptually connected to the source early in the flight. Do not
scale from centre unless the interaction genuinely requires centred expansion.

### 7. Corner radius morph
Radius is part of the shared geometry interpolation: `50%` → … → destination radius, continuously.
Never an abrupt switch halfway through.

### 8. Apple-like spring physics
No `transition: all 300ms ease`. Real spring dynamics (damping/stiffness/velocity), not keyframes.
Characteristics: immediate response, fast initial acceleration, smooth middle travel, slight
overshoot, gentle settling, no visible oscillation, no rubber-band, continuous velocity. Premium
spring, not cartoon bounce.

### 9. Momentum continuity
Never `move → STOP → grow`. Velocity must look physically continuous.

### 10. Liquid Glass material
Translucent glass, backdrop sampling, mild refraction if available, soft internal highlight, edge
illumination, environment-sensitive transparency, subtle specular response, layered shadow,
separation from background, dynamic contrast against what is behind. Not just
`background: rgba() + backdrop-filter: blur()`.

### 11. Material must also morph
Button state: small concentrated highlight, stronger curvature, compact shadow, high apparent
thickness. Expanding: highlight stretches, curvature reduces, shadow footprint grows, refraction
region grows. Destination: large stable surface, soft border lighting, stable environmental blur.
Do not merely scale a DOM element with fixed glass.

### 12. Content reveal
0–30% morphing shell only; 30–55% structural areas; 50–75% icons/labels/controls; 70–100% fine
detail. Use opacity, translation, clip/reveal, blur reduction. Content is *revealed by* the
expanding container, not a pile of independent fades.

### 13. Content must not scale like an image
Never scale the final panel with `transform: scale()` if it stretches text, deforms icons, blurs
rendering or distorts layout. Morph the container geometry; reveal destination content inside it.

### 14. Closing is the true reverse morph
Content disappears → panel contracts → curvature increases → panel moves toward source → radius
becomes circular → aligns exactly with the seed → the button regains interactive ownership. The
close animation must know its origin.

### 15. Source state management
```ts
type MorphOrigin = { id: string; element: HTMLElement; rect: DOMRect; destinationId: string }
```
If layout changes while open, recalculate before the reverse morph.

### 16. Shared morph layer
One reusable motion system, not per-component logic:
`MorphProvider → MorphController → MorphSurface → Seed → Destination`, or an equivalent that fits
the codebase. One central motion primitive, many UI components.

### 17. Left and right sidebars
Same philosophy both sides. A sidebar should not simply slide in from off-screen if a visible
control triggered it — that control is the seed.

### 18. Tool / floating windows
Apply where appropriate: command palette, project switcher, inspector, settings, MCP/tool panels,
context views, AI panels, terminal expansions, model selector, history, navigation controls,
floating utility windows, popovers, expandable toolbar actions. Do not force morphing where it harms
usability.

### 19. Hover / press preparation
idle 1.000 · hover 1.015 · pressed 0.965 · release launches the morph. Tune by testing; no excessive
scaling.

### 20. Interruptible animations
Close while opening, click another seed, resize, rapid toggling — the UI must not break, and motion
continues from its current visual state instead of jumping. Prefer retargetable spring state.

### 21. Responsive geometry
Destination computed from real layout at every size: very small, small, medium, large, maximized,
ultrawide, portrait-ish, very short, very narrow, external monitor, Retina. Never assume 1440×900.

### 22. Resize while panel is open
Open → resize → source moves → close. The reverse must still make sense. For standard controls
prefer the *current* source geometry when the source is still visible.

### 23. Window edge collisions
Sources near top/bottom/left/right/corner must not produce ugly intermediate clipping. Asymmetric
expansion where needed.

### 24. Z-index / layering
`app UI → morph overlay → morphing glass surface → destination takes ownership`. Watch
`overflow: hidden`, stacking contexts, transform-created stacking contexts, `backdrop-filter`,
portal roots.

### 25. Transform origin
Derive from the source/destination relationship, or better: animate world-space geometry directly
instead of leaning on `transform-origin` tricks.

### 26. Performance
60 FPS minimum, 120 Hz friendly. Separate READ from WRITE — no read/write/read/write within a frame.
GPU-friendly properties. Watch `backdrop-filter`, large blur radii, multiple shadows, filter chains,
continuous DOM measurement. Profile.

### 27. Reduced motion
Do not remove continuity — shorten the morph, drop overshoot and travel, keep a simple geometry
transition.

### 28. Interaction ownership
A clean state machine (`closed | opening | open | closing`, or richer). No double activation, no
race conditions.

### 29. Physics depends slightly on distance
20px and 700px travel should not read identically. Consider distance, size delta, aspect-ratio
delta, while staying consistent and fast.

### 30. Aspect-ratio transition
1:1 → 16:10 or 1:3 without ugly linear stretch. `● → ⬭ → ▰ → panel` — a capsule stage is legitimate.

### 31. Liquid deformation
Microscopic elongation along the direction of travel; the leading edge may run very slightly ahead
of the trailing one. **2–5% perceived deformation, not 30% jelly.** Felt, not noticed.

### 32. Optional velocity-based deformation
`deformation = clamp(velocity * factor, min, max)`. Stretch at speed, normal at rest.

### 33. Test cases
Geometry from centre / top-left / top-right / bottom-left / bottom-right. Window sizes 800×600,
1024×768, 1280×720, 1440×900, 1728×1117, 1920×1080, 2560×1440, plus dynamic resize. Toggle: open,
close, open rapidly, close while opening, open while closing. Resize while open. Layout movement
(sidebar width changes while open). Multiple seeds with no ghost surfaces left behind.

### 34. Visual test harness
A motion playground with seeds at all nine screen positions opening destinations of different
shapes: small popover, medium panel, wide window, tall inspector, near-fullscreen.

### 35. Debug mode (development only)
Show source rect (green), destination rect (blue), current morph rect (white), motion path (dotted),
current velocity, spring progress, current border radius.

### 36. Implementation order
Inspect architecture → inspect animation deps → inspect the reference repo → pick the best library
already available → build the reusable primitive → build the playground → tune springs → tune glass
→ validate open/close → validate resizing → validate interruption → integrate one real component →
validate → migrate progressively. **Do not create duplicate animation systems.**

### 37. Do not break existing UI
Understand layout, hierarchy, state ownership, window management, panel rendering, portals, CSS and
current animations first. Smallest architectural change that is still correct. Preserve
functionality, keyboard navigation, focus, click, drag, resizing, accessibility.

### 38. Do not merely fake it
`scale(0)/opacity:0 → scale(1)/opacity:1` is not Seed Morph. The source's geometry must genuinely
drive the animation.

### 39. Success criteria
At 0.25× someone says *"that button physically became that window"* — not "the button disappeared
and a window animated in."

### 40. Motion character
Communicate precision, mass, continuity, softness, responsiveness, depth, premium material. Avoid
cartoon, overshoot spam, rubber, slime, generic web animation, cheap blur, hard cuts, independent
fades.

### 41. Motion constants
Centralised tokens: `motion.seedMorph = { spring{stiffness,damping,mass}, press, contentReveal,
contentHide, glassResponse }`. Tune experimentally; do not blindly use numbers from the prompt.

### 42. Resulting design system
A BiMAX-wide primitive. Components request `seed → popover | panel | window | inspector | sidebar |
fullscreen surface` sharing one physical language.

### 43. Final validation
Run the app and interact with every migrated component at different screen and window sizes, with
rapid interaction, repeated open/close, resize-while-open, different seed positions, both sidebars,
floating and popover controls. Look for jumps, flashes, ghosts, wrong origins, layout shifts, radius
popping, early content, oscillation, blur flashing, z-index issues, frame drops, closing to wrong
coordinates. **Fix them rather than documenting them.**

### 44. Most important rule
At every stage: *"Does this still look like one object transforming into another?"* If no, the
animation is wrong. Opening is growth; closing is contraction back to the seed.

---

# PROMPT 2 — macOS 27 / Apple 2027 ADDENDUM

### 0. This is a Mac app
BiMAX ships as a macOS `.dmg`. It is not a website pretending to be a Mac app, an iPad UI in a
desktop window, a scaled-up mobile UI, a Dribbble glass demo, a glassmorphism experiment, a game UI
or a jelly-animation showcase. Category peers: Xcode, Claude Code, Codex, advanced IDEs, terminal
development environments, professional agentic tools. Desired reaction: *"a Mac application Apple
could have designed for agentic development"* — not *"this web app has Apple-looking blur."*

### 1. First: inspect the actual project
Determine the real stack (SwiftUI / AppKit / Electron / Tauri / WKWebView / React / custom renderer /
Metal / Core Animation), the title-bar, sidebar, animation, window-management and state
architecture. Report which portions are native / hybrid / web-rendered / custom-rendered. Do **not**
rewrite the app into SwiftUI. Preserve existing architecture unless a change has clear technical
benefit.

### 2. Use the current Apple SDK as source of truth
Not old GitHub Liquid Glass clones, not 2025 demos. Check `xcodebuild -version`,
`xcrun --show-sdk-version`, `sw_vers`; investigate `xcrun agent skills export` for Apple's current
SwiftUI specialist skills. Do not commit generated skill files without an existing workflow. The
installed SDK wins over this prompt.

### 3. Target Apple's current design language
Layer model: `content → functional/navigation layer → Liquid Glass → window/environment`. Glass is a
*functional* layer distinguishing navigation, controls, transient tools, inspectors, sidebars and
toolbar actions from primary content. Do not glassify every content rectangle.

### 4. Liquid Glass is not "blur + transparency"
macOS 27 refines the material with increased diffusion over complex backgrounds, a darker separating
edge, brighter specular highlights, environmental adaptation, user-adjustable tint/clarity and
accessibility adaptation. Prefer the system implementation where one exists (SwiftUI `glassEffect` /
`Glass` / `GlassEffectContainer` / interactive glass / system button styles / native toolbar and
sidebar structures; AppKit `NSGlassEffectView` / `NSGlassEffectContainerView`). Do not recreate
native glass with a shader if the native material already produces the right result.

### 5. Interactive glass
`NSGlassEffectView.effectIsInteractive` (and the SwiftUI equivalent) give visual feedback on
interaction. Use for toolbar buttons, floating agent controls, model selector, seed controls,
compact action capsules, contextual tool controls. Do not make passive containers interactive.

### 6. Mac pointer motion ≠ iPhone touch motion
Mouse/trackpad/keyboard, not direct touch. Apple's guidance: glass may react emphatically under
direct touch, subdued under indirect input. So: **fast, precise, restrained, interruptible,
low-amplitude.** No big squash, large scaling, rubber bounce, long overshoot or slow material wobble
on controls clicked hundreds of times a session.

### 7. Update the Seed Morph physics
Keep the architecture; change the character to: immediate → directional acceleration → geometry
continuity → very subtle deformation → destination acquisition → tiny settling response → rest.
Not: click → jelly → bounce → wobble → window.

### 8. Seed Morph must be brief
Feedback motion should be brief and precise, especially for frequent actions. No single fixed
duration — distance- and geometry-aware springs — but optimise for perceived immediacy over
spectacle. The user must never think *"I have to wait for this animation."*

### 9. Interrupt everything
opening→close, closing→reopen, A opening→B selected, morph→window resized, morph→app loses focus,
sidebar changing→another command. Never an uninterruptible timeline. Continue from current position,
velocity, size, radius and opacity.

### 10. macOS 27 window geometry
A coherent corner system, not scattered radii. Nested surfaces near outer containers must be
**concentric** (`NSViewCornerConfiguration`, `NSViewCornerRadius.containerConcentric`): inner and
outer curves visually share a centre.

### 11. Seed Morph corners must also be concentric
Near a window edge, sidebar edge, inspector edge, toolbar or nested panel, the resulting corner
geometry must relate to the destination container — not a blind `50% → 20px` interpolation.

### 12. Edge-to-edge sidebars
Sidebars expand toward the window edges while content and environment refract through the glass. The
sidebar participates in window architecture; it is not a floating card inside the window.

### 13. BiMAX left sidebar
Primarily navigation: workspace, sessions, projects, files/context, history, saved agents. Most rows
quiet; selection gets the clearest treatment; hover secondary; inactive subdued.

### 14. Accent colour in sidebars
Meaningful accent on selected navigation, active agent, active workspace, meaningful state,
important tool identity. Not every icon blue. Colour communicates hierarchy.

### 15. Active vs inactive windows
Adapt to key-window state (`appearsActive`). When BiMAX is not key, subtly reduce emphasis on
sidebar labels, secondary icons, selection intensity and decorative glass response — without greying
the app out or hurting readability.

### 16. Right inspector
A real professional Mac inspector: tool invocation detail, agent state, context, diff metadata,
environment info, MCP/tool status, file metadata, execution details. Contextual; releases width when
hidden. May be Seed-Morphed open, but settles into a proper inspector relationship — not an
oversized floating popover.

### 17. Glass is for the functional layer
Never glassify code, terminal output, agent transcript, diff, logs, file content, markdown or tool
output. `CONTENT = information; GLASS = controls over information`.

### 18. Xcode 27 as a category reference
Study, don't clone: high-value toolbar actions, activity/status under the title, coding-agent access
in the workspace, editor panes dominant, related/review modes without overwhelming the editor,
customisation central.

### 19. BiMAX top region
Must answer quickly: where am I, what workspace, what agent/model, what is happening, what are the
highest-value commands. No enormous web-style header. Candidate grouping: traffic lights,
navigation/history, workspace identity, agent activity, model/mode, priority actions,
window/editor controls.

### 20. Agent activity should be calm
States: thinking, reading, searching, editing, running, testing, waiting, finished, failed. Use tiny
indicators, soft progress, subtle status text, SF Symbol transitions, localised material highlight.
Escalate only when the state deserves attention.

### 21. Activity must not cause layout shift
Reserve geometry; use fixed/aligned status regions or truncation. Status text must not shove toolbar
items around.

### 22. Toolbar responsiveness
Explicit priority tiers (always visible / visible when space permits / overflow), mirroring
`visibilityPriority`, `ToolbarOverflowMenu`, `topBarPinnedTrailing` behaviour. Not arbitrary pixel
breakpoints that just hide things.

### 23. Window resize is a first-class interaction
Must feel excellent *while being dragged*. Watch toolbar reflow, sidebars, inspector, morph
destinations, terminal, editor, wrapping, popovers, glass, background diffusion, selection. No
broken intermediate state.

### 24. Do not scale the UI
Never `transform: scale(0.8)` for small windows. Reflow: hide secondary labels, overflow menus,
collapse optional panes, change widths, truncate, switch layout modes.

### 25. Sidebar width
User-adjustable. Morph geometry must never assume `sidebar = 240px`. If width changes while a panel
is open, the closing morph recomputes against the currently visible seed.

### 26. Toolbar / scroll edge behaviour
Content scrolling under floating top controls must keep the toolbar legible. Rapidly changing
code/text must not create noise under toolbar labels.

### 27. Glass responds to the background
The same surface over a dark editor and a bright diff should not behave identically. Prefer adaptive
material; if emulating, respond to local luminance/complexity rather than one static opacity.

### 28. Never fight user Liquid Glass preferences
Users can tune clarity/tint. Do not hand-tune around one translucency assumption: no important text
depending on background colour, no extremely weak borders, no icons disappearing over content, no
contrast assumptions.

### 29. Show borders
Honour the system "show borders" behaviour in custom controls. Test both states; controls get
clearer, not broken.

### 30. Reduce Transparency
Fall back to a stronger material/background while preserving hierarchy. Never leave panels
unreadable.

### 31. Increase Contrast
Boundaries, labels and selected states stay clear. No hard-coded `opacity: 0.04` borders that vanish.

### 32. Reduce Motion
Keep semantic continuity: source identification + short geometry cross-transition + minimal
translation + no overshoot + no stretch. Do not simply turn everything off.

### 33. Keyboard-first design
Every meaningful custom control needs keyboard access, focus, shortcut and menu parity. A beautiful
morph is irrelevant if the keyboard path is awkward.

### 34. Focus rings
Do not remove native focus indication. Custom controls get an intentional focus state that harmonises
with the glass, accent and shape while remaining unmistakable.

### 35. Modern AppKit input
Prefer gesture recognizers, control events and view-based APIs over `mouseDown` and manual tracking
loops — for press state, selection, drag, context menus and morph activation.

### 36. Pointer-down feedback
Immediate but extremely subtle: rest → tiny optical compression → release → morph launches. It says
"your click registered", not "look at me bounce".

### 37. Hover
Use persistent pointer hover: slightly stronger highlight, subtle material focus, icon emphasis,
tooltip after a delay. Not `scale(1.1)`, giant glow or continuous movement.

### 38. Right click
Contextual menus for sessions, files, messages, tool runs, workspaces, projects. Don't force users
into tiny `•••` controls.

### 39. Menu icon restraint
Icons only where recognition improves, the action is important, or it carries identity/state.

### 40. SF Symbols
Prefer them for standard Mac actions (back, forward, close, sidebar, search, add, remove, settings,
share, stop, play/run). Custom symbols only for BiMAX-specific concepts.

### 41. Icon motion
Animated symbols for idle→running, collapsed→expanded, record→stop, success, sync — when it replaces
larger motion. Never continuous animation without purpose.

### 42. Use Seed Morph selectively
It is the signature, not a mandate. Use it where source→destination has a meaningful spatial
relationship (model button→picker, tools→panel, context→inspector, history→surface, agent
status→run view, composer tool→settings). Keep standard system behaviour for context menus, menus,
alerts, file choosers, permissions and native sheets. Familiarity reduces cognitive load.

### 43. Semantic destination types
```
SeedDestination = popover | palette | toolbarExpansion | sidebar | inspector | floatingPanel | workspaceSurface
```
Each has its own final geometry and glass treatment; the morph system understands the semantics.

### 44. Popover
Model selector, quick tools, branch selector, small context chooser. Compact, close to the seed,
strong source relationship, easy dismissal, shortest morph.

### 45. Palette
Command palette, global search, agent command search. If triggered from the keyboard there is **no
spatial seed** — do not fabricate one. Use soft materialisation + short elevation + focus
acquisition.

### 46. Sidebar destination
A control can initiate its reveal; during the transition it is a growing structural region; after
settling it is part of window layout and leaves the overlay layer.

### 47. Inspector destination
Communicates "this modifies/explains what I am viewing", not "a card appeared on the right".

### 48. Floating panel
Only for genuinely transient utilities. Professional tools benefit from stable geometry.

### 49. Glass merging / fusion
Use system grouping (`GlassEffectContainer` / `NSGlassEffectContainerView`) for logically grouped
neighbouring controls: Run|Stop|Restart, Work|Quick|Vision, editor mode controls, agent actions,
floating computer-use controls. Do not merge unrelated controls just because they are close.

### 50. Shared glass ≠ shared border
Merging is not "remove the gap and draw one rounded rectangle" — the material must appear continuous.

### 51. Material deformation
Keep it, reduce it further for Mac: **velocity perceived, not deformation observed.**

### 52. No chromatic aberration gimmicks
No rainbow refraction. Readable for hours.

### 53. No giant bloom
No neon haze around controls. Brand glow only in selected identity moments.

### 54. Typography
Native macOS typography baseline: legibility, density, hierarchy, alignment, monospaced code. No
landing-page type inside a development app.

### 55. Density
Do not iOS-ify. Precision pointer, large displays, keyboard, resizable windows, multiple information
regions. Comfortable ≠ oversized.

### 56. The main workspace should win
The strongest visual object is usually code, conversation, diff, terminal or result — not chrome.

### 57. Visual priority
For every screen: what is the user's current work, what is the next likely action, what state needs
attention, what can disappear.

### 58. BiMAX should express agency
Easy stop, cancel, undo, review, diff, retry, edit, resume. Never hide control because an animation
or agent operation is running.

### 59. Destructive actions
Distinct from ordinary actions; standard Mac conventions and confirmations. No dramatic morph for
destructive confirmations.

### 60. Restoration
Restore window frame, sidebar width, inspector visibility, selected workspace/conversation/project,
open editor state. Do not restore sensitive or transient state blindly.

### 61. Multiple windows
Audit whether BiMAX supports/should support multiple projects, workspaces, secondary utility
windows, settings. Each morph must know its window coordinate space.

### 62. Screen changes
Monitor moves, scaling changes, connect/disconnect, fullscreen enter/exit, tiling. Never cache
screen coordinates indefinitely.

### 63. Coordinate spaces
Explicit conversion utilities for local / window / screen / overlay coordinates. No scattered
transforms.

### 64. Overlay layer
The morph overlay must live in the correct window; never animate through a global overlay attached
to the wrong screen or window.

### 65. Titlebar integrity
Morph surfaces must not pass through native titlebar controls unless the destination semantically
belongs there. Respect traffic lights, title region, toolbar, drag region.

### 66. Traffic lights
Never customised for branding. Standard behaviour and location.

### 67. Settings
Use a proper Mac Settings experience if the architecture permits. Not an enormous custom floating
web modal. Settings does not need the strongest morph.

### 68. Search
Focus shortcut, clear affordance, keyboard navigation, results selection, escape. A restrained morph
if it expands from a compact control.

### 69. Command palette
Fast, keyboard-first, high contrast, search-focused, dense, predictable. Not an effects demo.

### 70. Agent composer
A primary work tool: typing latency, focus, selection, multiline behaviour, attachments/context,
tool indicators, submit/stop state — before visual effects. Morph can expand tools from compact
composer controls.

### 71. Run / stop transition
State continuity, not two unrelated buttons: symbol transition, glass state transition, shared
geometry. Keep the motion tiny — this action is frequent.

### 72. Model selector
The flagship morph case. The compact glass seed physically becomes the selector surface, and
collapses exactly back into the seed on dismissal.

### 73. Context / tools
`+ Context` becomes the context management surface when the source relationship is clear.

### 74. Activity detail
A compact activity indicator may morph into tool execution detail, thinking trace summary or run
history — making agent state spatially understandable.

### 75. Left and right bar motion
Not "left bar slides from left, right bar slides from right" for everything. Hiding/unhiding a
persistent sidebar may be a structural width transition; a small button creating a contextual region
is a Seed Morph. Both belong in the language.

### 76. Structural motion
Pane resize/collapse uses edge movement, layout reflow and neighbour response — not object scaling.
Central content naturally acquires released space.

### 77. Content must not swim
When sidebars/inspectors animate, code and text stay visually stable.

### 78. Spring retargeting
All key springs accept new targets mid-flight (e.g. inspector opening to 320px, window resized, new
target 280px). Never finish at 320 and jump to 280.

### 79. Window resize during an active morph
Click seed → morph at 45% → resize → morph continues. No jump, no detached destination, no stale
source coordinate.

### 80. Window loses focus mid-morph
Open → Cmd-Tab. Material and active-state appearance may change; geometry must stay stable, and on
return the panel is in a valid settled state.

### 81. Rapid professional use
Stress test as an impatient expert: open, close, open, switch, close, open another, resize, keyboard
shortcut, escape, reopen. No ghost views, dead clicks, stuck overlays or stale z-index.

### 82. Frame pacing
Not just average FPS: frame pacing, main-thread stalls, layout thrashing, shader compilation, blur
cost, resize hitching, allocation spikes.

### 83. Use Instruments if native
Profile opening/closing the inspector, resizing, the morph, scrolling beneath glass, a large
conversation, terminal output during animation. Don't optimise on intuition.

### 84. Terminal output stress test
Animations stay smooth while hundreds/thousands of terminal lines arrive.

### 85. Agent streaming stress test
Run the morph while tokens stream. No animation may depend on static content.

### 86. File tree stress test
Small project, 10,000+ file tree, deep nesting. Sidebar motion must not become janky.

### 87. Dark mode
Not white→black. Inspect glass separation, dark-edge visibility, highlights, code background, active
selection, shadows, contrast.

### 88. Light mode
Not secondary. Glass exposes flaws against bright backgrounds: white pages, bright editor themes,
high-luminance diff.

### 89. Accent colour testing
Blue, purple, pink, red, orange, yellow, green, graphite.

### 90. Multiple wallpapers / environments
Do not tune glass against one screenshot.

### 91. Text legibility above all
If optical realism conflicts with legibility, legibility wins.

### 92. Avoid visual noise
BiMAX is already dense with code, reasoning, tool calls, diffs, terminal output, files and errors.
Movement clarifies state; it does not compete with it.

### 93. Apple's design principles as review criteria
Purpose, Agency, Responsibility, Familiarity, Flexibility, Simplicity, Craft, Delight.

### 94. BiMAX's eighth principle — CONTINUITY
Screens are rarely replaced: control becomes panel, state becomes detail, selection moves, pane
expands, activity progresses, window remembers. The user keeps a mental map. This is why Seed Morph
exists.

### 95. Motion tokens v2
`motion.mac = { microFeedback, selectionMove, seedPopover, seedPanel, seedInspector, structuralPane,
materialize, dismiss, reducedMotion }` — semantics, not arbitrary milliseconds.

### 96. Material tokens v2
Semantic surfaces: content, sidebar, toolbar, inspector, popover, palette, floatingControl,
selection, hover, pressed, inactive. Prefer system materials natively; tokens describe usage, not a
reimplementation of the OS shader.

### 97. Radius tokens v2
`window-derived, container-concentric, control, capsule, circle, popover` — not generic
`radius-sm/md/lg` where geometry has semantic meaning.

### 98. Do not fork native behaviour unnecessarily
Many refinements apply automatically to system components. Prefer native + light customisation over
replacing a native component with 400 lines of custom glass.

### 99. SwiftUI / AppKit hybrid is acceptable
`NSHostingView` for new components where SwiftUI simplifies glass, animation, layout or state.
Preserve AppKit where it solves Mac problems well.

### 100. Do not port the web UI blindly
Don't assume "copy the CSS + add backdrop-filter". Check whether window, toolbar, titlebar, sidebar
material, native menus, settings, system dialogs and keyboard integration belong in the native host
layer. Keep web content where it makes architectural sense.

### 101. Native shell + custom content is valid
Native window / title / toolbar / menu / window management / glass, with BiMAX's editor, agent,
terminal and tools as content. Assess rather than assume.

### 102. BiMAX should not look like Safari
Identity comes from information architecture, motion continuity, tool interaction, typography,
spacing, agent behaviour and small brand accents — not from Liquid Glass alone.

### 103. BiMAX should not look like Xcode either
Xcode 27 is precedent, not template. BiMAX is agent-first: conversation, tool execution, context,
computer use, code modification, verification, agent state.

### 104. The Seed is BiMAX's signature
Apple provides the material; BiMAX provides the philosophy: *controls don't summon disconnected
rectangles — they evolve into the interface needed for the next action.*

### 105. But invisibility is the end goal
After a week it should simply feel obvious, natural and fast. The most successful motion disappears
into the workflow.

### 106–115. Test matrix
- **Window sizes** (samples, not breakpoints): 720×500, 800×600, 1024×640, 1024×768, 1280×720,
  1280×800, 1440×900, 1512×982, 1728×1117, 1920×1080, 2560×1440 — continuously and at snapshots.
- **Window modes**: normal, maximized, fullscreen, macOS tiled, narrow, short, ultrawide, multi-monitor.
- **Appearance**: light, dark; active, inactive; Reduce Motion, Reduce Transparency, Increase
  Contrast, Show Borders; multiple accent colours.
- **Input**: mouse, trackpad, keyboard-only.
- **Seed positions**: top-left/centre/right; left sidebar top/centre/bottom; right controls; bottom
  controls; centre content.
- **Destinations**: small popover, medium popover, command palette, left sidebar, right inspector,
  floating panel, large contextual surface.
- **Interruption** (automate where possible): open→close at 10/30/70%, close→reopen, A→B, resize
  while opening, resize while closing, Cmd-Tab while opening, Escape during opening.
- **Performance**: repeat all of the above while agent streaming, terminal streaming, large file
  tree, large diff, large conversation, CPU load, multiple windows.
- **Visual regression**: idle, hover, pressed, 25/50/75% morph, settled, closing, inactive window,
  accessibility variants. Compare structural invariants (geometry, alignment, clipping, visibility,
  hierarchy) rather than pixels.

### 116. Build a "BiMAX Motion Lab"
Development-only screen exposing seed source, destination type, spring values, current velocity,
current geometry, destination geometry, radius, accessibility state, window size, active/inactive
state — with 1× / 0.5× / 0.25× playback.

### 117. Slow-motion quality bar (0.25×)
**Good:** one continuous object, no radius pop, no opacity flash, no content teleportation, no
geometry discontinuity.
**Bad:** button fades, panel appears, fake scale, child content stretches, shadow jumps, glass
suddenly changes.

### 118. Real-speed quality bar (1×)
Perceived as `click → destination`, continuity subconscious. If the animation calls attention to its
duration, it is too long.

### 119. Stop copying third-party Liquid Glass repos
They may be studied for isolated engineering techniques. They must not define Apple material, Mac
geometry, toolbar hierarchy, sidebar behaviour, accessibility or motion character. Apple's current
SDK, docs and native components are the authority.

### 120. Implementation process
- **A — Audit**: architecture, window, toolbars, sidebars, right bar, controls, motion, glass,
  keyboard, menus, settings.
- **B — Current platform knowledge**: Xcode/SDK/macOS target, availability, Apple agent skills.
- **C — Design system**: material, corner, motion semantics; toolbar priority; pane hierarchy;
  active/inactive; accessibility.
- **D — Seed Morph v2**: Mac-pointer motion, current glass, interruptibility, concentric geometry,
  responsive destinations, semantic destination types.
- **E — Native chrome**: toolbar, title region, left sidebar, right inspector, menus, settings,
  keyboard focus.
- **F — One golden flow**: model selector seed → model picker → select → collapse into the selected
  model control. Perfect it.
- **G — Second golden flow**: tool/context seed → right inspector → interact → collapse to source.
- **H — Validation**: resize, accessibility, dark/light, rapid use, streaming workload, keyboard,
  mouse, trackpad.
- **I — Migration**: only after the primitives are solid.

### 121. Do not declare success on compilation
Launch it, interact, resize, open/close migrated surfaces, stress rapid toggling, change appearance,
test the keyboard, inspect performance.

### 122. Do not declare success on screenshots
Screenshots cannot validate spring quality, velocity continuity, interruptibility, resizing, focus
or the morph.

### 123. Final quality questions
Platform, Hierarchy, Material, Motion, Continuity, Input, Resize, Accessibility, Performance,
Familiarity, Identity. If any answer is no, keep refining.

---

## Final design statement

Apple's current macOS 27 Liquid Glass architecture, precision Mac interaction, adaptive
professional-window hierarchy, restrained spring physics and native platform behaviour — combined
with BiMAX's own Seed Morph continuity system.

Apple provides material, platform conventions, window behaviour, controls, hierarchy, accessibility
and precision. BiMAX contributes Seed Morph, agent-first workflows, source-to-destination
continuity, tool execution choreography, context movement and developer-focused interaction.

The result must not look like *"Apple Liquid Glass applied to an AI app."* It should feel like *"a
modern Mac-native agentic development environment whose interface behaves like a coherent physical
system."*

**Prompt 1's rule:** when there is a meaningful source and destination, the destination should feel
as though it grew from the source — and when dismissed, physically returns to it.

**Prompt 2's rule:** never sacrifice Mac familiarity, speed, accessibility, information density or
professional workflow merely to make that transformation visible.

The Seed Morph exists to make BiMAX easier to understand — not to show off the animation system.
