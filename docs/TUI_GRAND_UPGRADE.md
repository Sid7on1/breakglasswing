# BiMax TUI Grand Upgrade — Master Plan

**Date**: 2026-06-17
**Inputs**: `bimax-vs-cc-audit/` (34-category audit, dated 2026-06-15) · current `src/cli` · prior `docs/GRAND_PLAN.md`
**Status of prior work**: TUI Phases 1–4 shipped; capability layer (Phases A/B/C6/C7) + sub-agent tool tree + live tool-arg streaming shipped this cycle (all on `main`).

---

## Shipped from this plan (batch 1)

| Feature | Open with | Track | File(s) |
|---|---|---|---|
| **Command Palette** | `Ctrl+G` | Palette & Input | `commands/registry.ts` (`getPaletteOptions`), `keybindings.ts`, `FullScreen.tsx` |
| **Plugin Hub** | `/plugins` (`/hub`) | Integration surfacing | `commands/plugins.ts` |
| **Security Cockpit** | `/security` (`/sec`) | Integration surfacing | `commands/security.ts` |
| **Diagnostics** | `/diagnostics` (`/diag`) | Integration surfacing | `commands/diagnostics.ts` |
| **Throughput HUD** | footer (while streaming) | Streaming polish | `components/Footer.tsx` |
| **Multi-line input** | `\`+Enter (Enter sends) | Palette & Input | `components/SimpleInput.tsx` (`insertNewline`), `FullScreen.tsx` |
| **Full-output viewer** | `/output` (`/tools`) | Tool surface (T2 value) | `toolHistory.ts`, `commands/output.ts`, `events.ts` |
| **Thinking shimmer** | (automatic, while thinking) | Theming & motion | `components/ShimmerText.tsx`, `ThinkingText.tsx` |

340 → 396 tests (+56), 0 tsc errors across the batch; each shipped green and pushed to `main`. Registry-derived features (palette, hub, cockpit, diag, output) auto-appear in `Ctrl+G`. **Deferred (higher-risk render-core / focus work):** true *in-place* collapse/expand (needs a focusable-row layer outside `<Static>`), synchronized-output (BSU/ESU) flicker fix, overlay-host + selector-store generalization, a11y plain-output mode, up/down line-navigation in the composer.

## Shipped from this plan (batch 2)

| Feature | Open with | Track | File(s) |
|---|---|---|---|
| **Synchronized output** (BSU/ESU flicker fix) | `BGW_SYNC_OUTPUT=1` (opt-in) | Streaming polish | `syncOutput.ts`, `repl.ts` |
| **Context-usage meter** | token line (automatic) | Streaming polish | `components/ProgressBar.tsx`, `FullScreen.tsx` |
| **Reduced-motion mode** | `/a11y` (`/motion`), `BGW_REDUCED_MOTION` | a11y | `commands/a11y.ts`, `ShimmerText.tsx`, `WorkingIndicator.tsx` |
| **Session browser / resume** | `/sessions`, `/resume` | Session & Context | `commands/session.ts` |
| **ANSI theme down-mapping** | `*-ansi` themes | Theming & motion | `themes.ts` (`toAnsi`, `parseColor`) |
| **Orchestration HUD** (4th cockpit) | `/orchestrate` (`/orch`) | Multi-agent | `commands/orchestrate.ts`, `agentRouter.ts` |

396 → 428 tests (+32), 0 tsc errors. The four flagship cockpits are complete: **Plugin Hub** (`/plugins`), **Security Cockpit** (`/security`), **Diagnostics** (`/diagnostics`), **Orchestration HUD** (`/orchestrate`) — each registry-derived, so all appear in `Ctrl+G` and `/` autocomplete with no drift. Render-core changes (sync output, shimmer, reduced-motion) are feature-gated to keep the default render path byte-identical.

---

## 0. Context — why this plan exists

The 34-doc audit measured BiMax (3.3K-line, ~19-component, **stock-Ink** TUI) against Claude Code (60K-line, 389-component, custom-Ink-fork TUI). The verdict stands: **we do not port CC's engine** — we cherry-pick techniques and, above all, **make BiMax's own moat visible**. BiMax already *leads* CC on integration (MCP client+server, custom commands, hooks, skills, watchers), security (7-layer governor, blast-gate, sandbox, checkpoints), multi-agent orchestration, theming (11 themes), and a11y (daltonized themes) — but almost all of that power is **invisible in the TUI** today. This plan turns invisible power into a controllable cockpit, and closes the few genuine interaction gaps (multi-line input, command palette, collapsible output), on stock Ink.

### Already shipped — explicitly NOT re-planned
The audit predates recent work. These audit "gaps" are **done**: markdown tables (`MarkdownTable.tsx`) + LRU/fast-path lexing (`Markdown.tsx`); word-level inline diff (`computeWordDiffs` in `ToolCallLine.tsx`); per-tool timing badges + sub-agent tool tree (`ToolCallLine.tsx`); OSC rich notifications + OSC 9;4 progress (`notify.ts`, `FullScreen.tsx`); React error boundary (`ErrorBoundary.tsx`); ghost-text + `@`-path/symbol completion (`atMention.ts`, `SimpleInput.tsx`); basic transcript search (`SearchHighlight.tsx`, `SearchResults.tsx`, `FullScreen` `searchMatches`); footer model-tier + capability glyphs (`Footer.tsx`). Tracks below **build on**, not repeat, these.

---

## 1. Vision

BiMax's terminal becomes a **cockpit**: a fast, flicker-free, keyboard-driven surface where the agent's hidden machinery — every active sub-agent, every armed security layer, every connected MCP server/hook/skill, every tool's full output — is one keystroke away, and where composing prompts feels like a real editor. All on stock Ink, with non-Claude/FLOOR behavior and the security/graph cores untouched.

## 2. Guardrails (carried from `GRAND_PLAN.md`)

- **Stock Ink only.** No custom screen-buffer / cell-diff / Yoga / DECSTBM engine, no `api-adapter` monkeypatch of streaming.
- **Model-agnostic.** No feature may *require* Claude; FLOOR/non-Claude behavior stays byte-identical on the hot paths.
- **Cores stay.** Security governor, graph-native context engine, multi-agent orchestration are surfaced, never rebuilt.
- **Each phase ends green:** `tsc --noEmit` clean, `jest` all-pass, CLI boots, and new interactive surfaces get `ink-testing-library` coverage.
- **Additive on the streaming hot path.** Anything touching `chat()`/agent-loop streaming is additive + throttled (per the B4 pattern).

---

## 3. Upgrade Tracks

### Track 0 — Interaction Core *(enabler — build first)*
**Goal:** the primitives every panel/palette/HUD needs, so we build them once.
- **Overlay/modal host**: a `useOverlayStack` hook + an absolutely-positioned `<Box>` layer rendered in `FullScreen`'s live region (never inside `<Static>`), so dialogs/palettes/HUDs float without a screen rewrite. Files: new `src/cli/overlay/`, `src/cli/screens/FullScreen.tsx`.
- **Keybinding context stack** ✅ *shipped*: flat `useInput` refactored into a priority dispatcher (`dispatchKey` + `KeyContext`/`CONTEXT_PRIORITY` in `keybindings.ts`) walking Permission → Overlay → Search → Chat → Global. Additive — every existing chord lives unchanged in the Global context; the old fall-through order is reproduced exactly and locked by 8 dispatcher tests. Files: `src/cli/keybindings.ts`, `FullScreen.tsx`.
- **Focusable interactive rows**: a minimal focus model (`useFocus`/index cursor) for rows that live in the live region (committed `<Static>` stays write-once; *interactive* rows render just above it). Enables collapse/expand + pickers.
- **Selector store slice**: wrap `appStore` (`src/state/app.state.ts`) in `useSyncExternalStore` + `useAppState(selector)`; peel streaming-text + footer fields out of `FullScreen` so streamed tokens stop re-rendering the whole tree.
- **Effort:** L · **Risk:** med (central input/render path) · **Prereq for:** Tracks 1–4.
- **Ships deferred items:** unblocks T2 (collapse/expand).

### Track 1 — Command Palette & Input
**Goal:** make BiMax fast to drive and prompts real to write.
- **Fuzzy command palette** (Ctrl+K): overlay listing **registry-derived** commands (fixes the hardcoded `COMMAND_REGISTRY` drift in `FullScreen.tsx` — single source of truth via `globalCommandRegistry.getAllCommands()`), `fuzzysort` ranking (already a dep), category grouping, descriptions. Files: `src/cli/commands/registry.ts`, `FullScreen.tsx`, `InteractiveMenu.tsx`.
- **Multi-line composer**: soft-wrap rows, Enter submits / Shift+Enter (or `\`+Enter) newline, full cursor nav, reusing the pure `editLine()`. Files: `SimpleInput.tsx`, `InteractivePrompt.tsx`, tests in `lineedit.test.ts`.
- **Prompt history** (↑/↓) + **Ctrl+R reverse-search** persisted per project.
- **Autocomplete dropdown polish**: unify `/`-fuzzy + `@`-symbol + `@`-path into one overlay dropdown with selection highlight (ghost-text already exists).
- **Effort:** L · **Risk:** med (cursor math across wrapped rows).

### Track 2 — Interactive Tool & Diff Surface
**Goal:** end "truncation regret" and approve with full context.
- **Collapse/expand tool output** (deferred **T2**): focus a tool row, Enter/Space toggles clipped ↔ full. Needs Track 0 focusable rows. Files: `ToolCallLine.tsx`, `FullScreen.tsx`.
- **Tool-aware permission dialog**: per-tool bodies — Bash shows command+cwd, Edit/Write shows an inline syntax-styled **diff preview** (reuse `ToolCallLine` diff renderer), WebFetch shows URL/domain; "always allow this pattern" option. Files: `PermissionDialog.tsx`, `notify.ts` (pending-too-long bell).
- **Effort:** M · **Risk:** low.

### Track 3 — The Cockpits *(flagship surfacing)*
**Goal:** make BiMax's invisible moat a visible, controllable control center. Each is an overlay (Track 0).
- **Orchestration HUD**: live side-rail of active agents/personas — current tool, *why* routed ("matched `/routes` pattern X"), plan-mode proposals; `/agents` hot-swap palette. Files: `agentRouter.ts`, `subagent.manager.ts` (already emits child tool events), persona files, new overlay.
- **Security Cockpit**: color-coded panel of the 7 governor layers (sandbox/diffApproval/blastGate/selfCritic armed state), pending-edit **blast radius** ("touches 3 CRITICAL symbols: …" from the graph), checkpoint timeline for one-key rollback. Files: governor config, graph criticality, `PermissionDialog.tsx`.
- **Plugin Hub** (`/plugins`): browse/toggle/reload connected MCP servers (status, tool count), `.bimax/commands`, active hooks (last-fire), watchers, routes; inline transcript badges on hook/watcher fire; hot-reload-on-change toast. Files: `mcp.manager.ts`, `loadCustomCommands()`, hooks, `SkillLoader`, `watchers.ts`.
- **Diagnostics dashboard** (`/diagnostics`): live memory (`memory.monitor.ts`), watchdog, token/cost rollup, structured-event tail; add a JSONL log sink. Files: `src/telemetry/*`, `Dashboards.tsx`.
- **Effort:** L (M each) · **Risk:** med · **Value:** the headline wow.

### Track 4 — Session & Continuity
**Goal:** never lose your place.
- **Resume picker**: full-screen `InteractiveMenu` of sessions (title, message count, last-active, live preview pane); restore persona + model tier from metadata; warn on cwd mismatch. Files: `session.ts`, `commands/session.ts`, `InteractiveMenu.tsx`.
- **Session tab strip**: top bar of saved sessions, `Ctrl+1..9`/`Ctrl+Tab` to switch (one renders at a time; rehydrate via existing resume machinery — no concurrent PTYs). Files: session store, `FullScreen.tsx` root state.
- **Rich `/replay` export**: fenced code, tool blocks, timestamps.
- **Effort:** M · **Risk:** med.

### Track 5 — Render Polish & Performance
**Goal:** make it *feel* native and stay cool on long sessions.
- **Synchronized output (BSU/ESU)**: wrap each frame in `\x1b[?2026h…l` + strip the phantom trailing `\n`; flicker-free repaints *and* flash-free resize (shared). New `src/cli/sync-output.ts`; `repl.ts`/`FullScreen.tsx` resize path. Feature-detected, fallback to current behavior.
- **Transcript memoization**: `React.memo` committed rows keyed by id + `useMemo` parsed markdown/diff per message. Files: `Transcript.tsx`, `ToolCallLine.tsx`, `Markdown.tsx`.
- **Streaming throughput HUD**: rolling tokens/sec + chars/sec + elapsed in `Footer.tsx` from existing `streamMeta`; optional capped typewriter reveal.
- **Animation**: shimmer sweep over the active verb, a single shared `useAnimationFrame` driver replacing scattered `setInterval`s, real determinate progress bar for long tools (wires the unused `progressFill`/`progressEmpty`), reduced-motion fallback. Files: `ThinkingText.tsx`, `WorkingIndicator.tsx`, `Footer.tsx`, new `hooks/useAnimationFrame.ts`.
- **Effort:** M · **Risk:** low-med (sync-output on exotic terminals).
- **Ships deferred items:** **T1** (stable-prefix) folds into memoization scope if measured worthwhile.

### Track 6 — Resilience & Reach
**Goal:** survive crashes; widen who can use it.
- **Crash-recovery overlay + retry**: the existing `ErrorBoundary` swaps to a recoverable overlay (stack, last user turn, `[r]etry / [c]opy report / [d]ismiss to safe mode`); wire retry into the checkpoint system. Files: `ErrorBoundary.tsx`, `FullScreen.tsx`, checkpoint manager.
- **A11y plain-output mode** (`/a11y`): linearize the TUI (suppress spinners/redraws/box-art; append-only labeled text) for screen readers/logs; visible focus ring on the active element. Files: `themes.ts`, `FullScreen.tsx`, `ToolCallLine.tsx`, `SimpleInput.tsx`.
- **Test harness**: `ink-testing-library` snapshot + scripted-keystroke (`stdin.write` → assert `lastFrame()`) tests for every new overlay/HUD/picker. Files: `src/__tests__/`.
- **Effort:** M · **Risk:** low-med.

### Track X — Ink version bump *(optional foundation, gated)*
Audit pins **Ink v3.2.0**; Ink 4/5 (still "stock") improves focus/hooks/perf. **Risk: major API drift.** Treat as an isolated spike with a full smoke test; **not a dependency** for other tracks (all are buildable on 3.2.0). Decide after Phase 0. Files: `package.json`, build config.

---

## 4. Flagship features (the wow)

1. **Command Palette (Ctrl+K)** — fuzzy over *all* registered commands; permanently kills the hardcoded-list drift. The "how do I…?" answer becomes a keystroke.
2. **Orchestration HUD** — `/swarm`/`/council`/personas stop being a black box; you watch agents work and see *why* each route fired.
3. **Security Cockpit** — BiMax's industry-leading 7-layer governor + graph blast-radius become a visible, trust-building panel instead of invisible config.
4. **Plugin Hub** — the biggest moat (MCP + custom commands + hooks + skills + watchers) becomes one browsable, reloadable control center.
5. **Multi-line composer + history + Ctrl+R** — the single biggest daily-friction fix; composing/recalling real prompts feels like an editor.

## 5. Sequenced roadmap

| Phase | Tracks / items | Why here | Exit criterion |
|---|---|---|---|
| **P0 — Enabler** | Track 0 (overlay host, keybinding context stack, focusable rows, selector slice) | Unblocks every palette/panel/HUD; do once | A skeleton overlay opens/closes/focuses + routes keys; streaming no longer re-renders whole tree; tsc+jest+boot green |
| **P1 — Input & Palette** | Track 1 | Highest daily-friction wins; palette rides Track 0 | Ctrl+K fuzzy palette over registry; multi-line + history + Ctrl+R; ink-tests pass |
| **P2 — Tool surface** | Track 2 | Rides Track 0 focus; high felt value | Collapse/expand toggles on focused tool; permission diff preview |
| **P3 — Cockpits** | Track 3 | The flagship; rides overlay host | Each HUD renders live data, toggles, reloads; ink-tests |
| **P4 — Sessions** | Track 4 | Continuity; reuses pickers | Resume picker + tab-strip switch rehydrates correctly |
| **P5 — Polish & Perf** | Track 5 | Make it feel native; safe last | Flicker-free repaint/resize; memoized transcript; throughput HUD; shimmer |
| **P6 — Resilience & Reach** | Track 6 + (decide Track X) | Hardening + reach | Crash-recovery retry works; `/a11y` mode; new-surface tests green |

Ordering principle: **(impact + unblocks) ÷ effort**, enabling architecture first.

## 6. Risks & mitigations

1. **Overlay/focus fights single-`FullScreen` + `<Static>`** → Track 0 is an isolated, test-first primitive; overlays + interactive rows live in the live region, committed history stays in write-once `<Static>`.
2. **Streaming-hot-path / re-render regressions** → selector subscriptions + `React.memo`; HUDs render only when open; keep the B4 throttle discipline.
3. **Keybinding refactor breaks existing chords** → context stack is additive (current chords = Global context); lock with `matchChord` tests before migrating.
4. **Synchronized-output corrupts frames on exotic terminals** → feature-detect (`$TERM_PROGRAM`/tmux), gate behind a flag, fall back to today's behavior.
5. **Ink major bump API drift** → isolated spike, full smoke test, not a dependency; ship only if clean.

## 7. Out of scope (protect the moat)

Custom Ink engine / cell-diff / DECSTBM / Yoga rewrite (doc 01/32 deep) · 389-component tree + viewport manager (doc 02) · full state-mgmt rewrite (doc 24 — only the narrow selector slice) · true concurrent multi-tab / background PTYs (doc 26 core) · SSH/remote/IDE extension (doc 27) · full i18n framework/RTL (doc 31, optional string-centralization only) · Keychain native module (doc 28) · crash telemetry upload (privacy).

## 8. Verification

Per phase: `npx tsc --noEmit` (0 errors) · `npx jest` (all pass) · `bimax` boots and the new surface works by hand · `ink-testing-library` tests for each new overlay/HUD/picker (scripted keystrokes → `lastFrame()` assertions). Commit per track; push to `main` after each phase ends green.
