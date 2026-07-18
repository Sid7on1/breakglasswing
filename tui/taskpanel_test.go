package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// Task workspaces (§6): the ui_snapshot tasks strip renders as a pinned panel with live state,
// an HONEST action set (pause only where the engine says a real suspend exists), keyboard control
// via Ctrl+E, and graceful degradation on narrow terminals.

func taskSnapshot(tasks ...map[string]any) Outbound {
	return ev("ui_snapshot", map[string]any{
		"models": map[string]string{"coding": "m", "lite": "l"},
		"tasks":  tasks,
	})
}

func TestTaskPanelRendersLiveTasks(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(taskSnapshot(
		map[string]any{"id": "tk-a1", "kind": "shell", "title": "npm run build", "state": "running",
			"elapsedMs": 65_000, "canCancel": true, "canPause": true, "canResume": true},
		map[string]any{"id": "tk-b2", "kind": "browser", "title": "docs.example.com", "state": "waiting-browser",
			"elapsedMs": 4_000, "canCancel": true},
	))

	panel := stripANSI(m.taskPanel())
	for _, want := range []string{"Tasks (2 live/2)", "npm run build", "running", "shell", "1m05s", "docs.example.com", "waiting-browser", "Ctrl+E"} {
		if !strings.Contains(panel, want) {
			t.Errorf("panel missing %q in:\n%s", want, panel)
		}
	}
}

func TestTaskPanelRetiresWhenAllDoneAndSeen(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(taskSnapshot(
		map[string]any{"id": "tk-a1", "kind": "shell", "title": "done job", "state": "completed", "elapsedMs": 1000},
	))
	if p := m.taskPanel(); p != "" {
		t.Errorf("panel should retire when nothing is live or demanding attention, got:\n%s", p)
	}
	// …but a finished task that DEMANDS attention keeps the panel up.
	m.handleEngine(taskSnapshot(
		map[string]any{"id": "tk-a1", "kind": "shell", "title": "long job", "state": "failed-resumable",
			"elapsedMs": 90_000, "attention": true},
	))
	if p := stripANSI(m.taskPanel()); !strings.Contains(p, "long job") {
		t.Errorf("panel should stay for attention-demanding tasks, got:\n%s", p)
	}
}

func TestTaskPanelNarrowTerminalDegrades(t *testing.T) {
	m, _ := newTestModel()
	m.width = 40 // below the bordered-panel threshold
	m.handleEngine(taskSnapshot(
		map[string]any{"id": "tk-a1", "kind": "shell", "title": "job", "state": "running", "elapsedMs": 1000},
	))
	p := stripANSI(m.taskPanel())
	if strings.Contains(p, "\n") {
		t.Errorf("narrow terminal must degrade to a single line, got:\n%s", p)
	}
	if !strings.Contains(p, "1 task") {
		t.Errorf("summary line should count live tasks, got: %s", p)
	}
}

func TestTaskPanelHonestActions(t *testing.T) {
	// A browser task: engine says canPause=false → the panel must not offer pause,
	// and the keyboard handler must refuse it without sending anything.
	m, buf := newTestModel()
	m.handleEngine(taskSnapshot(
		map[string]any{"id": "tk-br", "kind": "browser", "title": "session", "state": "running",
			"elapsedMs": 1000, "canCancel": true, "canPause": false},
	))
	m.tkFocus = true
	m.tkSel = 0

	panel := stripANSI(m.taskPanel())
	if strings.Contains(panel, "p pause") {
		t.Errorf("panel offered pause for an unpausable task:\n%s", panel)
	}
	if !strings.Contains(panel, "c cancel") {
		t.Errorf("panel should offer cancel:\n%s", panel)
	}

	nm, _ := m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}})
	m = nm.(model)
	if got := buf.String(); strings.Contains(got, "pause") {
		t.Errorf("pause command sent for unpausable task: %s", got)
	}
	if !strings.Contains(m.status, "no real pause") {
		t.Errorf("expected an honest refusal in status, got: %q", m.status)
	}

	// Cancel IS offered and goes through as /tasks cancel <id>.
	nm, _ = m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})
	m = nm.(model)
	if got := buf.String(); !strings.Contains(got, "/tasks cancel tk-br") {
		t.Errorf("expected /tasks cancel tk-br on the wire, got: %s", got)
	}
}

func TestTaskPanelKeyboardFlow(t *testing.T) {
	m, buf := newTestModel()
	m.handleEngine(taskSnapshot(
		map[string]any{"id": "tk-a", "kind": "shell", "title": "a", "state": "running", "elapsedMs": 1, "canCancel": true},
		map[string]any{"id": "tk-b", "kind": "shell", "title": "b", "state": "failed-resumable", "elapsedMs": 1},
	))

	// Ctrl+E focuses; ↓ selects the second task; r retries the failed-resumable one.
	nm, _ := m.handleKey(tea.KeyMsg{Type: tea.KeyCtrlE})
	m = nm.(model)
	if !m.tkFocus {
		t.Fatal("Ctrl+E should focus the task panel")
	}
	nm, _ = m.handleKey(tea.KeyMsg{Type: tea.KeyDown})
	m = nm.(model)
	if m.tkSel != 1 {
		t.Fatalf("↓ should select row 1, got %d", m.tkSel)
	}
	nm, _ = m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}})
	m = nm.(model)
	if got := buf.String(); !strings.Contains(got, "/tasks retry tk-b") {
		t.Errorf("expected /tasks retry tk-b, got: %s", got)
	}

	// Esc releases; an emptied strip auto-releases focus and clamps the selection.
	nm, _ = m.handleKey(tea.KeyMsg{Type: tea.KeyEsc})
	m = nm.(model)
	if m.tkFocus {
		t.Fatal("esc should release focus")
	}
	m.tkFocus = true
	m.handleEngine(taskSnapshot())
	if m.tkFocus || m.tkSel != 0 {
		t.Errorf("empty strip should release focus and reset selection (focus=%v sel=%d)", m.tkFocus, m.tkSel)
	}
}

func TestTaskActionsMatchStateMachine(t *testing.T) {
	cases := []struct {
		task TaskStrip
		want []string
		not  []string
	}{
		{TaskStrip{State: "running", CanCancel: true, CanPause: true}, []string{"c cancel", "p pause"}, []string{"r resume", "d dismiss"}},
		{TaskStrip{State: "paused", CanCancel: true, CanResume: true}, []string{"r resume"}, []string{"p pause"}},
		{TaskStrip{State: "failed-resumable"}, []string{"r retry", "d dismiss"}, []string{"c cancel"}},
		{TaskStrip{State: "completed"}, []string{"d dismiss"}, []string{"c cancel", "p pause"}},
		{TaskStrip{State: "cancelling", CanCancel: true}, nil, []string{"c cancel"}},
	}
	for _, c := range cases {
		got := strings.Join(taskActions(c.task), " · ")
		for _, w := range c.want {
			if !strings.Contains(got, w) {
				t.Errorf("state %s: missing action %q (got %q)", c.task.State, w, got)
			}
		}
		for _, n := range c.not {
			if strings.Contains(got, n) {
				t.Errorf("state %s: offered impossible action %q (got %q)", c.task.State, n, got)
			}
		}
	}
}
