package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (m *model) handleEvent(o Outbound) {
	switch o.Name {
	case "stream_token":
		// First answer token ends the reasoning phase — freeze the thought clock for the
		// "Thought for Ns" line the engine doesn't compute in headless mode.
		if m.turnThoughtMs == 0 && !m.turnThinkStart.IsZero() {
			m.turnThoughtMs = int(time.Since(m.turnThinkStart).Milliseconds())
		}
		m.stream += argString(o.Args, 0)
		m.lastTokenAt = time.Now()
		m.refresh()

	case "message":
		var me MessageEntry
		if len(o.Args) > 0 {
			_ = json.Unmarshal(o.Args[0], &me)
		}
		m.renderMessage(me)

	case "status":
		m.status = argString(o.Args, 0)

	case "spinner_state":
		// args[0] is the state ("thinking"/"idle"), args[1] the label. Track busy so Ctrl+C knows
		// whether to cancel the turn or quit.
		wasBusy := m.busy
		m.busy = argString(o.Args, 0) != "idle"
		if m.busy && !wasBusy {
			m.busyStart = time.Now()
			m.lastTokenAt = time.Now()
			m.elapsed = 0
		}
		if wasBusy && !m.busy {
			// Turn ended (or was interrupted): drop any live tool lines that never got a result,
			// so working() doesn't stay stuck true and the indicator clears cleanly.
			m.runningTools = map[string]string{}
			m.runningOrder = nil
			if m.bell {
				fmt.Print("\a") // notification bell when a turn completes
			}
			// Drain one queued prompt (FIFO). The next turn's idle dispatches the following one.
			if len(m.queued) > 0 {
				next := m.queued[0]
				m.queued = m.queued[1:]
				m.engine.Send(encodeInput(next))
				if len(m.queued) > 0 {
					m.status = fmt.Sprintf("Running queued prompt — %d still queued", len(m.queued))
				}
			}
		}
		if s := argString(o.Args, 1); s != "" {
			m.status = s
		}

	case "thinking":
		// Start the reasoning clock on the first thinking token; keep the tail snippet for the
		// ThinkingText line (single line, last ~72 chars).
		if m.turnThinkStart.IsZero() {
			m.turnThinkStart = time.Now()
		}
		if t := argString(o.Args, 0); t != "" {
			t = strings.TrimSpace(strings.Join(strings.Fields(t), " "))
			r := []rune(t)
			if len(r) > 72 {
				t = "…" + string(r[len(r)-72:])
			}
			m.thinkSnip = t
		}

	case "thinking_clear":
		m.thinkSnip = ""

	case "mode_change":
		m.fMode = argString(o.Args, 0)

	case "model_tier":
		var t struct {
			Tier   string `json:"tier"`
			Pinned string `json:"pinned"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &t) == nil {
			m.fTier, m.fPinned = t.Tier, t.Pinned
		}

	case "cost_update":
		var chars float64
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &chars) == nil {
			m.fTokens += int(chars / 4) // rough token estimate, same as Footer.tsx
		}

	case "ui_snapshot":
		var s UiSnapshot
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &s) == nil {
			m.fCoding, m.fLite, m.fGoals = s.Models.Coding, s.Models.Lite, s.GoalCount
			m.graph = s.Graph
			m.ctxWindow = s.ContextWindow
			m.ctxBaseline = s.TokensBaseline
			m.ctxSaved = s.CompressionSaved
		}

	case "tool_call", "tool_call_result":
		var tc ToolCall
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &tc) == nil && tc.ToolName != "" {
			line := renderToolCall(tc, m.width)
			running := tc.Status == "running" || tc.Status == ""
			if tc.ID != "" && running {
				// Show it live (in View) until the result arrives — can't update scrollback in place.
				if _, seen := m.runningTools[tc.ID]; !seen {
					m.runningOrder = append(m.runningOrder, tc.ID)
				}
				m.runningTools[tc.ID] = line
			} else {
				// Finished: drop the live copy and add it to the current consecutive tool RUN. The run
				// is rendered live (collapsed into category counts once it's long, expanded otherwise)
				// and flushed into the transcript as soon as any non-tool content commits (flushToolRun
				// runs from append) — so a burst of reads/greps collapses to one line instead of pages.
				if tc.ID != "" {
					delete(m.runningTools, tc.ID)
				}
				m.toolRun = append(m.toolRun, tc)
			}
		}

	case "log":
		var le LogEntry
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &le) == nil && le.Text != "" {
			// Cache structured entries for the Ctrl+O log view; also echo into the transcript dim.
			m.logs = append(m.logs, le)
			if len(m.logs) > 200 {
				m.logs = m.logs[len(m.logs)-200:]
			}
			m.append(dimStyle.Render("  " + le.Text))
		}

	case "todo_update":
		// Full task list (the compact "Tasks: x/y" summary already arrives as a `status` event).
		// Re-render the checklist into the transcript only when it actually changed.
		var todos []TodoItem
		if len(o.Args) > 0 {
			_ = json.Unmarshal(o.Args[0], &todos)
		}
		m.todos = todos
		// Pinned above the prompt by belowSections() while any task is unfinished, so it stays
		// visible instead of scrolling off into the transcript.

	case "clear":
		// /clear: wipe the transcript + per-turn state, then re-show the welcome banner so the screen
		// looks freshly launched (the engine has already reset the conversation history). Committed lines
		// live in the terminal's scrollback, so resetting m.lines isn't enough — pendingClear makes the
		// Update wrapper wipe screen + scrollback (ESC[3J) BEFORE the new banner flushes.
		m.lines = nil
		m.printQueue = nil // drop anything queued this cycle; it would land below the cleared screen
		m.started = false
		m.stream = ""
		m.runningTools = map[string]string{}
		m.runningOrder = nil
		m.toolRun = nil
		m.todos = nil
		m.lastTodoRender = ""
		m.histTokens = 0
		m.welcomed = false
		m.pendingClear = true
		m.showWelcome()

	case "cwd_changed":
		if p := argString(o.Args, 0); p != "" {
			m.cwd = p
			m.append(dimStyle.Render("  ⌁ cwd → " + p))
		}

	case "mcp_changed":
		// The footer dynamically updates its tool count; no need to spam the transcript.

	case "graph_changed":
		m.append(dimStyle.Render("  ⌁ code graph updated"))

	case "loop_detected":
		var sig struct {
			Type     string `json:"type"`
			Tool     string `json:"tool"`
			Count    int    `json:"count"`
			Severity string `json:"severity"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &sig) == nil {
			detail := sig.Tool
			if detail == "" {
				detail = sig.Type
			}
			m.append(errStyle.Render(fmt.Sprintf("  ↻ loop detected: %s ×%d (%s)", detail, sig.Count, sig.Severity)))
		}

	case "rerun_onboarding":
		m.append(dimStyle.Render("  ⌁ onboarding is only available in the Ink UI; skipped"))

	case "shutdown":
		m.status = "shutting down…"
		m.quitting = true // engineMsg handler turns this into tea.Quit

	// config_changed / goals_changed / set_tier are footer-refresh signals. The footer is driven by
	// the ui_snapshot (config/goals) and model_tier (set_tier) events the engine emits alongside
	// them, so there's nothing to render here — handled explicitly so they're not silently dropped.
	case "config_changed", "goals_changed", "set_tier":
	}
}
