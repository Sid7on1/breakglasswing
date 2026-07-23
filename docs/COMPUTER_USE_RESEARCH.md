# Computer Use — OpenAI & Anthropic primary-source mapping

Implementation-focused comparison of the two official computer-use designs against Bimax's
implementation, mapped to repository components. This is the evidence base for every "we follow
OpenAI/Anthropic here" claim: each adopted idea names its source, the repo component it lands in,
whether it was already present, what changed, and how it was tested.

## Primary sources

- Anthropic — Computer use tool, beta `computer-use-2025-11-24` (tool type `computer_20251124`),
  earlier `computer-use-2025-01-24` (`computer_20250124`).
  <https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool>
- Anthropic quickstart reference implementation (agent loop, scaling, XGA target).
  <https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo>
- OpenAI — Computer use tool (`computer_use_preview`) & Responses API loop.
  <https://developers.openai.com/api/docs/guides/tools-computer-use>
- OpenAI — Safety checks (`pending_safety_checks` / `acknowledged_safety_checks`).
  <https://developers.openai.com/api/docs/guides/safety-checks>

> Dates/model ids are current as of the fetch (July 2026). Beta headers and tool versions change;
> re-verify against the live docs before shipping a release that depends on a specific field name.

## Phased repair plan (2026-07-23)

The implementation order follows the vendor loop rather than treating computer use as a large
prompt plus a mouse API:

1. **TUI reachability — complete.** Keep the transcript in model state, but route wheel and trackpad
   events into the alternate-screen viewport so live history is actually scrollable.
2. **Instruction contract — complete.** Replace task-specific prompt accretion with one short,
   mandatory observe → one action → observe → verify state machine in both the system prompt and
   tool description.
3. **Loop enforcement — complete.** Execute at most one `ComputerTool` call from each model turn.
   Extra calls planned from the stale pre-action frame are returned as deferred, then the first
   action's fresh frame is attached for the next decision.
4. **Perception integrity — complete for the current native sidecar.** Native window capture is the
   source of truth; every attached frame names its source, action and exact dimensions. Input is
   refused without a matching fresh target frame, and a failed post-action capture invalidates old
   handles and coordinates.
5. **Operator PiP — complete.** An in-repo native helper uses `SCStream` at 15 fps with a
   `desktopIndependentWindow` filter bound to the active `pid + windowId`, rendered in an AppKit
   always-on-top panel. It is packaged inside the single Bimax executable, follows target changes,
   suspends for user takeover, and stops on close/quit/dispose. The model still receives the
   original per-action PNG, never the scaled presentation surface.
6. **Recovery and durability — present, continue hardening.** Keep bounded no-progress recovery,
   wrong-window detection, frame hashes, action history, resumable checkpoints and explicit
   pause/resume takeover; add durable safety-check acknowledgement records to the release gate.
7. **Evals and release gates — next.** Add deterministic one-action pacing, missing-frame,
   Retina/window-move, modal, scroll, drag and long-session scenarios to the PTY/native smoke matrix.

The load-bearing rule is now executable, not advisory: **the model cannot perform a second UI input
until Bimax has captured and attached the result of the first one.**

## Side-by-side: design → Bimax

