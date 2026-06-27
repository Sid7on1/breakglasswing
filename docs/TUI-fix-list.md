# TUI Migration — Wiring Audit

Date: 2026-06-21
Scope: Go Bubble Tea TUI (`tui/`) vs TS headless engine (`src/`)
File: This document tracks every protocol seam, event handler, and behavioral gap.

---

## 1. PROTOCOL COVERAGE

### 1.1 Outbound — engine → TUI (`protocol.ts` → `protocol.go`)

| `t:` kind | TS Type | Go Handler | Status |
|-----------|---------|------------|--------|
| `event` | `EventMsg` | `handleEvent()` → switches on `name` | ✅ |
| `request` | `RequestMsg` | `handleEngine()` stores fields → rendered in `promptView()` / `handleInputRequest()` | ✅ |
| `ready` | `ReadyMsg` | `handleEngine()` → `showWelcome()` | ✅ |
| `queryResult` | `QueryResultMsg` | `handleEngine()` → `completionView()` | ✅ |

All four outbound discriminant types are handled.

### 1.2 Inbound — TUI → engine (`protocol.go` → `protocol.ts`)

| Go Encoder | TS Inbound Type | Used Where | Status |
|------------|----------------|------------|--------|
| `encodeInput(text)` | `InputMsg` | Enter, Ctrl+G, Enter on command completion | ✅ |
| `encodeReply(id, value)` | `ReplyMsg` | Request overlay confirm/deny | ✅ |
| `encodeInterrupt()` | `InterruptMsg` | Ctrl+C mid-turn | ✅ |
| `encodeQuery(id, text)` | `QueryMsg` | Every keystroke for autocomplete | ✅ |
| `encodeMenuSelect(id, value)` | `MenuSelectMsg` | Menu option picked | ✅ |

All five inbound types are wired.

### 1.3 Event vocabulary — all `FORWARDED_EVENTS` covered

From `src/protocol/protocol.ts:79-90` (28 events):

| Event Name | Go Handler | Notes |
|-----------|------------|-------|
| `log` | ✅ `renderMessage` dim echo + Ctrl+O structured view | `success` level styled in log view, but **not** in transcript system messages |
| `message` | ✅ `renderMessage` → menu/dashboard/role dispatch | |
| `tool_call` | ✅ `renderToolCall` + `renderToolOutput` | |
| `tool_call_result` | ✅ Same as tool_call (updates existing line by ID) | |
| `spinner_state` | ✅ Busy tracking + elapsed + bell | |
| `status` | ✅ Footer update | |
| `mode_change` | ✅ `fMode` | |
| `model_tier` | ✅ `fTier`, `fPinned` | |
| `set_tier` | ✅ No-op (covered by model_tier) | |
| `cost_update` | ✅ Token estimation | |
| `todo_update` | ✅ `renderTodos` checklist | |
| `thinking` | ✅ Thought clock + snippet | |
| `thinking_clear` | ✅ | |
| `config_changed` | ✅ No-op (covered by ui_snapshot) | |
| `graph_changed` | ✅ Dim notification | |
| `cwd_changed` | ✅ Dim notification + `cwd` | |
| `mcp_changed` | ✅ Dim notification | |
| `rerun_onboarding` | ✅ Dim "skipped" notice | |
| `shutdown` | ✅ `tea.Quit` | |
| `loop_detected` | ✅ Error render | |
| `goals_changed` | ✅ No-op (covered by ui_snapshot) | |
| `stream_token` | ✅ Stitched into `transcriptBody` | |
| `ui_snapshot` | ✅ Footer + map + token meter | |
| `veto_prompt` | 🚫 Not forwarded (translated to `request` by host) | ⚠️ Not needed — handled as `kind:"prompt"` |
| `diff_prompt` | 🚫 Not forwarded (translated to `request` by host) | ⚠️ Not needed — handled as `kind:"diff"` |
| `input_prompt` | 🚫 Not forwarded (translated to `request` by host) | ⚠️ Not needed — handled as `kind:"input"` |

All reachable events handled. The three `*_prompt` events are never serialized as raw events — `host.ts` converts them to `request` messages.

---

## 2. SLASH COMMANDS — ENGINE → TUI TRACING

Architecture: The TUI **forwards every line starting with `/` verbatim** to the engine via `encodeInput()`. The single exception is `/shortcuts`, rendered Go-side. All 72+ commands registered in `src/cli/commands/*.ts` reach the engine's `HeadlessSession.dispatch()` → `runCommand()` → `globalCommandRegistry.execute()`.

### 2.1 Commands intercepted locally by TUI

| Command | Handler | File |
|---------|---------|------|
| `/shortcuts` | `renderShortcuts()` (line 1944) | `model.go:509` |

### 2.2 Commands with TUI-side keybinding shortcuts

| Keybinding | Command Sent | File |
|-----------|-------------|------|
| `Ctrl+T` | `/tier heavy` or `/tier lite` | `model.go:468` |
| `Ctrl+G` | Pre-fills `/` in input (palette) | `model.go:496` |

### 2.3 Command completions

- All slash commands appear in the autocomplete dropdown (engine queries `globalCommandRegistry.getPaletteOptions()`)
- `Tab` accepts highlighted completion, inserts command text + space
- `Enter` on a command completion sends it directly to engine

### 2.4 No missing commands

Every command registered in the engine is reachable from the TUI through the input or Ctrl+G palette. No commands are silently dropped.

---

## 3. ISSUES FOUND

### 3.1 `isAsk` field unused (low severity)

