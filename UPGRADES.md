# BiMax Upgrade Ledger

One line per upgrade, newest first. ✅ = implemented, tested, and in the
installed binary. ⏳ = open, deliberately deferred and marked. Every ✅ names
its commit; claims without a commit don't belong here.

## 2026-07-19 (pass 9) — Computer-use Stages 2 + 8: capture-safe recording + PiP scope (UNCOMMITTED)

Both remaining *surface-scoping* stages, built on the surface model: recording and the PiP preview
should show only the agent's own window, never mirror unrelated windows into a file or a preview.
Honest by construction — the scope we report is the truth about what was requested, and capture-safety
is false whenever we fall back to whole-display. 127 computer-use tests (1 new) + full matrix green;
engine + binary rebuilt & reinstalled.

- ✅ **Surface-scoped recording (Stage 8).** `start_recording` now passes the active agent window's
  `pid`/`window_id` when a capture-safe native-window surface exists, and the recording result carries
  `scope` + `captureSafe`. When no agent window is active it records the whole display and SAYS so
  ("may include unrelated windows") rather than pretending it is scoped. Storage sweeping was already
  bounded in Stage 7. (Passing the window scope is best-effort against the pinned driver; the truthful
  scope/label does not depend on the driver honoring it.)
- ✅ **Capture-safe PiP status (Stage 2).** `pipStatus()` reports whether the post-action preview is
  enabled, which surface it reflects, and whether that surface is capture-safe — so a preview is never
  claimed to be private when the only thing to show is the whole desktop. Surfaced in the `/computer`
  hub's PiP row. (Runtime test: whole-display honesty with no window; scoped recording + capture-safe
  PiP once a Calculator window is open, with `pid`/`window_id` forwarded to the driver.)
- ⏳ **Stage 9 (installed-binary 13-workflow e2e)** and **browser-DOM verification** remain: the former
  needs a live desktop with granted TCC permissions (cannot run in a headless CI/agent environment);
  the latter is a real feature over the browser snapshot-diff internals, deferred, not stubbed.

## 2026-07-19 (pass 8) — Computer-use: recovery controller wired as an enforced authority (UNCOMMITTED)

Stage 6 built a bounded `RecoveryController` but never wired it in — it was dead code exercised only
by its own test, and the runtime only surfaced a `recoveryHint` the model could ignore. Pass 8 makes
it the runtime's authority so a stuck agent is *bounded*, not merely advised. Additive on the working
path (a productive run never trips it). 92 computer-use unit tests (1 new) + full matrix green;
engine + binary rebuilt & reinstalled.

- ✅ **Fed every acting outcome.** `postActionEvidence` now feeds each action's `progressCheck.outcome`
  to a per-session `RecoveryController`; its decision (`continue / retry / recover / escalate /
  stop-success / stop-failure`) ships on the result as `recoveryDecision`, and the `recoveryHint`
  text now reflects the controller's escalation instead of a bare streak count.
- ✅ **Enforced stop, not a suggestion.** Once the controller latches `stop-failure` (no-progress or
  recovery budget exhausted — `maxNoProgress 4` / `maxRecoveries 3`), the `run()` acting-verb guard
  **refuses** further click/type/key/drag/scroll/… with a clear terminal error. The agent physically
  cannot keep hammering a stuck UI — the exact "explaining the picture / repeat the same click"
  failure the program set out to kill.
- ✅ **Escapable + bounded.** A deliberate `observe`/`screenshot` (the agent re-orienting — the
  corrective step recovery asks for) or an `open` resets the budget, so a genuinely different next
  attempt is allowed while blind repetition is capped. Controller resets on open/observe/dispose; the
  automatic post-action observe does NOT reset it. (Runtime test: 4 no-effect clicks → `stop-failure`
  → 5th click refused (never reaches the driver) → re-observe → acting allowed again.)

## 2026-07-19 (pass 7) — Computer-use Stage 7: long-run durability + real resume (UNCOMMITTED)

An hours-long desktop run must not accumulate unbounded state, must not fill the disk, and must
survive a crash. Pass 7 completes the durability module started last session and closes its dead
read/resume loop: the state was being persisted and could be re-read, but nothing ever restored it.
Additive — behavior on the working path is unchanged. 33 computer-use unit tests (2 new) + full
matrix green; binary rebuilt & reinstalled.