| Concern | Anthropic (`computer_20251124`) | OpenAI (`computer_use_preview`) | Bimax component | Status |
|---|---|---|---|---|
| Tool/action schema | One `computer` tool; actions: `left_click` `right_click` `middle_click` `double_click` `triple_click` `mouse_move` `left_mouse_down` `left_mouse_up` `left_click_drag` `key` `hold_key` `type` `cursor_position` `scroll`(`scroll_direction`,`scroll_amount`) `wait` `screenshot` `zoom` | One `computer` tool; actions: `click`(x,y,button,keys[]) `double_click` `drag`(path[]) `type` `keypress`(keys[]) `move` `scroll`(x,y,scrollX,scrollY) `wait` `screenshot` | `ComputerTool` with a unified `action` enum: `open observe screenshot click type key set_value drag scroll cursor frontmost move close wait record_*` (`src/tools/implementations/computer.tool.ts`, `desktop.runtime.ts`) | Present; superset (adds native app lifecycle: open/observe/close + AX `set_value`) |
| Coordinate system | Pixel `[x,y]`, top-left; recommend scaling the screen down to ~XGA (1024×768) so coordinates land accurately | Pixel `(x,y)`, top-left of viewport (1280×720 / 1440×900); `detail:"original"` to preserve resolution | **`src/computer/coordinates.ts`** (NEW) — one audited layer: normalized(0–1000)⇄screenshot px⇄window-local⇄global point⇄physical px. Bimax captures the **window** (not full screen) and maps via the window frame ratio, so no XGA down-scale is needed | Present; **changed** (extracted + round-trip tested) |
| Retina / scaling | XGA down-scale recommendation | `detail:"original"` | `screenshot()` downscales Retina 2× captures to point resolution; `coordinates.ts` `logicalToPhysical`/`physicalToLogical`; displays carry `scale` | Present |
| Agent loop | Screenshot **after every action**; "after each step, take a screenshot and evaluate the outcome; only move on when confirmed" | `computer_call` → execute → capture screenshot → `computer_call_output`(image_url, call_id) → repeat until no `computer_call` | Every acting verb auto-returns fresh post-action pixels (`postActionEvidence`); `agent.loop.ts` drives see→act→see; steering text demands completion proof | Present |
| Screenshot → model | Image content block after each action | `computer_call_output.output.image_url` base64 data URL, `detail:"original"` | `multimodal.ts` — appends screenshot as next-turn user vision content, **OpenAI `image_url` base64 data-URL wire format** (universal across providers); pruned to newest 2 (Gemini pattern) | Present |
| Instruction-before-image | "place the instruction text *before* the screenshot image — improves click accuracy" | — | `multimodal.ts buildScreenshotObservation` puts the text part first, then the image | Present (matches Anthropic guidance) |
| Small-target precision | `zoom` action + `enable_zoom` to inspect a region at full resolution | (none built-in) | Sidecar exposes a `zoom` op; **not yet surfaced in the `ComputerTool` action enum** | **Gap** — see Remaining |
| Fine-grained selection | `left_mouse_down`/`left_mouse_up` for cell/text selection | `drag(path[])` through intermediate points | `drag` (helper glides through intermediate points); no explicit down/up split yet | Partial (Stage 4 remaining) |
| Modifiers | modifier via `text` param on click/scroll; also `hold_key` | `keys[]` on click/move/drag | `modifier: ['cmd','shift','alt','ctrl','fn']` on click (native CGEvent flags, `helper.source.ts`) | Present |
| Safety / prompt-injection | Classifiers flag prompt injection in screenshots → **steer the model to ask for user confirmation**; isolate from sensitive data | `pending_safety_checks`/`acknowledged_safety_checks`: malicious-instruction, irrelevant-domain, sensitive-domain; developer must acknowledge to proceed | `getTaintTracker().mark('web', …)` — screenshots taint the session like a WebFetch and narrow network tools; `classifyDesktopActionImpact` + governor high-impact gating; **sensitive targets (password managers, wallets, security settings) hard-denied** | Present (analogous) |
| Confirmation of consequential actions | Human-in-the-loop recommended | Acknowledge safety checks before form submits/purchases | `governor.approveTaskExecution` with `highImpact`; `computerApprovals: 'high-impact-only' | 'always'` (`/computer approvals`) | Present |
| Action verification | Screenshot + evaluate each step | Screenshot each turn | `frameHash` (pixel identity) + optional `verification` query on `observe`; loop-detector's frame-hash no-progress detector (`loop-detector.ts`) | Present |
| Environment isolation | Isolate Claude from sensitive data/actions | Run browser sandboxed (`chromiumSandbox`), empty `env`, disable extensions, treat 3rd-party content as untrusted | `BrowserTool` = agent-owned Chromium context; `ComputerTool` = physical desktop. **`src/computer/surface.ts`** (NEW) formalizes the distinction between physical-desktop / native-window / accessibility / browser / virtual surfaces and refuses to fake physical input on a hidden window | **Changed** (surface model added) |
| Input ownership / takeover | Human-in-the-loop | Human-in-the-loop | `SurfaceRegistry.claimInput/releaseInput` (NEW) — the agent cannot silently take a surface the user owns; `focusOwner` per surface. Live desktop pause/takeover UI = Stage 3 | Partial |
| Long-running operation | (loop until done) | (loop until no `computer_call`) | `pruneStaleToolObservations`/`pruneScreenshotObservations` (bounded history), `sweepShots` (≤30 PNGs), `maxToolIterations` 150, loop budgets + circuit breaker | Present |
| Known limitation stated | Latency, occasional wrong assumptions, spreadsheet precision | Not fully reliable; needs human oversight; isolate env | Bimax encodes the hard OS truth: **a hidden background native window cannot receive ordinary physical mouse input on macOS** (`surface.ts chooseMechanism` returns `unsupported` rather than pretending) | Present (explicit) |

