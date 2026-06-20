package main

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ansiRE strips SGR color/style escapes so content assertions don't depend on theming (the warm
// markdown style colorizes body text, which would otherwise split words with reset codes).
var ansiRE = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func stripANSI(s string) string { return ansiRE.ReplaceAllString(s, "") }

// In-memory engine so we can drive the model's Update logic and inspect what it sends back,
// without spawning a real engine or needing a TTY.
type nopWC struct{ *bytes.Buffer }

func (nopWC) Close() error { return nil }

func newTestModel() (model, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	e := &Engine{stdin: nopWC{buf}, Msgs: make(chan Outbound, 8)}
	m := initialModel(e)
	m.width = 80
	return m, buf
}

func ev(name string, args ...any) Outbound {
	raw := make([]json.RawMessage, len(args))
	for i, a := range args {
		b, _ := json.Marshal(a)
		raw[i] = b
	}
	return Outbound{T: "event", Name: name, Args: raw}
}

func TestFooterState(t *testing.T) {
	m, _ := newTestModel()

	m.handleEngine(ev("ui_snapshot", map[string]any{
		"models":    map[string]string{"coding": "minimaxai/minimax-m3", "lite": "stepfun-ai/step-3.5-flash"},
		"goalCount": 2,
	}))
	m.handleEngine(ev("model_tier", map[string]any{"tier": "heavy", "pinned": "heavy"}))
	m.handleEngine(ev("mode_change", "explore"))
	m.handleEngine(ev("cost_update", 4000)) // 4000 chars ≈ 1000 tok

	if m.fGoals != 2 || m.fTier != "heavy" || m.fMode != "explore" || m.fTokens != 1000 {
		t.Fatalf("footer state wrong: %+v", m)
	}

	foot := m.footerLine()
	for _, want := range []string{"heavy", "minimax-m3", "1.0k tok", "2 goals", "[explore]"} {
		if !strings.Contains(foot, want) {
			t.Errorf("footer missing %q in:\n%s", want, foot)
		}
	}
}

func TestInterruptWhileBusy(t *testing.T) {
	m, buf := newTestModel()

	// Engine signals it's working — Ctrl+C should now cancel the turn, not quit.
	m.handleEngine(ev("spinner_state", "thinking", "Thinking…"))
	if !m.busy {
		t.Fatal("busy not set on spinner_state thinking")
	}

	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd != nil {
		t.Fatal("Ctrl+C while busy should not quit (nil cmd expected)")
	}
	if !strings.Contains(buf.String(), `"t":"interrupt"`) {
		t.Fatalf("interrupt not sent to engine; wire = %q", buf.String())
	}

	// Turn ends → idle. A second Ctrl+C now quits.
	m.handleEngine(ev("spinner_state", "idle", "Awaiting orders…"))
	if m.busy {
		t.Fatal("busy not cleared on spinner_state idle")
	}
	if _, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC}); cmd == nil {
		t.Fatal("Ctrl+C while idle should quit (non-nil cmd expected)")
	}
}

func TestTodoUpdateRendersAndDedupes(t *testing.T) {
	m, _ := newTestModel()

	todos := []map[string]any{
		{"content": "write parser", "status": "completed"},
		{"content": "wire the loop", "status": "in_progress"},
		{"content": "add tests", "status": "pending"},
	}
	m.handleEngine(ev("todo_update", todos))

	joined := strings.Join(m.lines, "\n")
	for _, want := range []string{"Tasks (1/3)", "write parser", "wire the loop", "add tests"} {
		if !strings.Contains(joined, want) {
			t.Errorf("todo render missing %q in:\n%s", want, joined)
		}
	}

	// An identical update must not append a second checklist block.
	before := len(m.lines)
	m.handleEngine(ev("todo_update", todos))
	if len(m.lines) != before {
		t.Fatalf("identical todo_update was re-appended: %d → %d lines", before, len(m.lines))
	}
}

