package main

import (
	"regexp"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// completionDebounce is how long typing must settle before we ask the engine for completions.
// Each keystroke used to fire a query — and an @-mention query is a full graph-node scan engine-side
// — so on a large repo fast typing meant a scan per keystroke. We debounce instead.
const completionDebounce = 70 * time.Millisecond

// compTickMsg fires when a debounce window elapses; seq lets a later keystroke supersede it.
type compTickMsg struct {
	seq  int
	text string
}

// requestCompletions schedules a debounced completion query. Clearing the dropdown on empty input is
// immediate; the actual engine query waits out completionDebounce and only fires if no newer
// keystroke arrived. Returns the timer cmd for the caller to run.
func (m *model) requestCompletions() tea.Cmd {
	v := m.input.Value()
	m.compSeq++ // any pending debounce is now stale
	if v == "" {
		if m.compOpen {
			m.compOpen = false
			m.relayout()
		}
		return nil
	}
	seq := m.compSeq
	return tea.Tick(completionDebounce, func(time.Time) tea.Msg { return compTickMsg{seq: seq, text: v} })
}

var trailingAt = regexp.MustCompile(`@[A-Za-z0-9_./~-]*$`)

// secretRE marks an input prompt as masked when it asks for a credential (the headless input_prompt
// carries no isMasked flag, unlike Ink's InteractivePrompt).
var secretRE = regexp.MustCompile(`(?i)\b(api[ _-]?key|secret|password|passphrase|token)\b`)

// acceptCompletion inserts the highlighted candidate: a command replaces the whole line; an
// @symbol/@path replaces just the trailing @token.
func (m *model) acceptCompletion() bool {
	if !m.compOpen || len(m.comps) == 0 {
		return false
	}
	item := m.comps[m.compIdx]
	if item.Disabled {
		m.status = item.DisabledReason
		m.relayout()
		return false
	}
	isCmd := item.Kind == "command"
	if isCmd {
		m.input.SetValue(item.Value + " ")
	} else {
		repl := item.Value
		if !strings.HasSuffix(repl, "/") { // a dir keeps the cursor on it to descend; else add a space
			repl += " "
		}
		m.input.SetValue(trailingAt.ReplaceAllString(m.input.Value(), repl))
	}
	m.input.CursorEnd()
	m.compOpen = false
	m.relayout()
	return isCmd
}
