# Bimax TUI Improvement Plan (vs Claude Code)

**Date**: 2026-06-16
**Source audit**: `/Users/vishsiddharth/Desktop/bimax-vs-cc-audit` (34 categories)
**Reference codebase**: `/Users/vishsiddharth/Desktop/claude-code-source-all-in-one`
**Verified against**: current `Bimax/src` (post Phase 2/3/4 TUI commits)

---

## 0. Verification Summary — what the audit got wrong

The audit was written against the older `breakglasswing` tree. Re-checking every
high/medium claim against the **current** code, several "gaps" are already closed:

| Audit claimed missing | Reality in current code | Evidence |
|---|---|---|
| Input history (up/down) | **Already built**, persisted to `~/.breakglass/history.json` (100 entries) | `FullScreen.tsx:84-101, 395-417` |
| Shell edits Ctrl+A/E/U/K/W | **Already built** via pure `editLine()` | `SimpleInput.tsx:4-25` |
| Separate keybindings system | **Already built**, rebindable | `keybindings.ts` |
| Slash + `@symbol` autocomplete | **Already built** (graph-backed) | `FullScreen.tsx:340-361`, `atMention.ts` |
| Multi-line paste | **Already built** (collapsible chips) | `SimpleInput.tsx:118-122` |
| Markdown blockquotes | **Already built** | `Markdown.tsx:89-94` |
| Edit stats (+N/-M) | **Already built & shown** | `ToolCallLine.tsx:68-91` |
| Tool spinner | **Already built** | `ToolCallLine.tsx:8-15` |
| Console→log redirect | **Already built** | `FullScreen.tsx:574-586` |
| Graceful agent error catch | **Already built** | `FullScreen.tsx:1082-1093` |

**New findings the audit missed:**
- `MarkdownRenderer.tsx` (160 LOC) is **dead code** — only `Markdown.tsx` is wired in. Delete it.
- `frame.buffer.ts` `FrameBuffer` (109 LOC) is **dead code** — but resize already works via clear+remount (`FullScreen.tsx:261-289`). There is **no** active eraseLines "left-margin bleed" bug. Wiring FrameBuffer is optional, not a fix.
- Tool timing is **already tracked** (`events.ts:74-81` `startTime`/`endTime`) but **never displayed** — a near-free win.

**Confirmed real gaps** (these drive the plan): markdown tables, streaming-markdown
optimization, word-level diff, transcript search, terminal notifications, React error
boundary, tool timing badge, ghost text / file-path completion, progress bar, dead-code cleanup.

---

## Guiding principles

1. **Keep Bimax's simplicity advantage.** 17 components, flat tree, stock Ink. Do NOT
   port CC's 15K-line custom Ink engine, panel/modal system, or multi-screen router.
2. **Port techniques, not architecture.** Each item below has a concrete CC reference
   snippet — copy the *algorithm*, fit it to Bimax's idioms.
3. **Highest impact-per-LOC first.** Order phases by user-visible value ÷ effort.
4. **Verify before building.** Every claim above was checked; re-check `file:line` before editing (the tree moves).

---

## Phase 1 — Quick wins & cleanup (XS/S, ~1 day)

Goal: visible polish + remove rot, near-zero risk.

### 1.1 Tool timing badge 🟢 highest ROI
- **Gap**: timing tracked, never shown.
- **Do**: in `ToolCallLine.tsx`, when `status==='success'|'error'` and `endTime` set,
  render `(0.3s)` after the summary using a `formatDuration(ms)` helper.
- **CC ref**: `src/utils/format.ts:34-76` (`formatDuration`, `formatSecondsShort` → `${(ms/1000).toFixed(1)}s`).
- **Files**: `ToolCallLine.tsx`, new tiny `src/cli/format.ts`. **~30 LOC. Risk: none.**

### 1.2 Delete dead code
- Remove `src/cli/components/MarkdownRenderer.tsx` (unreferenced).
- Decide on `src/cli/frame.buffer.ts`: delete, OR keep with a `// not wired — see Phase 6` note. Recommend **delete** (resize already works).
- **Risk: none** (verify zero imports first).

