package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

const inputMaxRows = 6 // the multi-line input grows up to this many rows, then scrolls internally

// syncInputHeight grows or shrinks the input box to fit its content, capped at inputMaxRows.
func (m *model) syncInputHeight() {
	n := m.input.LineCount()
	if n < 1 {
		n = 1
	}
	if n > inputMaxRows {
		n = inputMaxRows
	}
	if n != m.input.Height() {
		m.input.SetHeight(n)
	}
}

const historyLimit = 100

// pushHistory records a submitted line for up/down recall (dropping any earlier duplicate so it
// moves to the front), caps the ring at historyLimit, persists it, and resets the browse cursor.
func (m *model) pushHistory(text string) {
	if text == "" {
		return
	}
	out := m.history[:0:0]
	for _, h := range m.history {
		if h != text {
			out = append(out, h)
		}
	}
	out = append(out, text)
	if len(out) > historyLimit {
		out = out[len(out)-historyLimit:]
	}
	m.history = out
	m.histIdx = len(m.history)
	m.histStash = ""
	saveHistory(m.history)
}

// historyPath is ~/.breakglass/history.json — shared with the Ink front-end so prompt history
// carries across both UIs (FullScreen.tsx HISTORY_PATH). BIMAX_HISTORY_PATH overrides it (tests).
func historyPath() string {
	if p := os.Getenv("BIMAX_HISTORY_PATH"); p != "" {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".breakglass", "history.json")
}

// loadHistory reads the persisted prompt history (best-effort; empty on any error).
func loadHistory() []string {
	p := historyPath()
	if p == "" {
		return nil
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var hist []string
	if json.Unmarshal(b, &hist) != nil {
		return nil
	}
	if len(hist) > historyLimit {
		hist = hist[len(hist)-historyLimit:]
	}
	return hist
}

// saveHistory writes the prompt history back to disk (best-effort).
func saveHistory(hist []string) {
	p := historyPath()
	if p == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if b, err := json.MarshalIndent(hist, "", "  "); err == nil {
		_ = os.WriteFile(p, b, 0o644)
	}
}

// histPrev recalls an older submission (up). The in-progress line is stashed on first step back.
func (m *model) histPrev() {
	if len(m.history) == 0 {
		return
	}
	if m.histIdx == len(m.history) {
		m.histStash = m.input.Value()
	}
	if m.histIdx > 0 {
		m.histIdx--
	}
	m.input.SetValue(m.history[m.histIdx])
	m.input.CursorEnd()
}

// histNext recalls a newer submission (down), restoring the stashed in-progress line at the end.
func (m *model) histNext() {
	if m.histIdx >= len(m.history) {
		return
	}
	m.histIdx++
	if m.histIdx == len(m.history) {
		m.input.SetValue(m.histStash)
	} else {
		m.input.SetValue(m.history[m.histIdx])
	}
	m.input.CursorEnd()
}

// handleInputRequest routes keys while a free-form (input) request is open — the textarea is the
// answer field for both plain and masked prompts; masking is purely a render concern (bullets in
// promptView) so the typed value still flows through the textarea (parity with the old behavior).
func (m *model) handleInputRequest(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		m.engine.Close()
		return *m, tea.Quit
	case "esc":
		m.input.SetValue("")
		m.answer("")
		return *m, nil
	case "enter":
		val := m.input.Value()
		m.input.SetValue("")
		m.answer(val)
		return *m, nil
	}
	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	return *m, cmd
}

// --- paste chips (SimpleInput.tsx) ---------------------------------------------------------

// addPaste collapses a multi-line paste into a chip and inserts its placeholder into the input.
// Line endings are normalized to '\n' so the line count is correct whether the terminal delivered
// CRLF, bare CR, or LF, and so the expanded text the engine receives is clean.
func (m *model) addPaste(text string) {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	m.pasteCounter++
	lines := strings.Count(text, "\n") + 1
	ph := fmt.Sprintf("[Pasted text #%d +%d lines]", m.pasteCounter, lines)
	m.pastes = append(m.pastes, pasteChip{ID: m.pasteCounter, Lines: lines, Text: text, Placeholder: ph})
	m.input.InsertString(ph)
}

// expandPastes replaces every chip placeholder with its real text (called on submit).
func (m model) expandPastes(s string) string {
	for _, c := range m.pastes {
		s = strings.ReplaceAll(s, c.Placeholder, c.Text)
	}
	return s
}

// clearPastes drops all stored chips and resets the counter.
func (m *model) clearPastes() {
	m.pastes = nil
	m.pasteCounter = 0
}

// inputHasChips reports whether the input still references at least one paste chip.
func (m model) inputHasChips() bool {
	v := m.input.Value()
	for _, c := range m.pastes {
		if strings.Contains(v, c.Placeholder) {
			return true
		}
	}
	return false
}

// pastePreview appends each chip's full text to the transcript (Ctrl+P).
func (m *model) pastePreview() {
	if len(m.pastes) == 0 {
		m.status = "No pasted text to preview"
		return
	}
	for _, c := range m.pastes {
		m.append(dimStyle.Render(c.Placeholder) + "\n" + asstStyle.Render(c.Text))
	}
}
