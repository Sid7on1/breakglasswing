package main

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

// handleKey is the single keyboard dispatcher, extracted from update() so each input mode reads
// as its own block: request overlay > search > menu > completion dropdown > history > global
// chords > plain typing. Order is priority — an open overlay owns the keyboard.
func (m model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// Request overlay captures input until answered (highest priority).
	if m.reqOpen {
		if m.reqKind == "input" {
			return m.handleInputRequest(msg)
		}
		// Interactive ask modal
		switch {
		case msg.String() == "ctrl+c":
			m.engine.Close()
			return m, tea.Quit
		case msg.String() == "esc":
			// Find a safe "cancel" option, otherwise just say Dismissed so we don't accidentally approve
			val := "Dismissed"
			for _, op := range m.reqOpts {
				lower := strings.ToLower(op)
				if lower == "cancel" || lower == "reject" || lower == "no" {
					val = op
					break
				}
			}
			m.answer(val)
			return m, nil
		case msg.String() == "up":
			if m.reqIdx > 0 {
				m.reqIdx--
			}
			return m, nil
		case msg.String() == "down":
			if m.reqIdx < len(m.reqOpts) {
				m.reqIdx++
			}
			return m, nil
		case msg.String() == "pgup" || msg.String() == "pgdown":
			// Scroll the diff body so a large change can actually be reviewed before approving.
			if m.reqKind == "diff" && m.reqBody != "" {
				page := diffApprovalRows / 2
				if msg.String() == "pgup" {
					m.reqScroll -= page
				} else {
					m.reqScroll += page
				}
				if maxOff := len(parseDiffRows(m.reqBody)) - diffApprovalRows; m.reqScroll > maxOff {
					m.reqScroll = maxOff
				}
				if m.reqScroll < 0 {
					m.reqScroll = 0
				}
			}
			return m, nil
		case msg.String() == " ":
			if m.reqIsMulti && m.reqIdx < len(m.reqOpts) {
				if m.reqSelected == nil {
					m.reqSelected = make(map[int]bool)
				}
				m.reqSelected[m.reqIdx] = !m.reqSelected[m.reqIdx]
			}
			return m, nil
		case msg.String() == "enter":
			if m.reqIdx == len(m.reqOpts) {
				val := strings.TrimSpace(m.input.Value())
				if val != "" {
					m.input.Reset()
					m.answer(val)
				}
			} else {
				if m.reqIsMulti {
					var selected []string
					for i, op := range m.reqOpts {
						if m.reqSelected[i] {
							selected = append(selected, op)
						}
					}
					if len(selected) > 0 {
						m.answer(strings.Join(selected, ", "))
					} else {
						m.answer(m.reqOpts[m.reqIdx])
					}
				} else {
					m.answer(m.reqOpts[m.reqIdx])
				}
			}
			return m, nil
		default:
			// Smart typing: if it's a visible character or backspace, jump to the type-in option and type
			if len(msg.String()) == 1 || msg.String() == "backspace" {
				m.reqIdx = len(m.reqOpts)
				var cmd tea.Cmd
				m.input, cmd = m.input.Update(msg)
				return m, cmd
			}
			return m, nil
		}
	}

	// Search mode (Ctrl+F) is modal: type to query, ↑/↓ + Enter navigate matches, Esc exits.
	if m.searchMode {
		matches := m.searchMatches()
		switch msg.String() {
		case "ctrl+c":
			m.engine.Close()
			return m, tea.Quit
		case "esc", "ctrl+f":
			m.searchMode = false
			m.input.SetValue(m.searchSaved)
			m.input.CursorEnd()
			m.status = "Ready"
			m.relayout()
			return m, nil
		case "enter", "down":
			if len(matches) > 0 {
				m.searchIdx = (m.searchIdx + 1) % len(matches)
			}
			m.relayout()
			return m, nil
		case "up":
			if len(matches) > 0 {
				m.searchIdx = (m.searchIdx - 1 + len(matches)) % len(matches)
			}
			m.relayout()
			return m, nil
		case "backspace", "ctrl+h":
			if r := []rune(m.searchQuery); len(r) > 0 {
				m.searchQuery = string(r[:len(r)-1])
			}
			m.searchIdx = 0
			m.relayout()
			return m, nil
		default:
			if len(msg.Runes) > 0 {
				m.searchQuery += string(msg.Runes)
				m.searchIdx = 0
			}
			m.relayout()
			return m, nil
		}
	}

	// Interactive menu (command palette / picker): fuzzy-filter as you type, navigate + select.
	if m.menuOpen {
		filtered := m.filteredMenu()
		switch msg.String() {
		case "ctrl+c":
			m.engine.Close()
			return m, tea.Quit
		case "esc":
			m.menuOpen = false
			m.menuFilter = ""
			m.relayout()
			return m, nil
		case "up", "ctrl+p":
			if len(filtered) > 0 {
				m.menuIdx = (m.menuIdx - 1 + len(filtered)) % len(filtered)
			}
			return m, nil
		case "down", "ctrl+n":
			if len(filtered) > 0 {
				m.menuIdx = (m.menuIdx + 1) % len(filtered)
			}
			return m, nil
		case "enter":
			m.menuOpen = false
			m.menuFilter = ""
			m.relayout()
			if len(filtered) > 0 {
				if m.menuID != "" {
					m.engine.Send(encodeMenuSelect(m.menuID, filtered[m.menuIdx].Value))
				} else {
					val := filtered[m.menuIdx].Value
					switch val {
					case "/map":
						m.showFullMap = !m.showFullMap
					case "/shortcuts":
						m.append(renderShortcuts())
					default:
						m.engine.Send(encodeInput(val))
					}
				}
			}
			return m, nil
		case "backspace", "ctrl+h":
			if r := []rune(m.menuFilter); len(r) > 0 {
				m.menuFilter = string(r[:len(r)-1])
			}
			m.menuIdx = 0
			m.relayout()
			return m, nil
		default:
			if len(msg.Runes) > 0 {
				m.menuFilter += string(msg.Runes)
				m.menuIdx = 0
			}
			m.relayout()
			return m, nil
		}
	}

	// Completion-dropdown navigation takes priority while it's open.
	if m.compOpen {
		switch msg.String() {
		case "esc":
			m.compOpen = false
			m.relayout()
			return m, nil
		case "up", "ctrl+p":
			m.compIdx = (m.compIdx - 1 + len(m.comps)) % len(m.comps)
			return m, nil
		case "down", "ctrl+n":
			m.compIdx = (m.compIdx + 1) % len(m.comps)
			return m, nil
		}
	}

	// Sub-agent panel focus (Ctrl+A): while focused, ↑/↓ select an agent and enter expands/collapses
	// its detail card (prompt · tools · output). Intercepted BEFORE history/global chords so the panel
	// owns these keys while active; esc releases focus. Auto-releases when the board empties (events.go).
	if m.saFocus && len(m.subagents) > 0 {
		switch msg.String() {
		case "up":
			if m.saSel > 0 {
				m.saSel--
			}
			m.relayout()
			return m, nil
		case "down":
			if m.saSel < len(m.subagents)-1 {
				m.saSel++
			}
			m.relayout()
			return m, nil
		case "enter":
			// Accordion: expanding a card collapses the others, so the panel is never a wall of
			// stacked detail — at most one agent's prompt/tools/output is open at a time.
			id := m.subagents[m.saSel].TaskID
			open := !m.saExpanded[id]
			m.saExpanded = map[string]bool{}
			if open {
				m.saExpanded[id] = true
			}
			m.relayout()
			return m, nil
		case "esc":
			m.saFocus = false
			m.status = "Sub-agent panel: focus released"
			m.relayout()
			return m, nil
		}
	}

	// Input history: up/down at the first/last line recalls past submissions. Mid-text they move
	// the cursor between lines (textarea), so only intercept at the boundaries.
	switch msg.String() {
	case "up":
		if m.input.Line() == 0 && len(m.history) > 0 {
			m.histPrev()
			m.syncInputHeight()
			m.relayout()
			return m, nil
		}
	case "down":
		if m.input.Line() == m.input.LineCount()-1 && m.histIdx < len(m.history) {
			m.histNext()
			m.syncInputHeight()
			m.relayout()
			return m, nil
		}
	}

	switch msg.String() {
	case "ctrl+c":
		// While a turn runs, Ctrl+C cancels it (cooperatively, engine-side) and keeps the
		// session alive. When idle, it quits. So mid-turn it takes two presses to exit:
		// first cancels, second (now idle) quits.
		if m.working() {
			m.engine.Send(encodeInterrupt())
			m.interrupting = true
			return m, nil
		}
		m.engine.Close()
		return m, tea.Quit
	// Scrolling is the TERMINAL's job in inline mode — PgUp/PgDn, wheel, trackpad all act on the
	// real native scrollback (opencode / Claude style). The app does not intercept them.
	case "ctrl+l":
		// Clear the physical terminal for a clean repaint (parity with the Ink UI). The transcript
		// itself is untouched — use /clear to reset the conversation.
		return m, tea.ClearScreen
	case "ctrl+f":
		// Enter transcript/log search; stash the in-progress input until we exit.
		m.searchMode = true
		m.searchSaved = m.input.Value()
		m.searchQuery = ""
		m.searchIdx = 0
		m.compOpen = false
		m.status = "Search transcript & logs — ↑/↓ navigate, Esc exit"
		m.relayout()
		return m, nil
	case "ctrl+o":
		// Toggle the structured log view in place of the transcript.
		m.showLogs = !m.showLogs
		m.relayout()
		return m, nil
	case "ctrl+x":
		// Toggle the mind HUD — the ◇ chip's explainable panel (weak spots, drives, habits).
		m.showMind = !m.showMind
		m.mindTab = 0 // always land on the overview
		m.relayout()
		return m, nil
	case "ctrl+b":
		// Toggle tool-call collapse: long runs of tool calls fold into category counts ("7 tools ·
		// 4 reads · 2 edits") or expand back to one line each. Affects the live/current run.
		m.collapseTools = !m.collapseTools
		if m.collapseTools {
			m.status = "Tool calls collapse when long (Ctrl+B to expand)"
		} else {
			m.status = "Tool calls expanded (Ctrl+B to collapse)"
		}
		m.relayout()
		return m, nil
	case "ctrl+a":
		// Focus the live sub-agent panel: ↑/↓ select an agent, enter expands its prompt/tools/output,
		// esc releases. No-op when no sub-agents are on the board.
		if len(m.subagents) == 0 {
			m.status = "No sub-agents running"
			return m, nil
		}
		m.saFocus = !m.saFocus
		if m.saFocus {
			if m.saSel >= len(m.subagents) {
				m.saSel = 0
			}
			m.status = "Sub-agents focused — ↑/↓ select · enter expand · esc release"
		} else {
			m.status = "Sub-agent panel: focus released"
		}
		m.relayout()
		return m, nil
	case "ctrl+t":
		// Cycle the routing through three states, keyed on the current PIN (not the last-routed
		// tier), so each press is predictable:
		//   auto (default; lite answers, auto-escalates to the coding model when a turn needs it)
		//   → pin lite  (always the lite model; never switches)
		//   → pin heavy (always the coding/minimax model; never switches)
		//   → auto …
		// Drives /tier (engine emits set_tier → model_tier, updating the footer state).
		next := "lite"
		switch m.fPinned {
		case "lite":
			next = "heavy"
		case "heavy":
			next = "auto"
		}
		m.engine.Send(encodeInput("/tier " + next))
		return m, nil
	case "shift+tab":
		// While the mind HUD is open, Shift+Tab pages its sections backwards.
		if m.showMind {
			m.mindTab = (m.mindTab + mindTabCount - 1) % mindTabCount
			m.relayout()
			return m, nil
		}
		// Cycle the agent behavioral mode: general → explore → sketch → code → beast → general.
		// Drives /mode (engine emits mode_change → footer updates m.fMode). Mirrors the workflow
		// arc: orient → architect → execute → autonomous build → neutral default.
		m.engine.Send(encodeInput("/mode " + nextAgentMode(m.fMode)))
		return m, nil
	case "esc":
		if m.showMind {
			m.showMind = false
			m.relayout()
			return m, nil
		}
		if m.showFullMap {
			m.showFullMap = false
			m.relayout()
			return m, nil
		}
		// While a turn is running (incl. the tool-call phase), esc cancels it.
		if m.working() {
			m.engine.Send(encodeInterrupt())
			m.interrupting = true
			m.status = "Interrupting…"
			return m, nil
		}
		// Idle: stash the current line (Ctrl+R resumes). No-op when empty.
		if strings.TrimSpace(m.input.Value()) != "" {
			m.stash = m.input.Value()
			m.input.SetValue("")
			m.input.SetHeight(1)
			m.status = "Prompt stashed — Ctrl+R to resume"
			m.relayout()
		}
		return m, nil
	case "ctrl+r":
		if m.stash != "" {
			m.input.SetValue(m.stash)
			m.input.CursorEnd()
			m.stash = ""
			m.status = "Stashed prompt resumed"
			m.syncInputHeight()
			m.relayout()
		}
		return m, nil
	case "ctrl+p":
		// Preview the full text behind the paste chips currently in the input.
		m.pastePreview()
		return m, nil
	case "ctrl+g":
		// Command palette: prefill "/" and surface the slash-command dropdown (type to filter).
		m.input.SetValue("/")
		m.input.CursorEnd()
		return m, m.requestCompletions()
	case "tab":
		// While the mind HUD is open, Tab pages through its sections instead of completing.
		if m.showMind {
			m.mindTab = (m.mindTab + 1) % mindTabCount
			m.relayout()
			return m, nil
		}
		if m.compOpen {
			m.acceptCompletion()
		}
		return m, m.requestCompletions() // open, or refine after accept (e.g. descend a dir)
	case "enter":
		if m.compOpen {
			isCmd := m.acceptCompletion()
			if !isCmd {
				return m, nil
			}
		}
		raw := m.input.Value()
		text := strings.TrimSpace(m.expandPastes(raw))
		if text == "/exit" || text == "/quit" {
			// Handled Go-side: the engine has no exit command, so this used to be forwarded and
			// silently swallowed — the one command every terminal user tries first must just work.
			m.engine.Close()
			return m, tea.Quit
		}
		if text == "/shortcuts" {
			// Handled Go-side — the headless engine has no keybindings registry.
			m.append(renderShortcuts())
			m.pushHistory(text)
			m.input.SetValue("")
			m.input.SetHeight(1)
			m.clearPastes()
			m.compOpen = false
			m.relayout()
			return m, nil
		}
		if text == "/map" {
			m.showFullMap = !m.showFullMap
			m.input.SetValue("")
			m.input.SetHeight(1)
			m.relayout()
			return m, nil
		}
		if text != "" {
			if m.working() {
				m.queued = append(m.queued, text)
				m.status = fmt.Sprintf("Queued (%d) — runs after the current turn", len(m.queued))
			} else {
				m.engine.Send(encodeInput(text)) // engine echoes the user message back
			}
			m.pushHistory(strings.TrimSpace(raw))
			m.input.SetValue("")
			m.input.SetHeight(1)
			m.clearPastes()
		}
		m.compOpen = false
		m.relayout()
		return m, nil
	}

	// Multi-line paste: collapse to a "[Pasted text #N +L lines]" chip. A KeyRunes message that
	// carries a line break can only be a paste — Enter is KeyEnter and Ctrl+J is KeyCtrlJ, neither
	// arrives as a rune — so we don't require the msg.Paste flag (terminals that don't bracket
	// pastes never set it). We accept CR as well as LF: bracketed pastes commonly deliver '\r'.
	if runes := string(msg.Runes); strings.ContainsAny(runes, "\n\r") {
		m.addPaste(runes)
		m.syncInputHeight()
		m.relayout()
		return m, nil
	}

	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	m.syncInputHeight() // grow/shrink the box as lines are added (Ctrl+J) or removed
	// If every paste chip was deleted from the line, drop the stored blobs.
	if len(m.pastes) > 0 && !m.inputHasChips() {
		m.clearPastes()
	}
	ccmd := m.requestCompletions() // refresh candidates (debounced) for the new input
	m.relayout()
	return m, tea.Batch(cmd, ccmd)
}
