package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

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
	joined := strings.Join(m.lines, "\n")
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
