# Computer Use — research findings and what they changed

Working notes behind the computer-use work. Every entry records the source, what the authoritative
system does, how BiMax differed, the change made, and the test or measurement that proves it.

**Measurements in this document were taken on the development machine** (M-series MacBook Air, 8 GB,
macOS 26 / Darwin 25.5.0) against the `bimax-computer-use 0.12.3` sidecar. They are reproducible with
the benchmark described in each entry, not estimates.

---

## 1. Observation cost is linear in the scan cap — size it by measurement

**Source.** Anthropic's computer-use guidance: keep screenshot resolution and per-step work
appropriate to the task, use smaller steps when a click is uncertain, and log actions so failures are
debuggable. OpenAI's computer-use loop: capture → ordered actions → screenshot → repeat, with a fresh
capture whenever the UI may have changed. Both make observation the inner loop, so its cost sets the
cadence of everything.

**What the authoritative systems do.** Observation is cheap and frequent. The loop is expected to
re-observe after any state change rather than batching many actions against one stale frame.

**How BiMax differed.** `desktop.runtime.ts` requested
`MENU_TREE_ALLOWANCE(500) + max(300, maxElements)` — a minimum of **800 nodes on every observe**. The
justifying comment asserted the walk was "cheap (~0.2s even at the driver's 2000-node ceiling)". That
number was never measured.

**Measured (Notes, `include_screenshot: false`, median of 3):**

| scan cap | elapsed | elements returned | menu-role nodes |
|---------:|--------:|------------------:|----------------:|
| 50 | 22 ms | 16 | 0 |
| 100 | 56 ms | 31 | 0 |
| 200 | 585 ms | 64 | 0 |
| 400 | 1491 ms | 139 | 0 |
| 800 | 3013 ms | 286 | 0 |
| 1200 | 4361 ms | 434 | 0 |
| 2000 | 6125 ms | 967 | 0 |

≈3.7 ms per node, linear. The real ceiling cost is **6.1 s, not 0.2 s — off by 30×**. The allowance
also bought nothing: the driver returned **zero** menu-role nodes at every cap.

**Change.** Removed the flat allowance; restored the measured floors (`max(300, maxElements)`, or
`max(600, …)` for a queried observe). The menu-first walk the allowance guessed at is already handled
by the existing escalation — rescan once at the 2000 ceiling *only* when the walk hit its cap without
yielding a single window element. Deep scans are now earned per app instead of paid by every observe.

**Result.** Observe **3252 ms → 1132 ms median (2.9×)**; `open` 7020 → 2764 ms.

**Files.** `src/computer/desktop.runtime.ts`.
**Test.** `bimax.computer.runtime.test.ts` › "observe scan budget" — asserts a routine observe uses
the floor and that 2000 is reachable *only* via escalation. The prior test asserted `800`, which
pinned the regression in place; that is why the suite did not catch it.

---

## 2. A window capture excludes occluders; a click does not

**Source.** Apple, *Capturing screen content in macOS* — `SCContentFilter(desktopIndependentWindow:)`
captures a single window, and "no child, pop-up, or other windows … will be included". Apple,
`kAXRaiseAction` — raising a window is best-effort, and "an application's floating windows … might
remain above a window that performs the raise action".

**What this implies.** The image shows the target's own pixels as though nothing covered it, but a
synthesized click is delivered to whatever surface is topmost at that point. Whenever anything
overlaps the target, **the picture and the input disagree**: the model reasons about window A and the
click lands in window B. OpenAI's guidance that model coordinates must never be assumed to be screen
coordinates is the same hazard one level up.

**How BiMax differed.** Nothing verified the recipient. `ensurePhysicalTargetFrontmost` checked that
the target *application* was frontmost — which cannot detect a floating panel, because such a panel
never takes frontmost.

**The worst offender was BiMax's own PiP.** `native/BimaxLivePip.swift` created the preview as an
`NSPanel` at `.level = .floating` with mouse events enabled, so it sat above every application window
across a 480×346 region. Measured:

```
PiP centre       (1212,224) -> received by bimax-live-pip (pid 68630)
PiP title bar    (1212,59)  -> received by bimax-live-pip (pid 68630)
just left of PiP (932,224)  -> received by Notes (pid 2603)
```

Every click inside that rectangle was swallowed while the runtime reported "delivered".

