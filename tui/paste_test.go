package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// A multi-line paste must collapse into a "[Pasted text …]" chip instead of dumping every line into
// the input — including when the terminal delivers the line breaks as CR ('\r') and never sets the
// bracketed-paste flag (the case that was falling through to raw insertion).
func TestCarriageReturnPasteCollapsesToChip(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 80, 40

	// CR-separated, Paste flag deliberately unset — the pre-fix condition would have missed this.
	res, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("alpha\rbeta\rgamma")})
	m = res.(model)

	if len(m.pastes) != 1 {
		t.Fatalf("expected 1 paste chip, got %d", len(m.pastes))
	}
	if m.pastes[0].Lines != 3 {
		t.Fatalf("expected 3 lines counted, got %d", m.pastes[0].Lines)
	}
	if v := m.input.Value(); !strings.Contains(v, "Pasted text") {
		t.Fatalf("input should show the chip placeholder, got %q", v)
	}
	// The stored text is normalized to LF so the engine receives clean multiline content on submit.
	if strings.Contains(m.pastes[0].Text, "\r") {
		t.Fatalf("stored paste text should have CR normalized to LF, got %q", m.pastes[0].Text)
	}
}
