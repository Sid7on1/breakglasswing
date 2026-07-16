# Engineering Log — CLI/TUI Latency & Rendering Recovery

Date: 2026-07-16 · Scope: engine (`src/`) + Go TUI (`tui/`) · Method: measure → reproduce → fix → gate

Every claim below was measured on the real interactive binary through a PTY harness
(`scripts/pty-harness.py` + `scripts/pty-analyze.py`, replayed through a terminal emulator),
against both a deterministic local provider (`scripts/mock-provider.mjs`) and live NVIDIA NIM.

## Discoveries (ranked by user pain)

### 1. bubbletea v1.3.10 queries the terminal in package `init()` — before `main()`
`tea_init.go` calls `lipgloss.HasDarkBackground()` at load time. termenv answers that by writing
an OSC-11 query to the tty and **blocking up to its 5s timeout reading the reply** — and the reply
reader **consumes any bytes the user typed** while frozen. On terminals that answer (iTerm2,
Apple Terminal) it costs ~10ms; on ones that don't (some SSH clients, IDE terminals, tmux
pass-throughs, CI PTYs) it froze the first paint for **~6.8s** and silently ate the user's first
prompt. Measured: first frame at 7,523ms; `hi` typed at 2.5s never arrived.

**Fix:** `tui/vendor/` is now committed with the init patched out (`tui/VENDOR_PATCHES.md`), and
`initAccessibility()` pins the background (`lipgloss.SetHasDarkBackground`, `BIMAX_LIGHT_BG=1` to
flip) so nothing ever needs the query. First frame: **7,523ms → ~700ms** on a non-answering
terminal; keystrokes during boot are preserved. Gate: `test:tui` scenario 1 fails if any OSC-11
appears at startup.

### 2. Short replies from UNKNOWN models still burst at stream end
The P0-2 fix (opener-based vs opener-less reasoners) only helps models in the capability table.
Unknown model ids take the "implicit reasoning" lane, whose tentative buffer was bounded by
**size only (240 chars)** — so every reply *shorter* than the cap (greetings are ~50 chars)
buffered until `flush()` and appeared in one burst. Measured against a mock streaming 40 tokens
over 1.1s: ttf-visible = 1,188ms, 1 visible delta.

**Fix:** the buffer is now also **time-bounded** (250ms, `BGW_IMPLICIT_THINK_TIME_CAP_MS`), the
same leak tradeoff the char cap already accepted; known reasoners remain exempt (unbounded).
Result: ttf-visible 1,188ms → **~390ms**, 30 incremental deltas, 5/5 runs.
Gate: `stream.strategy.test.ts` "time-bounded implicit buffering" (fake-timer tests).

### 3. Auth-dead key pools slept instead of failing
A 401 key got a 5s cooldown, and the next call **slept through it** and retried the same dead
key — every turn on an expired key felt hung. 401s are permanent for a given key string.

**Fix:** `ApiKeyManager.allKeysAuthDead()` + fail-fast in `getKey()` with the exact fix in the
message ("update it with /keys or in ~/.breakglass/.env"), and `headless.session` now surfaces
key/auth errors as visible transcript messages instead of hidden log lines (a keyless first run
used to fail in complete silence). Gate: `credits.test.ts` auth-dead suite + `test:tui` keyless
scenario.

### 4. SIGTERM deadlocked the TUI (raw terminal + orphaned engine)
bubbletea ≥1.3 installs its own SIGINT/SIGTERM handler that does a **blocking, unguarded send**
of `QuitMsg` into `p.msgs` (tea.go:303). Our `main.go` also handled SIGTERM via `p.Quit()`. Both
fired: our quit stopped the event loop, nobody drained `p.msgs`, bubbletea's signal goroutine
blocked forever on the send, and `Program.shutdown`'s WaitGroup waited on it — `kill` left a raw,
cursor-hidden terminal and an orphaned Node engine until SIGKILL. Proven by SIGQUIT goroutine
dumps.