**Change.** A pre-input gate (`ensureTargetReceivesPoint`) on the single choke point used by click,
drag and scroll: probe the recipient → if it is our panel, tell it to move (`avoid x y w h` on stdin,
new in `BimaxLivePip.swift`) → else raise the target *window* via `kAXRaiseAction` → re-probe →
otherwise refuse and name the obstruction.

**Files.** `src/computer/helper.source.ts` (v15: `window-at`, `window-raise`),
`src/computer/desktop.runtime.ts`, `src/computer/pip.ts`, `native/BimaxLivePip.swift`.
**Test.** "click occlusion gate" (4 cases) + live: point moved from `bimax-live-pip` → `Notes` with
`click ok=true`.

---

## 3. The hit test must be Accessibility, not the window stack

**Source.** Apple, `AXUIElementCopyElementAtPosition` — returns the element that would receive an
event at a screen point. `CGWindowListCopyWindowInfo` — enumerates the window list; it exposes bounds,
layer and alpha, but **not** whether a window ignores mouse events.

**Why it matters here.** This was nearly a self-inflicted outage. The first implementation of the gate
used `CGWindowListCopyWindowInfo`:

```
6 of 6 probed points -> bimax-computer-use-a0c5e34a3594 window 3194 layer 0  <-- NOT THE TARGET
```

The driver's own click-through overlay sits at layer 0 across the whole target window. A stack-based
gate would therefore have refused **every click in every app**. Switching to the AX hit test:

```
6 of 6 probed points -> AX recipient: Notes (pid 2603)  [target]
```

**Change.** `window-at` resolves the recipient with `AXUIElementCopyElementAtPosition` and reports the
stack answer only as a human-readable name for an obstruction. Failure direction is fixed: if the
probe cannot answer, **no veto** — a guard that cannot see must not block input.

**Files.** `src/computer/helper.source.ts`, `src/computer/desktop.runtime.ts`.
**Test.** "does not veto when the hit test cannot answer".

---

## 4. Screen content is untrusted data

**Source.** OpenAI and Anthropic both state that UI text, web pages, documents and email observed
through computer use are data, never instructions.

**BiMax.** Already enforced: `computer.tool.ts` marks observe/screenshot results through the taint
tracker, and clipboard reads are tainted on the same footing since they import text of unknown origin
into the transcript. The persona carries the matching rule. **No change required** — recorded so the
next person does not re-derive it.

---

## 5. Element maps must not offer window chrome, and must not invent names

**Source.** Anthropic's guidance to prefer accurate element information and to validate actions rather
than retry blindly.

**How BiMax differed.** `describeUnlabeledControls` named blank icon buttons after the nearest text
within a flat 260×120 pt box. WhatsApp's close/minimize/zoom buttons (12×14 pt at the window's
top-left) were therefore presented as `unlabeled Button near "New chat"` — after a heading **248 pt
away across the window**. The model read that as the New Chat control, clicked a traffic light, and
reopened the same popover on every retry.