### 1.3 Terminal notifications (iTerm2 / Kitty / Ghostty + tmux)
- **Gap**: only `\x07` bell.
- **Do**: new `src/cli/notify.ts` with `osc()`, `wrapForMultiplexer()`, and
  `notifyDone({title,message})` that detects `$TERM_PROGRAM`/`$KITTY_WINDOW_ID`. Call it
  from the turn-complete path that already writes the bell (`FullScreen.tsx:1080`).
- **CC ref**: `src/ink/useTerminalNotification.ts:33-120`, `src/ink/termio/osc.ts:35-44` (tmux `\x1bPtmux;…\x1b\\` wrapping).
- **Files**: `notify.ts` (new), `FullScreen.tsx`. **~60 LOC. Risk: low.**

### 1.4 Status-bar progress affordance
- Theme already defines unused `progressFill`/`progressEmpty`.
- **Do**: minimal `▰▱` bar in `Footer.tsx` driven by a `progress` event (0–1); also emit OSC 9;4 from `notify.ts` for supporting terminals. Optional/low.
- **Files**: `Footer.tsx`, `events.ts`. **~50 LOC. Risk: low.**

---

## Phase 2 — Markdown depth (M, ~1-2 days)

Goal: close the most *visible* rendering gap.

### 2.1 Markdown tables (biggest visible gap)
- **Do**: add `case 'table'` to `Markdown.tsx`. Port CC's 3-phase column sizing
  (min-width = longest word; ideal = full content; shrink proportionally; hard-wrap
  fallback) + box-drawing borders + narrow-terminal vertical fallback.
- **CC ref**: `src/components/MarkdownTable.tsx:106-238` (sizing + `renderBorderLine`), `:241-288` (vertical fallback).
- **Files**: new `src/cli/components/MarkdownTable.tsx`, wire into `Markdown.tsx`. **~150 LOC. Risk: low** (additive token case).

### 2.2 Streaming-markdown optimization (perf, no visual change)
- **Gap**: `marked.lexer(children)` runs in full on **every** render of streaming text.
- **Do**: (a) `cachedLexer()` with a 500-entry LRU `Map` keyed by content hash + a
  `hasMarkdownSyntax()` fast-path; (b) `StreamingMarkdown` wrapper that keeps a
  `stablePrefixRef` and only re-lexes the unstable suffix. Use it for the live streaming
  preview (`FullScreen.tsx:1307`).
- **CC ref**: `src/components/Markdown.tsx:22-71` (cache), `:186-235` (stablePrefix).
- **Files**: `Markdown.tsx`, `src/cli/format.ts` (hash). **~120 LOC. Risk: medium** — test prefix-reset on text replacement.

---

## Phase 3 — Diff & search (M, ~2 days)

### 3.1 Word-level inline diff
- **Gap**: line-level only; `diff` package already installed (`structuredPatch` used in `fileEditor.ts`).
- **Do**: in `ToolCallLine.tsx` diff renderer, pair consecutive remove/add runs, run
  `diffWordsWithSpace(old,new)`, highlight changed words via `backgroundColor`
  (`theme.diffAddedWord`/`diffRemovedWord` — add to theme).
- **CC ref**: `src/components/StructuredDiff/Fallback.tsx:153-234` (pairing), `:230` (`calculateWordDiffs`), `:276-290` (render).
- **Files**: `ToolCallLine.tsx`, theme JSON files (+2 keys). **~120 LOC. Risk: medium.**

### 3.2 Transcript search (highest-impact medium item)
- **Gap**: Ctrl+F filters **logs only**; `searchIndex` state exists but is unused.
- **Do**: extend search to scan `messages` transcript; wire `searchIndex` for match
  count `"3 / 12"` + n/N prev-next navigation; reuse `SearchHighlight.tsx`.
- **Files**: `FullScreen.tsx` (search handler `:377-432`, render `:1240-1270`), `Footer.tsx` (count). **~120 LOC. Risk: low-medium.**