**Fix:** one owner per signal — we handle only SIGHUP (bubbletea doesn't); SIGTERM flows through
bubbletea's own QuitMsg path. SIGTERM now exits 0 in <10ms with cursor + bracketed-paste
restored. Gate: `test:tui` sigterm scenario.

### 5. Resize repair paid a duplicated screenful even when nothing could ghost
Ghost frames only occur when the terminal gets **narrower** (painted live-region rows re-wrap and
break the inline renderer's cursor math). The settle-repair (clear visible screen + reprint last
screenful) ran for every gesture, adding a duplicate screenful to scrollback on widens too.

**Fix:** the repair is gated on "the gesture narrowed at some point" (`resizeNarrowed` latch).
Widen/height-only: zero duplication (verified via emulator scrollback diff). Narrow: correct
rewrap at the new width, bounded ≤1 screenful. Gate: Go `TestResizeRepairOnlyOnNarrow` +
`test:tui` resize scenarios.

### 6. Smaller trust fixes
- **`/exit` / `/quit` did nothing** (forwarded to an engine that has no such command). Now
  handled Go-side, quit immediately. Gate: `TestSlashExitQuitsLocally`.
- **Esc during a turn kept animating "Thinking…"** for the 1–2s the engine needed to unwind —
  read as "my Esc was ignored". New `interrupting` state renders a calm `● Stopping…` within
  ~17ms of the keypress until the turn actually ends. Gate: `TestInterruptShowsStoppingUntilIdle`
  + `test:tui` interrupt scenario.

## Non-findings (verified healthy, no change)
- Engine boot→ready: 400–960ms (dev, `node dist/index.js`). Codebase-memory indexing is async.
- Engine turn overhead: lite lane ~80–120ms, full lane ~200ms pre-request (perf timeline).
- Abort signal DOES propagate to the provider HTTP request (OpenAI client `signal`).
- Long sessions: 14 consecutive turns, per-turn 1,360–1,390ms, zero drift, 25MB max RSS,
  no orphaned processes.
- Scrollback under long streamed replies: zero duplicated content lines (unique-token probe).

## Measured before/after (real TUI, PTY)

| Metric | Before | After |
|---|---|---|
| First frame, non-answering terminal | 7,523ms (+ eaten keystrokes) | ~700ms |
| `hi` → first visible token (mock, unknown model) | stream end (burst) | ~370ms, word-by-word |
| `hi` → first visible token (live NIM, step-3.7) | up to 50s+ felt (dead key sleeps + burst) | **868ms** (complete at 934ms) |
| SIGTERM | hang until SIGKILL, raw terminal | exit 0 <10ms, terminal restored |
| Expired key turn | 5s+ silent sleep per attempt | instant, actionable message |
| Keyless first run | total silence | picker auto-opens; failures name the fix |
| Widen resize | +1 duplicated screenful | 0 |

## Verification inventory
- `npm run test:tui` — 7 PTY scenarios / 24 checks, all green (~90s; needs `pip3 install pyte`).
- `npx jest stream.strategy credits llm.filter convo.lane perf performance.budget model.router`
  — 82 tests green.
- `cd tui && go test .` — full suite green incl. 3 new behavior locks.
- Live NIM: `node scripts/measure-greeting.mjs 8 hi` → overhead p95 1ms; provider wait separated.

## Standing risks
1. **Re-vendoring restores the upstream bubbletea init** — `go mod vendor` will undo the patch;
   `test:tui` scenario 1 catches it (see `tui/VENDOR_PATCHES.md`).
2. **Provider tail latency is not ours**: live NIM showed one 15s cold-start in 8 greeting runs;
   the perf timeline attributes it to `providerWaitMs` so it can't be mistaken for a Bimax
   regression.
3. **Unknown opener-less reasoners** can leak up to 250ms/240chars of CoT on their first turn
   (unchanged tradeoff, now time-bounded too); runtime detection lifts the cap from turn 2.