- ✅ **Bounded, compressed history + swept storage + atomic session file** (`src/computer/durability.ts`).
  `ActionHistory` keeps only the newest N records in memory while `total` counts everything (budgets);
  `summary()` compresses to per-verb counts + the last few actions + the no-change streak.
  `sweepRecordings` bounds `.bimax/computer/recordings` to the newest runs; `writeSessionState` writes
  atomically (temp + rename) so a crash mid-write never leaves a half-parsed file. Wired into the
  runtime: every acting verb records into the history and persists (throttled ~1/1.5s), dispose writes
  a final snapshot, `startRecording` sweeps first. (`durability.test.ts`.)
- ✅ **Real resume — closed the dead read path.** `ActionHistory.fromSummary` (NEW) rebuilds a history
  from a persisted summary, restoring the monotonic `total` and recent trajectory. On the first `open`
  of a fresh process, `maybeResumeHistory` restores the prior history **only when the persisted session
  is for the same app** — an interrupted long run continues its action count and no-change streak
  instead of silently starting over; a different app never inherits stale state. The prior process's
  live pid/window is deliberately NOT restored (it may be dead/reused); the current `open` re-acquires
  the real surface. (Runtime test: fresh runtime reopening the same app continues the count; a
  different app stays fresh.)
- ✅ **Durability visible in `/computer`.** A "Session: N actions" row shows actions taken, records
  kept in memory, observed-element footprint, and a trailing no-change streak — proof the session is
  bounded and persisted for resume. Consumes `runtime.history()` / `memoryFootprint()` in production
  (previously only exercised by tests).

## 2026-07-19 (pass 6) — Computer-use Stage 6: verification + recovery layer (UNCOMMITTED)

The rule the spec insists on: never treat a driver "success" as task success. 166 unit tests / 15
suites + Go green; verification wiring is additive (adds `progressCheck`/`recoveryHint` to acting
results), so runtime behavior is preserved.

- ✅ **Typed verification classifier** (`src/computer/verification.ts`, NEW). `classifyVerification`
  judges each action by the SCREEN — a fresh post-action `frameHash` vs the pre-action baseline, plus
  window identity and any semantic query — returning `confirmed / changed / no-change / wrong-window /
  unverified / failed`. Plus `verifyClipboard` for copy verification. (`verification.test.ts`.)
- ✅ **Bounded recovery controller** (`src/computer/recovery.ts`, NEW). `RecoveryController` turns the
  verification stream into `continue / retry / recover / escalate / stop-success / stop-failure` with
  hard budgets (`maxRetries/maxRecoveries/maxNoProgress`) and latching terminal states — the explicit
  "continue/retry/recover/escalate/stop" machine, so a stuck agent stops instead of looping forever.
  (`recovery.test.ts`.)
- ✅ **Wired into every acting result.** `postActionEvidence` now compares the fresh frame to the
  baseline and attaches `progressCheck`; after 3 consecutive no-effect actions it adds a `recoveryHint`
  ("re-observe / retarget / wait"). Baseline resets on open/dispose. (Runtime integration test: a
  driver-"success" click on an unchanged screen reports `no-change`, and the 3rd trips the hint.)
- ✅ **Loop audit** in `docs/COMPUTER_USE_RESEARCH.md` — the 8 perception→action→verification steps
  each mapped to the code that implements them, with the remaining gaps (browser DOM verification;
  threading the controller into the agent loop) named.

## 2026-07-19 (pass 5) — Computer-use Stage 4: interaction primitives + drag state machine (UNCOMMITTED)

Fine-grained pointer control + an explicit, safe drag lifecycle. 107 unit tests / 8 suites + Go
green; a live Calculator smoke drove hover/hold/mouse_down/mouse_up + a full drag through the real
sidecar and then computed 2+2=4, proving the down/up pair and drag leave NO stuck button.

- ✅ **Explicit drag state machine** (`src/computer/drag.ts`, NEW). Named ordered phases
  idle→source-located→source-verified→mouse-down→dragging→destination-located→destination-verified→
  mouse-up→verified, with illegal-transition guards and — the key safety property — a `cancel()` that
  reports `releaseOwed` so a half-drag always posts a compensating mouse-up instead of wedging the
  button. (`drag.test.ts`, 7 cases.)