---

## Phase 4 — Input & resilience (M, ~2 days)

### 4.1 React error boundary (resilience)
- **Gap**: no boundary — a render-time component throw kills the whole TUI.
- **Do**: class `ErrorBoundary` (`getDerivedStateFromError` + `componentDidCatch` → log
  via `cliEvents`), render fallback panel, wrap `<FullScreen/>` in `repl.ts:40-47`.
- **CC ref**: standard React error-boundary pattern (CC wraps its tree similarly).
- **Files**: new `src/cli/components/ErrorBoundary.tsx`, `repl.ts`. **~50 LOC. Risk: low.**

### 4.2 Ghost text + file-path completion
- **Gap**: suggestions are a list; no inline gray ghost; `@` resolves symbols only, not paths.
- **Do**: (a) compute best-match suffix for `/command` mid-input, render gray after
  cursor in `SimpleInput.tsx`, accept on `Tab`/`→`; (b) extend `atMention`/suggestions to
  complete `@./` and `@~/` filesystem paths (LRU + short TTL).
- **CC ref**: `src/hooks/useTypeahead.tsx:403-417` (`syncPromptGhostText`); directory-completion pattern.
- **Files**: `SimpleInput.tsx`, `FullScreen.tsx` (`updateSuggestions`), `atMention.ts`. **~250 LOC. Risk: medium** — Tab is currently unbound; check collisions.

---

## Phase 5 — Tool display polish (S/M, optional, ~1 day)

- Interactive collapse/expand of truncated tool output (`MAX_OUTPUT_LINES=14`,
  `MAX_DIFF_LINES=40`) via a per-call `expanded` toggle (Ctrl+O-style on focused call).
- Nested sub-agent tool tree (indent sub-tools under parent) — only if swarm UX needs it.
- **Files**: `ToolCallLine.tsx`, `FullScreen.tsx`. **~150 LOC. Risk: medium.** **Priority: low.**

---

## Phase 6 — Rendering engine (DEFER / probably skip)

The audit's "High priority FrameBuffer fix" is **not** warranted: resize already works
(clear + `<Static>` remount), and there is no active eraseLines bleed. Only revisit if a
real flicker/scrollback bug appears. If so: wire `FrameBuffer` (BSU/ESU + absolute
positioning) as a custom Ink `stdout`, fix row-offset for static content. **Do NOT** port
CC's 15K-line custom engine. **Priority: low / on-demand.**

---

## Explicitly NOT doing (keep the simplicity moat)

- CC custom Ink fork / screen buffer / Yoga rewrite (15K+ LOC).
- Panel + modal stacking + multi-screen router + focus tree.
- `useSyncExternalStore` state refactor (event bus works fine for async).
- SSH/remote/IDE integration, i18n, list virtualization, visual config editor.
- Keychain storage (`.env` is acceptable) unless a security requirement lands.

---

## Sequenced roadmap

| Phase | Items | Effort | Impact | Risk |
|---|---|---|---|---|
| **1** | timing badge, dead-code delete, notifications, progress | ~190 LOC | High polish | None–Low |
| **2** | tables, streaming-md optimization | ~270 LOC | High (tables visible) | Low–Med |
| **3** | word-diff, transcript search | ~240 LOC | High (search) | Low–Med |
| **4** | error boundary, ghost text + path completion | ~300 LOC | Med–High | Low–Med |
| **5** | collapse/expand, tool tree | ~150 LOC | Low–Med | Med |
| **6** | FrameBuffer (on-demand only) | ~40 LOC | Low | Med |

**Total to meaningfully close the gap: ~1,000 LOC across Phases 1–4** (vs the audit's
inflated estimates that double-count already-built features).

### Recommended order
1. Phase 1 (one sitting — instant wins, clears rot).
2. Phase 2.1 tables, then 3.2 transcript search (most-requested visible features).
3. Phase 4.1 error boundary (cheap resilience).
4. Phase 2.2, 3.1, 4.2 as capacity allows.
5. Phases 5–6 only on demand.