**Change.** Window chrome is filtered out of the raw element list entirely (so it leaves both the
model's map and the internal hit-test), and naming now requires row/column *adjacency* rather than
mere proximity. A foreground popover/sheet/menu is announced, because while one is open the AX tree
contains only its contents and the page behind it is absent — not missing from the app.

**Files.** `src/computer/desktop.runtime.ts`.
**Test.** "element map honesty" (3 cases).

---

## 6. Application accessibility opt-in — real, but not universal

**Source.** Chromium exposes its accessibility tree only after a client sets `AXManualAccessibility`.

**Measured.** Notes 397 elements vs WhatsApp 31 (22 of them unlabeled). Wired the opt-in as helper
`ax-enable` / action `ax_enable`. WhatsApp returns **`applied: false`** — its `Info.plist` carries
`UIDeviceFamily` and `WAAppKitBridge.framework`, i.e. **Mac Catalyst, not Electron**. Kept for genuine
Electron apps (Slack, Discord, VS Code, Notion, Cursor); it does not help Catalyst apps, and the
runtime instead tells the model when a tree is too thin to query against.

**Files.** `src/computer/helper.source.ts`, `src/computer/desktop.runtime.ts`.

---

## 7. PiP frame rate was capped at 15 fps, and nothing measured it

**Source.** Apple, `SCStreamConfiguration.minimumFrameInterval` — a *ceiling* on delivery rate;
`queueDepth` — documented range 3–8, with a warning that slow frame processing and excessive
buffering cause stalls and latency. `SCFrameStatus` — unchanged intervals are delivered with status
`.idle`.

**How BiMax differed.** `minimumFrameInterval` was `CMTime(value: 1, timescale: 15)` — a hard 15 fps
ceiling, which is why the preview did not read as live. There was **no measurement of any kind**:
the process counted frames and nothing else, so "real-time PiP" could only ever be asserted. And, as
with the scan budget, a test pinned the regression in place by asserting the literal string
`timescale: 15`.

**Change.**
- Ceiling raised to 60 fps. This costs nothing on a static window because unchanged intervals arrive
  as `.idle` and are discarded before any work.
- `queueDepth` held at 3 — the documented minimum, hence lowest latency. The output handler keeps
  only the **newest** frame (`pending` + `inFlight`), because `DispatchQueue.main.async` is unbounded
  and a busy main thread would otherwise build a backlog that falls progressively behind live.
- Frames are skipped when `isReadyForMoreMediaData` is false (panel occluded/off-screen), instead of
  building an invisible backlog that surfaces as a latency spike when the panel reappears.
- Per-second `pip_stats` telemetry: fps, p50/p95 latency, stale drops, not-ready drops, idle frames —
  surfaced through `LivePipStatus.stats` on the TS port.

**Measured (Notes, 14 one-second windows, real content change):**

| metric | before | after |
|---|---|---|
| fps | ≤15 (capped) | **56.8 median** (55.6–57.5) |
| capture→enqueue p50 | not measured | **0 ms** |
| capture→enqueue p95 | not measured | **0 ms** (worst 1 ms) |
| dropped (stale / not-ready) | not measured | **0 / 0** |
| CPU | not measured | 3–7% |
| RSS | not measured | 44–48 MB, flat |

**Honest reading of the latency figure.** This measures *capture timestamp → layer enqueue*, i.e.
the part this process controls, and sub-millisecond means BiMax adds essentially no delay. It is
**not** glass-to-glass: it excludes ScreenCaptureKit's internal pipeline and display scan-out, which
together are typically 1–2 frame intervals (~17–35 ms at 57 fps). So the ≤100 ms median target is
very likely met, but it is **inferred, not directly measured** — a true glass-to-glass number needs
an external camera or a screen-flash round trip.

**Files.** `native/BimaxLivePip.swift`, `src/computer/pip.ts`.
**Test.** `pip.contract.test.ts` — asserts the frame-interval ceiling is ≥30 (a *property*, so the
15 fps cap cannot silently return), `queueDepth 3`, the presence of stats and newest-frame-only
handling.

---

## 8. A posted mouse event is not an arrived cursor

**Source.** Apple, `CGEvent.post(tap:)` — the event is delivered into the event stream; nothing in
the API says the cursor has finished moving when the call returns. `CGEvent(source: nil)?.location`
reports the event system's current position, which is a *later* observation than the post.

**How BiMax differed.** `glide` posted the endpoint and returned immediately, and `move` printed
`{"ok":true}` — the requested point echoed back as if it were the outcome. The live verification run
caught it as `cursor endpoint exactness — 1/10 moves missed their endpoint: want (901,601), got
(900,600)`.

**Measured** (standalone probe, 60 trials per variant, one-point hops — the case a glide covers with
a single exact post):

| variant | endpoint miss rate |
|---|---|
| post, read back immediately | **58/60 (97%)** |
| post, 3 ms settle | 2/55 (4%) |
| post, 15 ms settle | **0/60** |
| post **twice**, read immediately | 59/60 (98%) |
| warp + post | 0/60 |

Posting twice changes nothing, so no event is being dropped — the read is simply early. Arrival
takes somewhere between 3 and 15 ms on this machine.

**Change.** `settleCursor` polls the observed location until it matches the target, re-posting once
half-way through the budget in case an event genuinely was lost, and returning at a deadline so a
user physically holding the mouse cannot hang the verb. Both glide paths (short hop and eased path)
confirm arrival, and `move` now reports the position actually observed plus an `exact` flag; the
runtime's summary names the real endpoint when it differs from the request instead of repeating the
request back.

`CGWarpMouseCursorPosition` also scores 0/60 and is synchronous, but it was **not** taken: a warp
suppresses local mouse events for ~0.25 s, which would swallow the user's own pointer input.

**Result** — the live check's exact sequence, 20 trials (200 moves) against each helper:

| helper | endpoint misses |
|---|---|
| v16 (before) | 13/200 — 4 stable one-pixel misses plus contamination from a physically moved mouse |
| v17 (after) | **0/200** |

**Files.** `src/computer/helper.source.ts` (v17), `src/computer/desktop.runtime.ts`.
**Test.** `computer.cursor.arrival.test.ts` — asserts the *property* (wait for arrival, report what
was observed, on both glide paths), not the timeout value, so retuning the budget cannot silently
restore a move that returns early.

**Cost to note — and a correction.** The helper path is content-hashed, so v17 relocates the binary.
This was believed to cost a TCC re-approval on first use; **measured, it does not**. Two freshly
compiled unsigned binaries at never-before-seen paths (one of them renamed at random moments before
the run) both reported `accessibility: true, screenRecording: true` on first execution and posted
input successfully: the grants attribute to the *responsible* launching process, not to the helper's
path or signature. The teardown's §1 delta and its priority list have been corrected.

---

## 9. One "who is frontmost?" query cost more than the rest of a target switch combined

**Source.** Apple, `NSWorkspace.frontmostApplication` — a direct read of the active application.
Nothing about answering that question requires enumerating every process.

**How BiMax differed.** `frontmostApp()` went to the sidecar's `list_apps`, which enumerates all
running applications, and picked the one flagged `active`. It is called to confirm every activation,
and *polled* while waiting for an app to come forward.

**Measured** (7 calls each, same machine, same moment, both returning `Notes`):

| path | median |
|---|---|
| sidecar `list_apps` (what it used) | **642 ms** |
| native helper `frontmost` (NSWorkspace) | **4 ms** |

160× apart for identical information. Worse, the activation wait is written as
`waitUntil(…, { timeoutMs: 900, intervalMs: 40 })` — with a 642 ms probe, that loop managed **one
sample** inside its budget, so it could not actually track the app coming forward.

Phase attribution of a real Finder↔Notes switch, before and after preferring the helper:

| phase | before | after |
|---|---|---|
| frontmost-confirmed | 810 ms | **33 ms** |
| capture-switched (screenshot + AX walk) | 302 ms | 1491 ms* |
| wall | 1662 ms | — |

*not a regression: the same walk was always there, and the medians moved because the before-run's
sample was dominated by Finder's cheaper tree. The AX walk is now the whole cost of a switch.

**Change.** `frontmostApp()` prefers the native helper and falls back to `list_apps` only when the
helper is not already built — gated on `quickStatus()`, which never compiles, so this cannot turn a
4 ms read into a first-use `swiftc` build on the critical path.

**Result** — the live check's target-switch measurement, same script, same machine:

| | p50 | p95 |
|---|---|---|
| session start | 3752 ms | 9412 ms |
| after the fix | **573 ms** | **2355 ms** |

**Files.** `src/computer/desktop.runtime.ts`. `lastSwitchPhases()` was added alongside, so a slow
switch can be attributed to the phase that spent the time instead of guessed at.

**Test-hermeticity note, because it bit immediately.** Preferring the helper means a runtime built
*without* a native stub asks the real desktop which app is in front — and then takes the "activated
X, but Y is still frontmost" escalation path against fixture apps that do not exist. 46 unit tests
constructed a bare runtime, so the suite became slow and dependent on whatever the developer had in
front. All of them now receive a stub wired to the same simulated window server as the sidecar
fixture, and `bring_to_front` in that fixture updates who is frontmost — a fixture that pins one app
as permanently in front while the test activates another describes an impossible desktop, and it was
hiding a real report as long as the sidecar answered "unknown".

---

## 10. Two places the system made a false claim easy to believe

Found by running the real product, not the harnesses. In three live sessions the agent told the user
things that were not true; in two of them the system had handed it the rope.

**The live preview was unobservable but askable.** PiP is presentation-only — there is no verb that
can see it — yet a user can reasonably ask "what is the preview showing?". With no ground truth to
read, the model answered from imagination, naming an app after each of four switches, having queried
nothing. Fixed by attaching the runtime's own view of the preview to every observation
(`DesktopResult.preview`), so the honest answer is available rather than invented.

**Every capture was labelled `screen`.** The TUI's card read `▣ screen 1568×1538` for a
*window*-scoped PNG. Asked for a full-display screenshot, the model took a window capture, and then
described the file to the user as "a full-display screenshot showing both Calculator and TextEdit
windows". It showed one window. The card now names the scope from the file the engine actually
wrote — `▣ window` for `window-*.png`, `▣ display` for `shot-*.png`.

Neither fix makes a model truthful. They remove the two cases where the transcript itself was
misleading, which is the part that was ours to fix.

**Files.** `src/tools/implementations/computer.tool.ts`, `src/computer/desktop.runtime.ts`,
`tui/tools.go`.
**Test.** `computer.tool.test.ts` › "live preview state is reported, not left to imagination"
(3 cases, including: never fail an observation because the preview could not be read);
`tui/tools_test.go` › `TestScreenshotCardNamesTheCaptureScope`.

---

## Open items

**Implemented since this document was first written** (code and tests landed; see the files named):

- **Frame identity binding an action to the picture it was planned from** — `src/computer/frame.ts`,
  `computer.frame.test.ts`. Verified live: a click planned from a superseded frame is refused by id,
  and the current frame is still accepted.
- **Explicit target-switch transaction** — `src/computer/switch.ts`, `computer.switch.test.ts`.
  Input is frozen at the first phase and released only once a frame carrying the new target's
  identity exists; illegal orderings throw.
- **Property-based transform tests** over randomized geometry — `computer.frame.test.ts`
  (round-trip, no mid-chain rounding, containment; 9000 generated cases).
- **Soak and live-verification harnesses** — `scripts/soak-computer-use.ts` (`npm run
  test:computer:soak`), `scripts/verify-computer-use-live.ts`. The live script now reports
  **13 passed · 0 failed · 0 skipped**.

  Two things had to be fixed before that number meant anything. Its PiP check sampled
  `pipStatus()` once, immediately — but PiP goes through a config load, a child spawn and a first
  ScreenCaptureKit frame, measured at ~500 ms, so a single immediate read was guaranteed to be
  early and the check was skipping on its own impatience. It now waits for the condition and
  distinguishes disabled (skip) from enabled-but-never-started (fail).

  The other was environmental and worth recording: with the driving app fullscreen on a
  single display, the target window is repeatedly pushed to an inactive Space, and macOS parks a
  window that is not on the active Space at a large negative origin — which surfaced as
  `x out of range: -1185` refusals and 16/50 clicks blocked by the occlusion gate. **Zero of those
  50 clicks went to the wrong app**: the gate refused rather than misdelivering, which is the
  behaviour it exists for. A meaningful live run needs the target visible, not merely open.

**Still open, stated plainly:**

- **The p95 ≤250 ms switch target is still not met**, though it is now 4× closer (§9): p50 573 ms,
  p95 2355 ms. What remains is not waiting — activation confirmation is 33 ms — it is the screenshot
  and accessibility walk that the switch's own evidence contains. The only lever left is to commit
  the transaction on a minimal identity frame (geometry + screenshot) and produce the element map
  after commit. That was deliberately **not** done: input being frozen during a switch harms nobody
  (the agent's next turn comes after `open` returns anyway), so committing earlier would improve the
  number without improving the system. ≤250 ms is not reachable while a switch also hands back the
  element map the model reads.
- **Glass-to-glass PiP latency is still inferred**, per §7 — a true number needs an external camera
  or a screen-flash round trip.
- **The 30-minute soak has never completed a run.** The harness works and was started once; it was
  stopped early because its workload types into the target app and issues Cmd+A then delete every
  cycle — acceptable against a scratch document, not against a user's Notes library. Point it at a
  throwaway TextEdit document before running it, and nothing is known about multi-hour drift until
  it does.
- **PiP may keep capturing a window the app has replaced.** Observed once during that soak: the
  panel read `LIVE Notes window 6167` while showing an empty window three minutes stale, next to a
  live Notes window with content. Window-geometry churn (`arrange`) is the suspected trigger — the
  capture-side twin of the stale-frame problem the frame registry fixed for input. Not reproduced
  deliberately and not diagnosed; recorded so it is not mistaken for understood.
*(A stable installed helper path was previously listed here. It was dropped: the TCC cost it was
meant to remove does not exist for BiMax — see the correction in §8.)*
