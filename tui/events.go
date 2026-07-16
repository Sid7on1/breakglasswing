package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// agentModeOrder mirrors MODE_ORDER in src/cli/agentMode.ts — keep in sync. The Shift+Tab cycle:
// general → explore → sketch → code → beast → general.
var agentModeOrder = []string{"general", "explore", "sketch", "code", "beast"}

// nextAgentMode returns the mode to switch to from the current footer mode string (which the engine
// emits empty for "general"). Case-insensitive; unknown values restart the cycle at explore.
func nextAgentMode(current string) string {
	cur := strings.ToLower(strings.TrimSpace(current))
	if cur == "" {
		cur = "general"
	}
	for i, mode := range agentModeOrder {
		if mode == cur {
			return agentModeOrder[(i+1)%len(agentModeOrder)]
		}
	}
	return "explore"
}

func (m *model) handleEvent(o Outbound) {
	switch o.Name {
	case "stream_token":
		// First answer token ends the reasoning phase — freeze the thought clock for the
		// "Thought for Ns" line the engine doesn't compute in headless mode.
		if m.turnThoughtMs == 0 && !m.turnThinkStart.IsZero() {
			m.turnThoughtMs = int(time.Since(m.turnThinkStart).Milliseconds())
		}
		// Answer text is non-tool content: commit any finished tool run to scrollback BEFORE this text
		// renders, so a post-tool answer paragraph lands below the tool card (text → tool → text order)
		// rather than briefly floating above it in the live region.
		m.flushToolRun()
		m.stream += argString(o.Args, 0)
		m.lastTokenAt = time.Now()
		// Commit any markdown blocks that just closed to native scrollback (formatted, never to
		// reflow); only the trailing open block stays live in View. This is what removes the
		// raw-then-snap-to-formatted jump and stops the growing answer from shoving the chrome.
		m.commitAssistantStream(false)

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
			m.interrupting = false // the turn is over — the "Stopping…" state resolved
			// Turn ended (or was interrupted): commit tools that returned a result, and drop any that
			// never did — so working() clears and the indicator goes idle. Filter to finished (in
			// order), then flush the lot to scrollback.
			kept := m.turnTools[:0]
			for _, tc := range m.turnTools {
				if toolFinished(tc) {
					kept = append(kept, tc)
				}
			}
			m.turnTools = kept
			m.flushToolRun()
			m.turnTools = nil
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
		// The bold per-mode chip in the footer is the single source of truth for the active mode, so
		// no extra status one-liner is needed here (avoids two indicators for the same thing).
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
			m.fMind = s.Mind
			m.graph = s.Graph
			m.ctxWindow = s.ContextWindow
			m.ctxBaseline = s.TokensBaseline
			m.ctxSaved = s.CompressionSaved
			m.fWorkspace = s.Workspace
		}

	case "outcome_update":
		var outcome *OutcomeStrip
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &outcome) == nil {
			m.fOutcome = outcome
		}

	case "tool_call", "tool_call_result":
		var tc ToolCall
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &tc) == nil && tc.ToolName != "" {
			if tc.ParentID != "" {
				// Sub-agent tool call: nest it UNDER its spawner (the live sub-agent panel) instead of
				// the parent's flat run, so it doesn't interleave into the main transcript. Upsert by id
				// so pending→running→done fills the same slot.
				m.upsertSubAgentTool(tc)
				break
			}
			// A NEW main-agent tool call starting while assistant text is mid-stream means the model
			// finished a text part and is now acting. Commit that text block to scrollback FIRST so the
			// transcript reads text → tool → text (Claude-Code interleaving) instead of every tool
			// jumping ABOVE the answer when the turn ends (the "text and tools swap places" mess).
			if o.Name == "tool_call" && m.streamCommitted < len(m.stream) {
				m.commitAssistantStream(true)
			}
			if idx := m.toolIdx(tc.ID); tc.ID != "" && idx >= 0 {
				// Update the tool in its existing slot if we've seen this id (pending → running → done),
				// else append at the end in start order. The card fills in place — it never moves. The
				// finished leading prefix leaves for scrollback on the next non-tool content (flushToolRun),
				// where a long boring burst collapses to category counts instead of pages of lines.
				m.turnTools[idx] = tc
			} else {
				m.turnTools = append(m.turnTools, tc)
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

	case "subagent_update":
		// Live sub-agent coverage (blackboard snapshot). Pinned as a panel while any sub-agent runs,
		// then disappears once they all finish — same lifecycle as the task list.
		var subs []SubAgent
		if len(o.Args) > 0 {
			_ = json.Unmarshal(o.Args[0], &subs)
		}
		m.subagents = subs
		if m.saSel >= len(subs) { // keep the selection cursor in range as agents come and go
			m.saSel = 0
		}
		if len(subs) == 0 {
			m.saFocus = false // nothing to focus once the board empties
		}

	case "clear":
		// /clear: wipe the transcript + per-turn state, then re-show the welcome banner so the screen
		// looks freshly launched (the engine has already reset the conversation history). pendingClear
		// makes the Update wrapper clear the visible screen BEFORE the new banner flushes; scrollback
		// is deliberately left alone (older transcript stays reachable by scrolling up).
		m.lines = nil
		m.printQueue = nil // drop anything queued this cycle; it would land below the cleared screen
		m.started = false
		m.stream = ""
		m.streamCommitted = 0
		m.turnAnswerStarted = false
		m.turnTools = nil
		m.todos = nil
		m.lastTodoRender = ""
		m.subagents = nil
		m.subAgentTools = map[string][]ToolCall{}
		m.saExpanded = map[string]bool{}
		m.saSel = 0
		m.saFocus = false
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
		// The footer dynamically updates its MCP chip; no need to spam the transcript.
		m.fMcp = countMcpServers(cwdOrWD(m.cwd))

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
			// Type-aware label: an error spiral ("kept failing and tweaking args") reads very
			// differently from a plain repeat, so name it plainly instead of the generic "loop
			// detected". The tool name and ×count are always included (the front-end contract).
			icon, label := "↻", "loop detected"
			switch sig.Type {
			case "error_thrashing":
				icon, label = "⚠", "repeated failures"
			case "no_progress_poll":
				icon, label = "↻", "no progress"
			case "ping_pong":
				icon, label = "⇄", "ping-pong loop"
			case "circuit_breaker":
				icon, label = "⛔", "tool-call budget hit"
			case "unknown_tool_repeat":
				icon, label = "?", "unknown tool repeated"
			}
			m.append(errStyle.Render(fmt.Sprintf("  %s %s: %s ×%d (%s) — changing strategy", icon, label, detail, sig.Count, sig.Severity)))
		}

	case "rerun_onboarding":
		m.append(dimStyle.Render("  ⌁ onboarding reset — map setup will be offered when the engine is ready"))

	case "shutdown":
		m.status = "shutting down…"
		m.quitting = true // engineMsg handler turns this into tea.Quit

	// config_changed / goals_changed / set_tier are footer-refresh signals. The footer is driven by
	// the ui_snapshot (config/goals) and model_tier (set_tier) events the engine emits alongside
	// them, so there's nothing to render here — handled explicitly so they're not silently dropped.
	case "config_changed", "goals_changed", "set_tier":
	}
}