- ✅ **Swift helper v6** — `hover`, atomic `hold` (down→wait→up in ONE process so it can't strand the
  button), and cross-process `mousedown`/`mouseup` primitives. Compiles + runs.
- ✅ **Runtime primitives** — `hover / hold / mouse_down / mouse_up` actions, delivered by the visible
  native cursor after grounding the point on the newest window image (shared `groundScreenshotPoint`).
  A bare `mouse_down` says "button held — issue mouse_up to release". Fallback (cliclick/xdotool)
  support too. `ComputerTool` schema + gating updated (hold/mouse_down/mouse_up governor-gated).
- ✅ **Foreground drag runs through the machine** — verifies the source is on the window before the
  button goes down, executes the atomic native drag, verifies a fresh screen, and on native failure
  cancels + posts a safety mouse-up. Full phase trace ships in `details.dragTrace`. Existing verified
  drag behavior preserved (same native call + summary).

## 2026-07-19 (pass 4) — Computer-use Stage 3: mechanism routing + input ownership + takeover (UNCOMMITTED)

Built on the pass-3 surface model. Delivery now consults the surface before acting. Behavior-
preserving for the working foreground path (real Calculator smoke reproduced the SAME frameHash
`c5f36cdd` with the guard active). 99 unit tests / 7 suites + Go green; binary rebuilt & reinstalled.

- ✅ **Honest mechanism model.** `AutomationMechanism` now matches the runtime's REAL paths:
  `physical-foreground` (global CGEvent, moves the one cursor, needs foreground), `sidecar-background`
  (synthetic PID-post, cursor untouched, may be ignored by SwiftUI/Settings), `accessibility`,
  `browser-automation`, `unsupported`. `chooseMechanism` refuses background input on the bare desktop
  (nothing to target) and prefers AX when an element handle exists. (`surface.ts` + tests updated.)
- ✅ **Delivery guard wired into `run()`.** Every acting verb (click/type/key/drag/scroll/set_value/
  move) consults the active surface first: refuses when the user has taken over, refuses `unsupported`
  combinations, records the chosen mechanism (`lastMechanism()`), and claims agent input ownership for
  foreground physical delivery. The foreground delivery itself is unchanged.
- ✅ **User takeover / resume.** `runtime.pauseForUser()` / `resume()` + `/computer pause` (aka
  `/computer takeover`) and `/computer resume`; the `/computer` hub shows who has control with a
  one-keystroke toggle. While paused, acting verbs are refused so the agent never fights the human for
  the cursor. (Runtime tests: pause→refuse→resume→act; mechanism recorded per action.)

## 2026-07-19 (pass 3) — Computer-use architecture: surface + coordinate foundations (UNCOMMITTED)

Dependency-order work after pass 2 was frozen (checkpoint tags + patch). Builds the roots the rest
of the architecture (PiP, input ownership, precision) needs — not a superficial PiP window. Models
untouched. 82 unit tests across 6 suites + full Go suite green; binary rebuilt (engine now 1444
modules, +2 = the new files). Primary-source research recorded in `docs/COMPUTER_USE_RESEARCH.md`.

- ✅ **Coordinate-transform layer** (`src/computer/coordinates.ts`, NEW). One audited, round-trip-
  tested home for every conversion — normalized(0–1000) ⇄ screenshot px ⇄ window-local ⇄ global
  point ⇄ physical px — instead of the math being copied inline. The runtime now DELEGATES to it;
  equivalence is locked by the unchanged runtime numbers (`coordinates.test.ts`, 8 cases incl.
  Retina round-trip, window-move, resize, dual-scale, stale-AX-frame refusal).
