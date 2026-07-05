package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// The mind HUD (Ctrl+X) renders the ui_snapshot's mind detail — weak spots with posterior
// stats, drives with a sparkline, compiled habits — and toggles like the other overlays.
func TestMindHudRendersSnapshotDetail(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"models": map[string]string{"coding": "minimax-m3", "lite": "step-3.5"},
		"mind": map[string]any{
			"weakSpots": 1, "driveDeviations": 1, "habits": 1,
			"weak": []map[string]any{{
				"tool": "EditFileTool", "domain": "go", "failRate": 0.42, "pWeak": 0.93, "n": 12,
				"advice": "prefer SymbolEditTool for Go edits",
			}},
			"drives": []map[string]any{{
				"label": "types clean", "value": "3 type errors", "ok": false,
				"spark": []int{1, 1, 0, 0},
			}},
			"habitNames": []string{"editfiletool-ts--bashtool-npm"},
		},
	}))

	out := stripANSI(m.mindHudView())
	for _, want := range []string{
		"Mind", "EditFileTool · go", "n=12", "P=0.93",
		"types clean", "3 type errors", "editfiletool-ts--bashtool-npm",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("mind HUD missing %q in:\n%s", want, out)
		}
	}

	// Sparkline: ok measurements render ▇, deviating ones ▁.
	if !strings.Contains(out, "▇▇▁▁") {
		t.Fatalf("expected sparkline ▇▇▁▁ in:\n%s", out)
	}
}

// The HUD's Ledger section reports the epistemic ledger's verification posture: coverage %, the
// resolved/open/expired counts, and a calibration line (overconfidence warning or "healthy").
func TestMindHudLedgerSection(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"mind": map[string]any{
			"weakSpots": 0, "driveDeviations": 0, "habits": 0,
			"ledger": map[string]any{
				"resolved": 6, "open": 2, "expired": 2, "coveragePct": 75, "overconfident": 1,
			},
		},
	}))
	out := stripANSI(m.mindHudView())
	for _, want := range []string{"Ledger", "75% verified", "resolved 6", "open 2", "expired 2", "1 domain overconfident"} {
		if !strings.Contains(out, want) {
			t.Fatalf("ledger section missing %q in:\n%s", want, out)
		}
	}

	// Healthy calibration path: no overconfident domains → the reassurance line, not the warning.
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"mind": map[string]any{"ledger": map[string]any{"resolved": 10, "open": 0, "expired": 0, "coveragePct": 100, "overconfident": 0}},
	}))
	out = stripANSI(m.mindHudView())
	if !strings.Contains(out, "calibration healthy") || strings.Contains(out, "overconfident") {
		t.Fatalf("expected healthy calibration line, got:\n%s", out)
	}
}

func TestMindHudToggleAndEsc(t *testing.T) {
	m, _ := newTestModel()
	nm, _ := m.update(tea.KeyMsg{Type: tea.KeyCtrlX})
	m = nm.(model)
	if !m.showMind {
		t.Fatal("Ctrl+X should open the mind HUD")
	}
	// The HUD must appear in the live region and suppress the ambient panels (overlay).
	if !strings.Contains(stripANSI(strings.Join(m.belowSections(), "\n")), "Mind") {
		t.Fatal("open HUD should render in belowSections")
	}
	nm, _ = m.update(tea.KeyMsg{Type: tea.KeyEsc})
	m = nm.(model)
	if m.showMind {
		t.Fatal("Esc should close the mind HUD")
	}
}

// Tab pages through the HUD's sections: overview shows everything, a section tab shows
// only its own block, Shift+Tab pages backwards, and Ctrl+X always reopens on overview.
func TestMindHudTabs(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"mind": map[string]any{
			"weak":       []map[string]any{{"tool": "EditFileTool", "domain": "go", "failRate": 0.4, "pWeak": 0.9, "n": 9}},
			"drives":     []map[string]any{{"label": "types clean", "value": "ok", "ok": true, "spark": []int{1}}},
			"habitNames": []string{"some-habit"},
		},
	}))

	nm, _ := m.update(tea.KeyMsg{Type: tea.KeyCtrlX})
	m = nm.(model)
	if m.mindTab != 0 {
		t.Fatal("Ctrl+X should open on the overview tab")
	}
	// Overview carries every section.
	out := stripANSI(m.mindHudView())
	for _, want := range []string{"Weak spots", "Drives", "Ledger", "Habits"} {
		if !strings.Contains(out, want) {
			t.Fatalf("overview missing %q in:\n%s", want, out)
		}
	}

	// Tab → weak spots only.
	nm, _ = m.update(tea.KeyMsg{Type: tea.KeyTab})
	m = nm.(model)
	out = stripANSI(m.mindHudView())
	if !strings.Contains(out, "Weak spots") || strings.Contains(out, "Habits") {
		t.Fatalf("weak-spots tab should show only its section, got:\n%s", out)
	}

	// Shift+Tab pages back to overview (and must NOT fire the /mode cycle).
	nm, _ = m.update(tea.KeyMsg{Type: tea.KeyShiftTab})
	m = nm.(model)
	if m.mindTab != 0 {
		t.Fatalf("Shift+Tab should page back to overview, got tab %d", m.mindTab)
	}

	// Reopen always lands on overview even after paging.
	nm, _ = m.update(tea.KeyMsg{Type: tea.KeyTab})
	m = nm.(model)
	nm, _ = m.update(tea.KeyMsg{Type: tea.KeyCtrlX}) // close
	m = nm.(model)
	nm, _ = m.update(tea.KeyMsg{Type: tea.KeyCtrlX}) // reopen
	m = nm.(model)
	if m.mindTab != 0 {
		t.Fatal("reopening the HUD should reset to the overview tab")
	}
}

// Empty mind state still renders an honest panel (no data ≠ broken panel).
func TestMindHudEmptyState(t *testing.T) {
	m, _ := newTestModel()
	out := stripANSI(m.mindHudView())
	for _, want := range []string{"none —", "not measured yet", "none compiled yet"} {
		if !strings.Contains(out, want) {
			t.Fatalf("empty mind HUD missing %q in:\n%s", want, out)
		}
	}
}