## What Bimax adopted, and how it was verified

| Adopted idea | Source | Repo component | Already present? | What changed this phase | Test |
|---|---|---|---|---|---|
| Screenshot-after-every-action loop | Anthropic + OpenAI | `postActionEvidence`, `multimodal.ts` | Yes | — | `bimax.computer.runtime.test.ts` (fresh screenshot + `frameHash` on click/type) |
| Instruction text before image | Anthropic | `multimodal.ts` | Yes | — | `multimodal.test.ts` |
| Base64 `image_url` screenshot wire format | OpenAI | `multimodal.ts imagePartFromSource` | Yes | — | `multimodal.test.ts` |
| One coordinate-transform layer (no scattered math) | Both (coordinate correctness) | **`coordinates.ts`** | No — math was inline | Extracted + round-tripped; runtime delegates to it | `coordinates.test.ts` (8), runtime numbers unchanged |
| Per-surface mechanism routing; don't fake background physical input | OpenAI env-isolation + OS reality | **`surface.ts chooseMechanism`** | No | Added surface model + registry + router | `surface.test.ts` (routing + refusal + ownership) |
| Screenshots are untrusted input (prompt-injection) | Anthropic classifier / OpenAI safety checks | taint tracker in `computer.tool.ts` | Yes | — | `computer.tool.test.ts` |
| Sensitive-target hard deny + high-impact confirmation | Both HITL | governor + `action.impact.ts` | Yes | — | `computer.tool.test.ts`, `capabilities.test.ts` |
| Frame-hash no-progress detection | Verification/recovery principle | `loop-detector.ts` | Yes | — | `loop-detector.test.ts` |

## Where Bimax deliberately diverges

- **Window-scoped capture instead of full-screen XGA down-scaling.** Anthropic's quickstart scales the
  whole screen to XGA for click accuracy. Bimax captures the *target window* and maps coordinates via
  the window frame ratio (`coordinates.ts`). This is more accurate for single-app tasks and is the
  basis for capture-safe PiP (only the agent surface is ever shown), at the cost of needing explicit
  window acquisition (handled by `refreshTargetWindow`).
- **Native accessibility tree as a first-class targeting path**, not just pixels — `observe` returns AX
  elements with tokens/frames, and `set_value` drives controls without a pointer. Neither vendor's
  built-in tool exposes an AX path; it is Bimax's answer to "prefer structured information when
  available."
- **Physical vs. agent-owned surfaces are explicit** (`surface.ts`). Both vendors assume a dedicated
  VM/browser they fully own. Bimax runs on the user's *real* desktop, so it must track input ownership
  and refuse impossible background operations rather than assume an isolated environment.

## Remaining gaps vs. the vendor designs (tracked for later stages)

1. **`zoom` action** — Anthropic's small-target precision primitive; the sidecar supports it but it is
   not in the `ComputerTool` action enum. (Precision, Stage 5+.)