- ✅ **Execution-surface model** (`src/computer/surface.ts`, NEW). Makes surfaces first-class:
  physical-desktop / native-window / accessibility / pixel-only / browser-context / browser-tab /
  virtual-desktop / pip, each with `focusOwner`, `captureSafe`, `backgroundCapable`. `chooseMechanism`
  routes each acting verb to physical-foreground / accessibility / browser-automation — and REFUSES
  (`unsupported`) to fake a physical click on a hidden background window on macOS. `SurfaceRegistry`
  tracks active surface + input ownership and won't hand the agent a surface the user owns without an
  explicit takeover. Wired additively into the runtime (registers on open, refreshes bounds on
  observe, clears on close/dispose); `activeSurface()`/`surfaceSnapshot()` accessors. (`surface.test.ts`
  + 2 runtime integration cases: surface tracked on open/cleared on close, no agent-ownership when the
  app never came frontmost.)
- Delivery routing is unchanged this pass (Stage 3 moves it behind `chooseMechanism`); surface
  tracking is observational only, so runtime behavior is identical to the live-verified pass 2.

## 2026-07-19 (pass 2) — Computer-use: activation, capture, cursor, clean terminal (UNCOMMITTED)

Driven by a live session screenshot: the agent opened WhatsApp but the terminal
stayed frontmost, then full-display captured the terminal, and every screenshot
was dumped into the transcript as a blocky half-block "image". Models unchanged
(founder constraint). Verified by 4 new runtime tests + 3 TUI tests + a real
Calculator smoke through the sidecar (1,271×170+104 → 216,174 read off pixels).

- ✅ **Truthful window activation.** `bring_to_front` returning ok never proved
  the app came forward (Electron/Catalyst apps like WhatsApp accept it and stay
  hidden). `open` now verifies the real frontmost app after activation, escalates
  to the native `open -a` contract, re-checks, and on a positive mismatch attaches
  a `frontmostWarning` + `WARNING:` in the summary instead of claiming success.
  (`src/computer/desktop.runtime.ts` — `frontmostMismatch`.)
- ✅ **Windowed capture, never the terminal.** A target with a pid but no windowId
  used to full-display screenshot — which grabbed the terminal. It now refreshes
  to acquire the real app window first; only a genuinely window-less app falls back.
- ✅ **No more "opened ?".** Empty / bundle-id names from `launch_app` are resolved
  to the human app name via `list_apps` (`resolveAppName`).
- ✅ **Cursor for everything.** Swift helper v5 glides the visible cursor to the
  scroll target (was a teleport); foreground `type`/`key` glide the one cursor into
  the target window before delivering keystrokes so input visibly originates from
  the agent's pointer (`ensureCursorInTargetWindow`). Click/drag/move already glide.
- ✅ **Terminal screenshot spam removed.** The see→act loop captures a screen every
  action; the TUI was rendering each as inline half-block pixels. Default is now a
  clean one-line card (`▣ screen 1512×982 · shot-….png`), suppressed when the
  summary already names the file. `BIMAX_COMPUTER_THUMBS=1` restores the inline
  pixel preview for debugging. (`tui/tools.go` — `renderScreenshotCard`.)

## 2026-07-19 — Computer-use reliability + model defaults (UNCOMMITTED)

Driven by a live computer-use session that failed several ways at once
(calculator never pressed "=", every action prompted, cursor invisible, model
narrated screenshots after 3-4 steps, slow overthinking defaults).

- ✅ **Model defaults rebuilt from live NIM probes (2026-07-19).** Work =
  `mistralai/mistral-small-4-119b-2603` — probed for the actual computer-use
  workload (4× tool call + 2× real-image vision): tool 4/4 at 0.5-1s, vision
  2/2 correct at ~0.7s, plain (no reasoning). Quick = `qwen/qwen3.5-122b-a10b`
  (<1s plain text). Vision slot = '' because the work model sees itself.
  Verified end-to-end through the real adapter (`chat()`): tool turn presses
  `press_equals` in 949ms, vision turn reads the image "Red." in 1275ms on the
  same model. Retired defaults and WHY: step-3.7 overthinks every call (paid
  partner, ignores every thinking off-switch); qwen-397b reliable but 15-37s/
  step and its vision times out; qwen-122b vision returns EMPTY on real images
  (so its `visionInput` cap is now false → image turns reroute, never silently
  fail); llama-3.1-70b took 88s cold. `config.ts`, `models.ts`,
  `capabilities.ts`, `provider.ts`, `llm.adapter.ts`, `spawn.tool.ts`.
