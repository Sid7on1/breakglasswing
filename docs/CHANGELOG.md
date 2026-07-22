# Changelog

All notable changes to BiMax. Dates are ISO 8601.

## [Unreleased] — 2026-07-22 stabilization: computer-use safety, deterministic context, Grok-port quarantine

Restores trustworthy computer use, deterministic context management, and honest protocol
surfaces. Several recently-ported Grok features are disabled by default, corrected, or
deleted. **Privacy default: nothing records, fetches, or provisions without an explicit ask.**

### Computer use (behavior changes)

- **Recording is opt-in and explicit-only, with UNFORGEABLE whole-display approval.**
  `computerRecord` defaults to **false**, and even when enabled, recording NEVER starts as a
  side effect of `open`/`click`/`type`/`scroll` (the silent auto-record path was deleted).
  Only an explicit, governor-approved `record_start` begins one. Whole-display **video**
  capture requires a single-use token minted by the runtime ONLY after the governor prompt
  (stating the true whole-display scope) resolves — every model-controlled field
  (`approveFullDisplay`, `fullDisplayToken`) is stripped from tool arguments, so no boolean
  or guessed token a model sets can authorize it. Recording state has a single owner
  (`src/computer/recording.ts`).
- **`close` closes the selected WINDOW (Cmd+W / Ctrl+W), never the application.** The old
  behavior (Cmd+Q/Alt+F4) moved to a new, separate **`quit_app`** action that is always
  high-impact (per-action approval; may discard unsaved state). On the sidecar path the close
  is verified (window gone from the window list → `confidence: 'proven'`); on the fallback
  driver — which cannot enumerate windows — the result is TRUTHFULLY delivered-but-unverified
  (`observed: 'unverified'`, `confidence: 'unknown'`, postcondition unmatched) and downstream
  recovery can never read it as proven success. *Migration: automations that relied on
  `close` quitting an app must switch to `quit_app`.*
- **Honest per-action outcome contract.** Every verified action now carries `actionResult`
  `{ delivered, observed, postcondition?, confidence, failureReason? }`. Pixel change is
  supporting evidence only: `confidence: 'proven'` requires a matched semantic
  postcondition; a pixel-identical screen is `unknown`, not a failure. Visually-static verbs
  (`wait`/`hover`/`move`/`mouse_up`) no longer feed the no-progress latch, and a latched
  recovery failure clears ONLY on a successful re-observation that captured a fresh frame —
  issuing `observe`/`screenshot` no longer bypasses it.
- **Removed** the Grok-ported circuit breaker around the FALLBACK desktop helper: it never
  protected the real sidecar path, so the same action was governed by two conflicting
  failure policies. The runtime's recovery controller is the one policy.
- **Runtime decomposed behind explicit interfaces**: driver transport (spawn/handshake/
  timeouts/teardown → `src/computer/transport.ts`, the ONE place a sidecar RPC can happen),
  target/surface ownership (`src/computer/target.ts` + the existing `surface.ts`), and
  recording (`recording.ts`). Every acting verb yields exactly ONE ActionResult (enforced by
  a run() wrapper), and routing tests prove input delivery goes through exactly one driver —
  never both the sidecar and the fallback.
- Deprecated `pixelFallback` flag dropped from the ComputerTool schema.

### Context management (behavior changes)

- **ContextManager is session-scoped.** The persona owns one instance across human turns
  (token calibration, the 50% warning latch, and compaction epochs survive turns); it resets
  only on an explicit boundary (`/clear`, session load/resume).
- **No sidecar work on the foreground path.** The Headroom ML compressor is STRICTLY opt-in
  (`BIMAX_ENABLE_HEADROOM=1`); without it, compaction never creates a Python venv,
  pip-installs, downloads a model, or opens a localhost listener. The default compactor is
  the deterministic in-process `compressBacklog` with `skipCode` (code passes verbatim;
  error/warning lines always kept). *Migration: `BIMAX_DISABLE_HEADROOM` is gone — the
  proxy is now off unless `BIMAX_ENABLE_HEADROOM=1`.*
- **Code survives every context path verbatim.** The per-result size cap no longer elides
  code: a >16k source-file read passes through the cap, proactive compaction, and reactive
  compaction untouched (log dumps are still capped). Old code results are never silently
  truncated — micro-compact evicts them WHOLE with a lossless, resolvable reference naming
  the exact file to re-read.
- **`FreeContextTool` is truthful.** `"tool_results"` now actually clears eligible
  historical tool-result bodies from the LIVE session context (newest 6 kept, atomic
  assistant-call/tool-result pairing preserved) and reports measured before/after token
  estimates.
- **File restoration is stat-verified and honestly labeled.** Post-compact restoration
  re-stats every file: externally modified or deleted files are never re-injected, and a
  partial (offset/limit) read is labeled `PARTIAL read (…)` — never presented as the
  complete file.
- A context-token refresh now emits `context_changed` (footer meter only) instead of
  `graph_changed` — the TUI no longer prints a false "code graph updated".

### Grok-port disposition

- **Power monitor: OPT-IN, and never stalls interactive work.** The 4-second power backoff
  inside the agent tool loop was deleted; power advice now only constrains NEW sub-agent
  spawns. `BIMAX_POWER_AWARE` semantics inverted: off unless explicitly `1`/`on`.