2. **Explicit `mouse_down`/`mouse_up` split + drag path state machine** — Anthropic uses these for
   text/cell selection; Bimax's `drag` is one glided call. (Stage 4.)
3. **Durable safety acknowledgements across resume** — pause / user takeover / resume is wired
   through `/computer pause` and `/computer resume`, but consequential-action acknowledgements are
   still per-action rather than resumable records. (Stage 6.)
4. **`acknowledged_safety_checks`-style resumable confirmation record** — Bimax gates per-action; it
   does not yet carry an acknowledgement token across turns the way the Responses API does. (Stage 6.)

## Perception–action–verification loop audit (Stage 6)

Does the loop truly perform the eight steps, or does it just click and hope? Mapping each step to the
code that implements it, with the gap it closed.

| Step | Implemented by | Notes |
|---|---|---|
| 1. Observe | `observeTarget` (window screenshot + AX tree), `postActionEvidence` (auto after every acting verb) | Every action returns a fresh frame; no reusing a stale one. |
| 2. Identify state | `observeTarget` elements + `frameHash` (pixel digest) | State = the fresh frame + AX elements. |
| 3. Compare to expected | `classifyVerification` (`verification.ts`) — prev vs next `frameHash`, window identity, optional semantic query | NEW this stage. |
| 4. Smallest safe action | `chooseMechanism` (mechanism per surface), governor gating, sensitive-target deny | Picks the least-privileged mechanism; refuses impossible ones. |
| 5. Execute | native CGEvent (visible) / sidecar synthetic / AX — routed by mechanism | |
| 6. New observation | `postActionEvidence` captures the post-action frame | |
| 7. Verify outcome | `classifyVerification` → `progressCheck` on the result: `confirmed / changed / no-change / wrong-window / unverified / failed` | NEW. The runtime no longer treats a driver "success" as task success. |
| 8. Continue / retry / recover / escalate / stop | `RecoveryController` (`recovery.ts`) bounded state machine, **wired into the runtime as an enforced authority** (feeds every acting outcome, ships `recoveryDecision`, refuses acting verbs once `stop-failure` latches) + `loop-detector.ts` (frame-hash no-progress, repeated-action, error-thrashing) + runtime `recoveryHint` | Controller with explicit terminal states + budgets; the runtime enforces the stop, the model no longer just sees a hint it can ignore. |

Verification signals now available, and where each comes from:

- **Visual-difference** — `frameHash` diff in `classifyVerification` (`progressCheck.frameChanged`).
- **Window metadata** — target vs observed `windowId`/app → `wrong-window`.
- **Accessibility-state** — `observe` semantic `query` → `queryMatched` → `confirmed`.
- **Clipboard** — `verifyClipboard` (pure; wired where a copy is performed).
- **Repeated-frame / no-progress** — `progressCheck: 'no-change'` + `noChangeStreak` + `recoveryHint`, and `loop-detector`'s frame-hash detector.
- **Repeated-action / error-thrashing** — `loop-detector` (`generic_repeat`, `error_thrashing`).
- **Focus-loss / wrong-window** — `classifyVerification` window/app comparison; `frontmostWarning` on open.
- **Bounded recovery + terminal states** — `RecoveryController` budgets (`maxRetries/maxRecoveries/maxNoProgress`) → `escalate` / `stop-failure`.

`RecoveryController` is now the runtime's bounded authority, not just an advisor (pass 8). Every
acting verb's `progressCheck.outcome` is fed to the controller; its decision ships on the result as
`recoveryDecision`, and once it latches `stop-failure` the `run()` guard **refuses** further acting
verbs — the agent cannot keep hammering a stuck UI. The stop is escapable and bounded: a deliberate
`observe`/`screenshot` (the agent re-orienting) or an `open` resets the budget, so a genuinely
different next attempt is allowed while blind repetition is capped. The controller resets on
open/observe/dispose.

Still open for a later pass: DOM-state verification for the browser path (BrowserTool has its own
evidence but is not yet run through `classifyVerification`).