- ✅ **High-impact-only approvals mode.** New `computerApprovals`
  ('always' | 'high-impact-only', default set to high-impact-only for this
  user). Routine click/type/open flow without a prompt; only delete/send/
  purchase/submit/permission actions still ask; the sensitive-target hard floor
  (password managers, wallets, security settings) and plan/strict modes are
  unaffected. Toggle in the `/computer` hub. `computer.tool.ts`, `computer.ts`.
- ✅ **Visible cursor.** New `computerVisible` (default true): sidecar acting
  verbs deliver in the FOREGROUND so the real cursor moves; coordinate clicks
  park the cursor on the target first. Swift dev-fallback helper v3 glides the
  cursor (ease-out interpolation) before move/click/drag. `desktop.runtime.ts`,
  `helper.source.ts`.
- ✅ **"Finish on screen" steering.** Tool description + screenshot-observation
  message now forbid answering from the model's own knowledge — drive the app
  through the final step (=/Enter/Save), observe, report what the screen shows;
  never describe a screenshot instead of acting. Fixes the calculator "="
  no-op. `computer.tool.ts`, `multimodal.ts`.
- ✅ **Long-run hygiene.** Stale computer-use observation results (old
  accessibility trees) are stubbed out once a newer one lands
  (`pruneStaleToolObservations`) — this was the source of "explaining the
  picture" drift. `.bimax/computer` screenshots swept to newest 30.
  `maxToolIterations` 50 → 150 for hours-long runs. `multimodal.ts`,
  `agent.loop.ts`, `desktop.runtime.ts`, `config.ts`.
- ✅ Tests: computer.tool (high-impact-only + plan-mode cases),
  multimodal (pruneStaleToolObservations), models/config.scopes/capabilities
  updated to new defaults — full affected set green; TS build + Go TUI build +
  Go tests pass; release binary rebuilt and reinstalled to ~/.local/bin/bimax.

## 2026-07-18 — Phase 2: finish the engineering (commits abee9e36 → …)

### Routing latency (§3)
- ✅ **Pre-flight classifier removed from the turn path entirely** — routing is
  now fully local (`heuristicTier` + `localTier` in `src/cli/model.router.ts`:
  imperative/repo-signal/question-shape regexes, ambiguity → Work model =
  correctness-safe). First visible token vs 120ms mock: **1817ms → 678ms cold
  p50 / 402ms warm p50** (n=20, matrix + method in `docs/ROUTING_DECISION.md`;
  7 architectures compared in the router header). Closes the ⏳ "remaining
  1.85s" item below. — `abee9e36`
- ✅ Failure modes of the old remote classifier (parse crash, key billing,
  cooldown serialization) are structurally unreachable — no remote call exists
  to fail. Anti-oscillation: the router documents what A (remote classifier)
  and B (local heuristics) each handled; historical failure prompts are pinned
  as tests in `src/__tests__/model.router.test.ts`. — `abee9e36`

### Config contamination fixed as a class (§4)
- ✅ **Configuration scopes with provenance**: defaults ← global
  (`~/.breakglass/config.json`) ← project (`<cwd>/.breakglass`) ← env
  (`BGW_MODEL`…), `configSource()` names each key's origin, atomic
  tmp+rename writes, corrupt files preserved aside (`.corrupt-<ts>`).
  — `ce116395`
- ✅ **Runtime writes can never persist volatile state**: `saveConfig(...,
  {origin:'runtime'})` refuses to persist keys whose live value came from env —
  healModel against a mock now leaves the user's config untouched (proven live:
  config stays `{}` across a benchmark run). Closes the ⏳ healModel item
  below. 14 regression tests in `src/__tests__/config.scopes.test.ts`.
  — `ce116395`

### Execution ledger + failure memory + task workspaces (§5/§6/§7)
- ✅ **Execution ledger** (`src/core/execution.ledger.ts`): append-only NDJSON
  task journal — schema v1 + forward-compat skip, Temporal-style
  fold-reconstruction, bounded retention (512KB/14d/keep-400, live tasks always
  survive), credential redaction incl. values embedded in longer strings,
  corruption preserved never crashed on. Boot marks interrupted tasks
  `failed-resumable` with `/tasks retry` hints. — `13f5686f`