`protocol.go:18` — `Outbound.IsAsk` exists but never read. The AskUser tool sends `kind:"prompt"` with `isAsk:true`, but the TUI renders it identically to a governor veto prompt (numbered options). Functionally fine — the user still sees the question and can pick an option — but it could be surfaced differently (e.g. a distinct header like "AskUser would like to ask:").

### 3.2 System message `success` level falls through to dim style (medium-low)

`model.go:1250-1256` — In `renderMessage`, only `level == "error"` gets special styling (`errStyle`). The `success` level (emitted by some commands to confirm actions) renders as `dimStyle` (same as `info`). The Ink UI used green for success.

Fix: add a `case "success"` branch in the `default` handler.

### 3.3 `debug` log level missing (low)

`model.go:1825-1832` — The log view switch covers `error`/`warn`/`success` but not `debug` (from `LogLevel` type in events.ts). Falls through to `logInfo`. Cosmetic — debug logs are rare.

### 3.4 Transcript grows unbounded (high)

Ink UI had `compactTurns` — every 10 messages it collapsed past turns into a summary. The Go TUI appends every line to `m.lines` with no pruning. On long sessions (hundreds of turns) this will:
- Increase memory usage
- Slow down `refresh()` which joins + re-measures the entire transcript
- Make the viewport sluggish

No built-in `/compact` command exists either (the command doesn't exist in the engine).

### 3.5 Always-scrolls-to-bottom on new content (medium)

`model.go:1319` — `m.vp.GotoBottom()` called unconditionally on every `refresh()`. If the user scrolls up to read earlier transcript text, new streaming tokens or status updates yank them back down. Ink had auto-scroll lock (stop scrolling if user scrolled up, resume on manual scroll-to-bottom).

### 3.6 No Ctrl+L to clear terminal screen (low)

Ink UI's `FullScreen.tsx` handled Ctrl+L → `process.stdout.write('\x1bc')`. Not wired in the Go TUI. The engine's `/clear` command clears the transcript but doesn't clear the physical terminal screen.

### 3.7 No debug / diagnostics panel (low)

Ink had a `showDebug` toggle (visible in `FullScreen.tsx`). The Go TUI forwards `/diagnostics` to the engine but doesn't have a debug overlay for internal state inspection.

### 3.8 Paste chip preview doesn't account for search mode (low)

`model.go:1418` — The "N pasted block(s)" hint shows even when search mode is active (`!m.searchMode`), but it's guarded by the condition. Actually it IS guarded: `if n := len(m.pastes); n > 0 && !m.searchMode {`. ✅ This is correct.

### 3.9 `/shortcuts` not registered in engine for tab-completion (medium)

The `/shortcuts` command is handled entirely Go-side (line 509), so it won't appear in the engine's autocomplete dropdown. Users who discover slash commands through Ctrl+G won't see it. They can still type it manually.

---

## 4. BEHAVIORAL GAPS (vs Ink UI)

| Feature | Ink UI | Go TUI | Impact |
|---------|--------|--------|--------|
| Transcript compaction (auto) | ✅ Every 10 turns | ❌ Unbounded | Memory + perf degradation on long sessions |
| Auto-scroll lock | ✅ | ❌ Always scrolls to bottom | User loses reading position |
| Ctrl+L clear terminal | ✅ | ❌ | Minor convenience |
| Debug panel (`showDebug`) | ✅ | ❌ | Can't inspect internal state |
| `/compact` command | ✅ | ❌ (no engine cmd either) | Can't manually compact |
| `/shortcuts` in tab-completion | ✅ (engine-side) | ❌ (Go-side only) | Not discoverable via Ctrl+G |
| Inline images (output) | ✅ (iTerm) | ❌ (terminal) | Niche |
| Full keyboard navigation menus | ✅ (vim keys) | ❌ (↑/↓ only) | Minor |
| Document `/output` viewer | ✅ | ✅ (via engine menu) | Works end-to-end |

---

## 5. RECOMMENDATIONS

### Short-term (before release):
1. Add `success` level styling for system messages (#3.2)
2. Add `debug` level to log view switch (#3.3)
3. Add `/shortcuts` registration to engine's command palette so it appears in completions (#3.9)
4. Wire auto-scroll-lock (stop calling `GotoBottom()` if user scrolled up) (#3.5)

### Medium-term:
5. Implement transcript compaction — either auto (every N turns) or manual (via a `/compact` command or a keybinding) (#3.4)
6. Add Ctrl+L terminal clear (#3.6)

### Long-term:
7. Consider a debug overlay for `/diagnostics` output (#3.7)
8. Consider using `isAsk` to differentiate AskUser prompts from governor vetoes (#3.1)

---

## APPENDIX A: ENGINE SLASH COMMAND INDEX (72 commands)

All reachable from TUI via raw input or Ctrl+G palette. Sourced from `src/cli/commands/*.ts`.

```
/a11y              /agent-decisions   /agents            /ask
/autocommit        /backups           /branch            /changelog
/check             /checkpoint        /clear             /config
/context           /context-mode      /context-window    /cost
/council           /diagnostics       /diff              /diff-approval
/diff-file         /edit              /evolve            /git
/goals             /governor          /heal              /help
/impact            /index             /index-ai          /keys
/lint              /log               /map               /mcp
/mode              /model             /orchestrate       /output
/plan              /plugins           /provider          /reasoning
/recipe            /remember          /replay            /resume
/rewind            /routes            /scout             /security
/selection         /self-critic       /sessions          /skills
/speculate         /swarm             /tier              /tx
/undo              /watch             /write
```