- **Self-update: no startup network or repo-local writes.** The boot-time update check was
  removed entirely; only the on-demand `/update` command fetches. The cache moved from
  `process.cwd()/.bimax/` to the user cache dir (`$XDG_CACHE_HOME/bimax` or `~/.bimax`).
  The default upgrade command and manifest now match the actual standalone-binary channel
  (install.sh / GitHub releases) instead of suggesting `npm i -g` for a non-npm install.
- **ACP marked experimental and made honest.** Truthful capabilities (`image: false` — the
  bridge drops image blocks; embedded context true), including MACHINE-READABLE session
  semantics: `agentCapabilities.sessions = { concurrent: false, isolated: false, model:
  'single-supersede' }`. Per-session `mcpServers` are explicitly rejected instead of
  silently ignored. One session and one turn at a time: a new session supersedes (and
  resets) the previous one; prompts against superseded/unknown ids and concurrent prompts
  are rejected clearly (driver extracted to `acp/driver.ts` and fully behavior-tested:
  supersede, stale ids, busy, cancellation). Outbound JSON-RPC requests have a finite
  timeout (default 5 min, `BIMAX_ACP_REQUEST_TIMEOUT_MS`). Power/update/log posture is no
  longer streamed as assistant answer text.
- **LLM provider circuit breaker: user cancellation excluded.** An aborted request (Ctrl+C /
  Esc) records nothing — interrupting long streams can no longer open the breaker.

### TUI / protocol

- Operational `log` events render ONLY in the Ctrl+O log panel — never echoed into the chat
  transcript (regression-tested).
- **Semantic parity for `ui_snapshot`.** A typed fixture (every optional field populated) is
  strict-decoded by the Go TUI; a field the engine produces that the TUI doesn't model fails
  the test. This immediately surfaced six silently-dropped fields (`sessions`,
  `checkpoints`, `git`, `tools`, `computer.desktopTools/vision/grants`) — now modeled — and
  the never-consumed Grok `power`/`update` footer chips, which were **deleted** from the
  snapshot payload.
- **Alternate-screen viewport renderer** (ADR-001): the transcript is model state and every
  frame is a pure function of it. Resize REFLOWS state at the new width — committed output
  is never cleared, reprinted, or repaired (the inline renderer's narrow-resize
  clear+reprint repair, the tea.Println commit path, and the settle/debounce machinery are
  all DELETED). PgUp/PgDn scroll the transcript; the session transcript is printed once
  after exit so the conversation survives in native scrollback. PTY-proven: a `resize-storm`
  scenario asserts zero 2J/3J clear escapes after startup and zero duplicate committed lines
  across repeated narrow/wide resizing.
- PTY approval scenarios pin `BIMAX_COMPUTER_APPROVALS=always` (new env override); they had
  been silently broken by the earlier `high-impact-only` default. A separate
  `approval-default` scenario now ALSO exercises the shipped production default with no
  override — a routine open auto-approves with no prompt (announced in the Ctrl+O log
  panel), while a high-impact `record_start` still renders a real, keyboard-driven prompt —
  proving the override conceals nothing.
- Auto-approved computer actions are recorded in the log panel (auditable), not just a
  transient status flash.

## [Unreleased] — fix-to-10 hardening

Driven by the frozen Six-Stage Launch Audit. Gates close Must-Fix blockers before v1.0.

- **Repo hygiene** — committed the working-tree baseline; removed 481 MB of stray
  `.bun-build` scratch blobs and a stray `node_modules` conflict symlink; `.bun-build` is now
  gitignored and swept by `build-release.sh`.
- **CI** — added `.github/workflows/ci.yml`: engine typecheck/lint/test + TUI build/vet/test
  on macOS and Linux, plus a protocol-fixture drift check.
- **Docs** — added root `README.md`; corrected `ARCHITECTURE.md` and engine comments that
  described the retired React/Ink front-end as if it were live (the sole front-end is the
  Go / Bubble Tea TUI); collapsed 15 overlapping planning docs into this lean set.
- **TUI render fixes** — the diff card no longer renders git's "No newline at end of file"
  marker as line 1; the green/red diff background no longer bleeds to column 0 after a turn
  commits (the commit path re-wrapped already-fitted rows); overwrite diffs keep monotonic
  line numbers. Regression tests added.
- **Write tool** — no longer silently overwrites an existing file for a new-document request;
  it picks a non-colliding name.
- **Lint green** — cleared the 65 eslint errors that were failing CI's engine job (main's
  required check was red). `no-require-imports` is now a warning (the lazy-`require` cycle-break
  pattern is deliberate); the 26 real findings (dead escapes, useless assignments, ternary
  statements, inconsistent returns) are fixed. `eslint` exits 0.
- **`/perf`** — hidden, local-only engine performance readout: cold-start (load → ready),
  per-turn time-to-first-token (p50/p95), and memory. Pure in-process counters, no egress.

## History

The pre-1.0 build history (dual-model routing, the epistemic/ledger "second mind", the Mind
HUD, blueprint builders, MCP self-healing, the one-click single-binary packaging) is recorded
in the git log and summarized in `FEATURES.md` and `ARCHITECTURE.md`.