- ✅ **Generalized failure memory** (`src/core/failure.memory.ts`): every tool
  (browser keeps its specialized page-aware detector) — normalized-target
  fingerprints digit-churn can't dodge, per-class retry budgets
  (Brooker/SRE: budgets on retries only), transient +2, changed-failure and
  new-user-turn resets. Exhaustion appends a change-strategy note to the tool
  result. FP/FN matrix in `src/__tests__/failure.memory.test.ts`. Closes the
  ⏳ "failure-loop memory only in browser" item. — `13f5686f`
- ✅ **Task workspaces, engine side** (`src/core/task.registry.ts`,
  `shell.tasks.ts`): 16-state machine with a validated transition map, honest
  pause (real SIGSTOP or refused with reason), detached process groups,
  bounded 400-line output rings, `/tasks` command, `ui_snapshot.tasks`,
  BashTool `background:true`, browser sessions self-register. Closes the ⏳
  "long shell streams inline" item. — `13f5686f`
- ✅ **Task panel in the Go TUI** (`tui/panels.go` taskPanel): pinned live
  strip, Ctrl+E keyboard control driving exactly the engine's capability
  flags, <48-col single-line degradation, retires when idle. 6 Go tests.
  — `1c758aed`
- ✅ Tests caught two real bugs pre-commit: embedded credentials leaking
  through redaction; `npx jest` misclassified as `shell`. — `13f5686f`

### Research (§8)
- ✅ **docs/RESEARCH_LEDGER.md** — 8 primary sources (Temporal, Zellij,
  Brooker, Google SRE + Azure, OpenHands, bubbles, browser-use, codex), each
  with licence verified, maintenance checked, and the exact code location it
  shaped; rejected alternatives documented.

