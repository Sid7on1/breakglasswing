# BiMax Upgrade Ledger

One line per upgrade, newest first. ✅ = implemented, tested, and in the
installed binary. ⏳ = open, deliberately deferred and marked. Every ✅ names
its commit; claims without a commit don't belong here.

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
