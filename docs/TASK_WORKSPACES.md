# Tasks, Tabs, and Workspaces — Decision Record

**Decision (2026-07-18): BiMax does not implement terminal tabs. It uses one
conversation workspace plus a bottom live region of focusable, state-carrying
panels and chips.** "One tab per command" was evaluated and rejected.

## What was evaluated

| Approach | Verdict | Why |
|---|---|---|
| One tab per command | **Reject** | ~89 commands, most complete in <1s; tabs would outnumber content. Completed short commands belong inline in the transcript, which BiMax already treats as immutable scrollback. |
| Literal tab bar (Warp/browser style) | **Reject** | Bubble Tea inline mode + immutable scrollback is the responsiveness architecture (no alt-screen repaints). A tab bar forces full-screen ownership, resize storms corrupt inline content, and it duplicates what Zellij/tmux/Ghostty already do better one layer down. |
| Zellij/tmux-style internal panes | **Reject** | Reimplements a multiplexer inside a CLI; huge complexity, competes with the user's own multiplexer. |
| One workspace per agent session | **Adopted long ago** | A BiMax process *is* a session workspace; `/sessions` + `/resume` switch between them, the desktop app lists them. |
| Panel per active process / task rail | **Adopt** | Long-running work is promoted to live bottom-region panels with real state, while the conversation stays the single narrative thread. |

## The implemented model

The conversation is the workspace. Long-running work surfaces as live state,
never as navigation:

- **Sub-agents** — the 🤖 panel: one line per agent with live status, spinner,
  and terminal ✓/✗; `Ctrl+A` focuses, `↑/↓/enter` expands to PROMPT/TOOLS/
  OUTPUT. Nested tool calls route to their agent's card (`parentId`), not the
  transcript. Failure of one agent never blocks the UI.
- **Outcome contract** — the ◆ strip: phase, passed/required criteria, active/
  waiting/blocked task counts, elapsed time for engine-owned long tasks.
- **Task list** — the pinned todo panel above the prompt.
- **Browser session** — the ◍ footer chip (host only), fed by the engine's
  `ui_snapshot.computer` posture; warn-tinted when tainted web content has
  entered the conversation. Details live in `/computer`. A live automated
  browser is never invisible.
- **Mind/goals/workspace chips** — compact state, expandable via `Ctrl+X`,
  `/self`, `/workspace`.

State names are explicit where they exist today: sub-agents run → done/failed
with phase; outcomes run → verified/blocked/failed; browser actions return
running/reset/failed-with-reason summaries.

## Why this fits BiMax

1. The renderer's core invariant is *immutable scrollback + pinned live
   region* — panels extend it; tabs would break it.
2. Parallelism in BiMax is agent-shaped (swarm/beast sub-agents), not
   command-shaped. The sub-agent panel is the task switcher.
3. Users who want real tabs have them in their terminal; `bimax` per tab gives
   isolated session workspaces for free, with `/resume` as the recovery path.

## Deliberately deferred (marked, not hidden)

- Promoting a long-running *shell* process to its own live panel (today long
  shell output streams inline; acceptable, not ideal).
- A keyboard task switcher across panels beyond `Ctrl+A`/`Ctrl+X`.
- Browser panel with last-action/loop-state detail (the chip shows presence;
  the failure-loop nudge lives in tool results).