func TestShutdownQuits(t *testing.T) {
	m, _ := newTestModel()
	// shutdown event must flag quitting and make the engineMsg path return tea.Quit.
	next, cmd := m.Update(tea.Msg(engineMsg(ev("shutdown"))))
	nm := next.(model)
	if !nm.quitting {
		t.Fatal("shutdown did not set quitting")
	}
	if cmd == nil {
		t.Fatal("shutdown should return a quit command")
	}
}

func TestCwdAndLoopDetected(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("cwd_changed", "/tmp/project"))
	if m.cwd != "/tmp/project" {
		t.Fatalf("cwd = %q", m.cwd)
	}
	m.handleEngine(ev("loop_detected", map[string]any{
		"type": "repeat", "tool": "BashTool", "count": 3, "severity": "hard",
	}))
	joined := strings.Join(m.lines, "\n")
	if !strings.Contains(joined, "/tmp/project") || !strings.Contains(joined, "BashTool") || !strings.Contains(joined, "×3") {
		t.Fatalf("cwd/loop not rendered:\n%s", joined)
	}
}

func TestStreamThenFinalMessage(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("stream_token", "Hel"))
	m.handleEngine(ev("stream_token", "lo"))
	if m.stream != "Hello" {
		t.Fatalf("stream = %q", m.stream)
	}
	// The final assistant message supersedes the streamed partial.
	m.handleEngine(ev("message", map[string]any{"role": "assistant", "content": "Hello world"}))
	if m.stream != "" {
		t.Fatalf("stream not cleared after final message: %q", m.stream)
	}
	joined := stripANSI(strings.Join(m.lines, "\n"))
	if !strings.Contains(joined, "Hello world") {
		t.Fatalf("final message not committed: %q", joined)
	}
}

func TestApprovalRoundTrip(t *testing.T) {
	m, buf := newTestModel()
	m.handleEngine(Outbound{T: "request", ID: 7, Kind: "prompt", Question: "Run rm -rf?", Options: []string{"Yes", "No"}})
	if !m.reqOpen || m.reqID != 7 {
		t.Fatalf("approval not opened: %+v", m)
	}
	m.answer("No")
	if m.reqOpen {
		t.Fatal("approval still open after answer")
	}
	var reply map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &reply); err != nil {
		t.Fatalf("reply not valid JSON: %v (%q)", err, buf.String())
	}
	if reply["t"] != "reply" || reply["value"] != "No" || reply["id"].(float64) != 7 {
		t.Fatalf("wrong reply: %v", reply)
	}
}

func TestAcceptCompletion(t *testing.T) {
	cases := []struct {
		name, input, value, kind, want string
	}{
		{"command replaces line", "/gi", "/git", "command", "/git "},
		{"symbol replaces trailing @token", "rename @hand", "@handlePayment", "symbol", "rename @handlePayment "},
		{"path keeps cursor on dir (no space)", "see @./sr", "@./src/", "path", "see @./src/"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m, _ := newTestModel()
			m.input.SetValue(c.input)
			m.comps = []CompletionItem{{Value: c.value, Kind: c.kind}}
			m.compOpen = true
			m.acceptCompletion()
			if got := m.input.Value(); got != c.want {
				t.Fatalf("got %q want %q", got, c.want)
			}
			if m.compOpen {
				t.Fatal("dropdown should close after accept")
			}
		})
	}
}

func TestQueryResultOpensDropdown(t *testing.T) {
	m, _ := newTestModel()
	m.input.SetValue("/g")
	m.queryID = 3
	m.handleEngine(Outbound{T: "queryResult", ID: 3, Items: []CompletionItem{{Label: "/git", Value: "/git", Kind: "command"}}})
	if !m.compOpen || len(m.comps) != 1 {
		t.Fatalf("dropdown not opened: %+v", m.comps)
	}
	// A stale result (wrong id) must be ignored.
	m.handleEngine(Outbound{T: "queryResult", ID: 1, Items: nil})
	if !m.compOpen {
		t.Fatal("stale queryResult wrongly closed the dropdown")
	}
}

