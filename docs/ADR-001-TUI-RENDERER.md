# ADR-001 — TUI renderer: alternate-screen viewport (transcript as state)

Date: 2026-07-22 · Status: **Accepted** (revised same day — see history below)

## Context

The TUI previously rendered as a hybrid: committed transcript lines flushed into the
terminal's native scrollback via `tea.Println`, plus a live region redrawn in place. That
hybrid was the source of ghosting, clipping, duplication, and a narrow-resize repair that
**cleared the visible screen and reprinted a screenful of committed output** — a direct
violation of the stabilization contract ("resize must reflow state, not clear and reprint
terminal history").

## Why inline could not be fixed

After a terminal narrows, previously painted physical rows are reflowed *by the terminal*.
The inline renderer counts logical lines, not post-reflow physical rows, so it can no longer
locate its own region: anything it does is either leave ghost rows (broken frames in
scrollback) or clear-and-reprint (the banned repair). This is inherent to inline rendering,
not an implementation bug — no PTY test could prove a repair-free inline renderer because
none can exist under reflow.

## Decision

**Alternate-screen viewport, transcript as model state** (`tea.WithAltScreen()`):

1. **The transcript is state.** `m.lines` holds logical (unwrapped, styled) committed lines
   — the single source of truth. `View()` derives every frame purely from state: transcript
   window (re-wrapped at the *current* width) → live open stream block → pinned chrome.
2. **Resize is a pure reflow.** `WindowSizeMsg` just records the new size; the next frame
   re-wraps from logical lines. There is no settle debounce, no repair, no `ClearScreen`,
   no reprint. The `tea.Println` commit path, `printQueue`, `pendingClear`,
   `resizeAt/resizeNarrowed` are all **deleted**.
3. **Committed output is immutable.** `append()` is still the single commit path; committed
   lines are never mutated, only re-wrapped for display.
4. **Scrolling**: PgUp/PgDn move a clamped `scrollOff` (0 = pinned to the live tail, with a
   visible "scrolled up N lines" indicator). Long live content commits block-by-block
   (`commitAssistantStream`), so nothing is silently clipped from the top — it is scrollable
   transcript.
5. **Transcript survival**: on exit the session transcript is printed once into the real
   terminal (the alt screen restored the user's shell exactly as it was), so the
   conversation still ends up in native scrollback.
6. **Transcript purity**: operational `log` events render only in the Ctrl+O panel
   (`TestLogEventsStayOutOfTranscript`); a context-token refresh is `context_changed`, never
   a fake "code graph updated".
7. **No silent protocol drift**: the ui_snapshot payload is covered by a typed fixture
   strict-decoded on the Go side (`TestUiSnapshotFixtureStrictDecode`).

## Proof

- Go: `TestResizeReflowsWithoutClearOrReprint` — a narrow/wide storm leaves every committed
  line rendered exactly once, every row within width, and the logical transcript untouched.
- PTY (`scripts/tui-regression.py`, real binary + pyte): `resize-storm` asserts **zero
  `2J`/`3J` clear escapes after startup** and zero duplicate committed lines across repeated
  narrow/wide resizing; `streaming` asserts no in-session duplication; plus startup,
  interrupt, SIGTERM, keyless, and five approval scenarios (including one that runs the
  production approval defaults with no override).

## Trade-offs accepted

- Native terminal scrollbar/mouse-selection of the *live* session is traded for
  state-derived scrolling (PgUp/PgDn) — the standard behavior of full-screen terminal apps.
  The post-exit transcript print restores native selection/scrollback after the session.
- `transcriptCap` (2000 lines) bounds in-memory history; older lines drop from the scroll
  range (they were equally unreachable before once out of terminal scrollback).

## History

An earlier same-day revision of this ADR retained the inline renderer on the argument that
its narrow-repair was "bounded". That did not meet the acceptance criterion (*no*
clear/reprint of committed output on resize) and was replaced by this decision.