### Design language enforced structurally (§9)
- ✅ **tui/design_tokens_test.go** — four CI gates: no raw colour literal
  outside `styles.go`; every token must equal the hex DESIGN_LANGUAGE.md
  publishes; shared tokens must match the Electron app's default `@theme`
  block; each semantic style must be bound to the token its name promises
  (the 9eefbda5 stall-tint bug class can't land silently again).

### Version provenance (§10)
- ✅ **`bimax --version` names semver / commit / clean-or-dirty / build time /
  channel** — ldflags-stamped on release builds, Go embedded-VCS fallback for
  dev builds, "unknown" never invented. v1.0.4 deliberately NOT claimed: a
  release cut is a founder publishing action, not a build side-effect.

### Fault injection (§12)
- ✅ **src/core/fault.injection.ts** — BIMAX_FAULT-armed named failure sites
  (ledger.append/rewrite, config.write, shell.spawn); disarmed = one env
  check, arming is loud, never persisted. Found+fixed a real bug: a sync
  spawn failure escaped startShellTask; now lands failed-resumable.

### Verification matrix (§11) — run 2026-07-18 on this machine
- ✅ Full TS suite, 170 files in 6 serial chunks (`--maxWorkers=2`,
  coverage off): **1262 passed, 0 failed, 2 skipped** (browser E2E, gated on
  `BIMAX_BROWSER_E2E=1` + real Chrome — deliberate).
- ✅ Go TUI suite **with `-race`**: ok. PTY rig `npm run test:tui`: all
  scenarios green. `go vet`: clean.
- ✅ Full self-contained build (`build-release.sh`, 96MB), reinstalled to
  `~/.local/bin/bimax` (rm+cp+codesign), `--version` provenance verified,
  headless engine boot smoke green.
- ✅ Live task-workspace demo: concurrent shell tasks, real SIGSTOP pause /
  SIGCONT resume, cancellation, abrupt-exit restart → ledger reports both
  interrupted tasks resumable, honest re-create, cleanup keeps live records.

### Workaround audit (§14)
- ✅ Repo-wide sweep for TODO/FIXME/HACK/TEMP/WORKAROUND/DEBT/REMOVE_AFTER:
  **zero genuine markers in first-party code** — every hit is prose about the
  concept (personas contract, the TODO-debt drive, its tests). Vendor XXX
  markers are upstream (charmbracelet, golang.org/x).

## 2026-07-18 — overnight rebuild pass (commits 77a89465 → 9b35658d)

### Latency & truth-telling
- ✅ **First-token latency 4.7s → 1.85s** (mock-measured, 3× reproducible): a
  malformed-but-200 classifier response crashed at `choices[0]`, was re-billed
  to the API key as a 500, and the sole key's 5s cooldown was slept out by the
  main call every turn. Fixed as a class (`keySettled` flag + defensive
  `choices?.[0]` everywhere); anti-oscillation tests in
  `src/__tests__/keybilling.test.ts`. — `9b35658d`
- ✅ **Latency attribution engine** (`src/telemetry/netprobe.ts`): every slow
  (>8s) or timed-out first token fires a background DNS→TCP→TLS probe of the
  provider origin; `/perf` renders the evidence with a measured verdict
  (provider-side / local-dns / network-path / network-slow / unknown).
  — `77a89465`
- ✅ **"Provider cold/slow" removed from the stream watchdog** — stall copy is
  now neutral and points at `/perf`; the key-bench matcher covers both stall
  messages. — `77a89465`
- ✅ PTY regression rig fully green again (was failing `first token frame <
  2500ms`, a pre-existing defect reproduced on the prior commit). — `9b35658d`

### Browser / computer use (long-run reliability)
- ✅ **Browser crash recovery**: `ensure()` health-checks `browser.connected`;
  mid-action CDP disconnects reset the runtime honestly and relaunch next
  action with the same profile (logins survive). — `77a89465`
- ✅ **No zombie Chromes**: `close()` is bounded (3s) then hard-kills the
  child. — `77a89465`
- ✅ **Tab-explosion cap** (MAX_PAGES=4): stray popups/`target=_blank` pages
  pruned newest-survive on navigate/snapshot. — `77a89465`
- ✅ **Failure-loop memory**: the third identical failing action tells the
  model to change approach instead of looping. — `77a89465`

### Model system & vocabulary
- ✅ **One vocabulary everywhere** — `/model` description, vision-picker copy,
  `/tier` labels, and the live routing chip (was `fast/deep`) all speak
  Work · Quick · Vision; internal keys survive only on the wire. — `f9bbbcd5`
- ✅ **`/model work` / `/model quick` accepted as input** — previously
  `/model work` set the literal model id "work". Regression-tested.
  — `f9bbbcd5`

### Design language
- ✅ **docs/DESIGN_LANGUAGE.md** — Graphite & Ember codified as a contract:
  colour tokens + rules, symbol table, layout/density, voice guide grounded in
  real product copy, motion rules, rejected patterns. — `9eefbda5`
- ✅ Shimmer stall tint mirrored the wrong hex for `colErr`; now matches the
  token it names. — `9eefbda5`

### Tasks / workspaces
- ✅ **docs/TASK_WORKSPACES.md** — researched decision: one-tab-per-command
  REJECTED with rationale; adopted model = one conversation workspace +
  focusable live panels + state chips. — `36eff113`
- ✅ **Live browser-session chip (◍)** in the TUI footer from
  `ui_snapshot.computer` (host only, taint-aware) — a running automated
  browser is never invisible. — `36eff113`

### Hygiene
- ✅ `.bimax/browser/` + `.bimax/computer/` runtime state gitignored.
- ✅ Removed test residue `{"model":"mock"}` that `healModel` persisted into
  `~/.breakglass/config.json` during benchmarking.

## Open / deferred (marked, not hidden)
- ⏳ Desktop runtime: no screenshot deduplication yet.
- ⏳ macOS notarization + minisign release key (external, unchanged).

### Closed by Phase 2 (2026-07-18, kept for the record)
- ✅ ~~healModel env-persist guard~~ → fixed as a class, `ce116395`.
- ✅ ~~remaining ~1.85s classifier round-trip~~ → classifier removed from the
  turn path, `abee9e36`.
- ✅ ~~classifier parse fallback vs real NIM shapes~~ → moot; no remote
  classifier call exists anymore, `abee9e36`.
- ✅ ~~long shell processes stream inline~~ → `background:true` + task panel,
  `13f5686f` + `1c758aed`.
- ✅ ~~failure-loop memory only in browser~~ → generalized, `13f5686f`.