func TestDiffApproval(t *testing.T) {
	m, buf := newTestModel()
	m.width = 80
	m.handleEngine(Outbound{
		T: "request", ID: 9, Kind: "diff", Question: "Edit foo.ts",
		Options: []string{"Approve", "Reject"}, Body: "@@ -1 +1 @@\n-old\n+new",
	})
	if !m.reqOpen || m.reqKind != "diff" || !strings.Contains(m.reqBody, "+new") {
		t.Fatalf("diff request not captured: %+v", m)
	}
	// The overlay renders the diff body.
	if !strings.Contains(m.View(), "new") {
		t.Fatal("diff body not rendered in overlay")
	}
	m.answer("Approve")
	var reply map[string]any
	_ = json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &reply)
	if reply["value"] != "Approve" || reply["id"].(float64) != 9 {
		t.Fatalf("wrong reply: %v", reply)
	}
}

func TestFreeFormInputPrompt(t *testing.T) {
	m, buf := newTestModel()
	m.handleEngine(Outbound{T: "request", ID: 5, Kind: "input", Question: "Enter API key:"})
	if !m.reqOpen || m.reqKind != "input" {
		t.Fatalf("input prompt not opened: %+v", m)
	}
	// The question shows in the mid slot; the input box stays usable.
	if !strings.Contains(m.View(), "Enter API key:") {
		t.Fatal("prompt question not rendered")
	}
	// Type an answer and press enter → reply carries the typed value.
	m.input.SetValue("sk-secret")
	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = m2.(model)
	if m.reqOpen {
		t.Fatal("prompt still open after submit")
	}
	var reply map[string]any
	_ = json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &reply)
	if reply["t"] != "reply" || reply["value"] != "sk-secret" || reply["id"].(float64) != 5 {
		t.Fatalf("wrong reply: %v", reply)
	}
}

func TestThinkingShowsInStatus(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("thinking", "Considering the parser refactor"))
	if !strings.Contains(m.status, "Considering the parser") {
		t.Fatalf("thinking not surfaced: %q", m.status)
	}
}

func TestInteractiveMenu(t *testing.T) {
	m, buf := newTestModel()
	m.height = 24
	menu := map[string]any{
		"title": "Palette",
		"options": []map[string]string{
			{"label": "/git", "value": "/git", "desc": "Git status"},
			{"label": "/diff", "value": "/diff", "desc": "Git diff"},
		},
	}
	m.handleEngine(ev("message", map[string]any{"role": "system", "uiComponent": "menu", "payload": menu}))
	if !m.menuOpen || len(m.menuOpts) != 2 {
		t.Fatalf("menu not opened interactively: %+v", m.menuOpts)
	}
	if !strings.Contains(m.menuView(), "Palette") || !strings.Contains(m.menuView(), "/git") {
		t.Fatal("menu not rendered")
	}

	// Navigate down and select → the option's value is sent as input.
	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = m2.(model)
	m3, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = m3.(model)
	if m.menuOpen {
		t.Fatal("menu should close after selection")
	}
	var sent map[string]any
	_ = json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &sent)
	if sent["t"] != "input" || sent["text"] != "/diff" {
		t.Fatalf("selecting the 2nd option should send /diff, got %v", sent)
	}
}

func TestInputHistory(t *testing.T) {
	m, _ := newTestModel()
	m.height = 24

	for _, s := range []string{"first", "second"} {
		m.input.SetValue(s)
		mm, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
		m = mm.(model)
	}
	if len(m.history) != 2 {
		t.Fatalf("history = %v", m.history)
	}

	// Up recalls most-recent-first.
	up := func() { mm, _ := m.Update(tea.KeyMsg{Type: tea.KeyUp}); m = mm.(model) }
	down := func() { mm, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown}); m = mm.(model) }

	up()
	if m.input.Value() != "second" {
		t.Fatalf("up#1 = %q", m.input.Value())
	}
	up()
	if m.input.Value() != "first" {
		t.Fatalf("up#2 = %q", m.input.Value())
	}
	// Down walks forward, restoring the (empty) in-progress line at the end.
	down()
	if m.input.Value() != "second" {
		t.Fatalf("down#1 = %q", m.input.Value())
	}
	down()
	if m.input.Value() != "" {
		t.Fatalf("down#2 should restore the blank in-progress line, got %q", m.input.Value())
	}
}

func TestMultilineInputGrowsAndResets(t *testing.T) {
	m, _ := newTestModel()
	m.height = 24
	m.input.SetValue("line1")
	m.input.CursorEnd()

	// Ctrl+J inserts a newline (paste a code block) — the box grows.
	mm, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlJ})
	m = mm.(model)
	if m.input.LineCount() != 2 {
		t.Fatalf("ctrl+j should add a line, got %d", m.input.LineCount())
	}
	if m.input.Height() != 2 {
		t.Fatalf("input should grow to 2 rows, got %d", m.input.Height())
	}

	// Enter submits the whole multi-line buffer as one input and resets the box to one row.
	mm, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = mm.(model)
	if m.input.Height() != 1 {
		t.Fatalf("height should reset to 1 after submit, got %d", m.input.Height())
	}
}

func TestSpinnerShownWhileBusy(t *testing.T) {
	m, _ := newTestModel()
	m.height = 24
	m.handleEngine(ev("spinner_state", "thinking", "Working…"))
	if !m.busy {
		t.Fatal("busy not set")
	}
	// The busy View prefixes the status with the spinner's current frame.
	if frame := strings.TrimSpace(m.spin.View()); frame != "" && !strings.Contains(m.View(), frame) {
		t.Fatalf("spinner frame %q not in view", frame)
	}
}

func TestViewportHugsShortContent(t *testing.T) {
	m, _ := newTestModel()
	m.height = 40 // a tall terminal — the old code hard-sized the viewport to ~35 rows here

	// A short conversation: the viewport must take only the rows the content needs, so the input +
	// footer hug the last line instead of being shoved to the bottom of the screen (the giant gap).
	m.append("❯ hi")
	m.append("Hey! What's on your mind today?")

	body := m.transcriptBody()
	if got, want := m.vp.Height, lipgloss.Height(body); got != want {
		t.Fatalf("viewport should hug content: height=%d, content=%d", got, want)
	}
	if m.vp.Height > 10 {
		t.Fatalf("viewport over-tall for 2 lines of content: %d (giant-gap regression)", m.vp.Height)
	}

	// Once content outgrows the available rows it caps and scrolls instead of overflowing.
	for i := 0; i < 200; i++ {
		m.append("line")
	}
	avail := m.height - (4 + m.input.Height())
	if m.vp.Height != avail {
		t.Fatalf("tall content should cap viewport at %d, got %d", avail, m.vp.Height)
	}
}

func TestFooterRendersBelowInput(t *testing.T) {
	m, _ := newTestModel()
	m.height = 24
	m.handleEngine(ev("model_tier", map[string]any{"tier": "lite"}))
	v := stripANSI(m.View())
	foot := strings.Index(v, "◆ lite")
	input := strings.Index(v, "Ask BiMax")
	if foot < 0 || input < 0 {
		t.Fatalf("view missing footer (%d) or input (%d):\n%s", foot, input, v)
	}
	if foot < input {
		t.Fatalf("footer must render below the input (footer@%d, input@%d)", foot, input)
	}
}

func TestRenderMarkdown(t *testing.T) {
	out := renderMarkdown("# Title\n\n- one\n- two\n\n`code`", 60)
	if out == "" || !strings.Contains(out, "one") || !strings.Contains(out, "two") {
		t.Fatalf("markdown not rendered: %q", out)
	}
	// Markdown was processed, not passed through verbatim: glamour turns "- " bullets into "•"
	// (and applies ANSI styling on a real terminal; color is suppressed in this non-TTY test).
	if !strings.Contains(out, "•") {
		t.Fatalf("markdown not transformed (no bullet glyph): %q", out)
	}
}
