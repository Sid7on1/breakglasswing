package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// TestMain redirects prompt-history persistence to a throwaway file so the suite never reads or
// clobbers the user's real ~/.breakglass/history.json.
func TestMain(m *testing.M) {
	os.Setenv("BIMAX_HISTORY_PATH", filepath.Join(os.TempDir(), "bimax-test-history.json"))
	os.Exit(m.Run())
}

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
	// Isolate tests from the on-disk prompt history (~/.breakglass/history.json) the real model
	// loads at startup, and disable the completion bell so test output stays quiet.
	m.history = nil
	m.histIdx = 0
	m.bell = false
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

	// Footer mirrors Ink Footer.tsx: ⇧ marks the heavy tier, the mode is a "{mode} ·" prefix, plus
	// the model name, token estimate, goal count and 📌 pin.
	foot := stripANSI(m.footerLine())
	for _, want := range []string{"⇧", "minimax-m3", "1.0k tok", "2 goals", "explore ·", "📌"} {
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

func TestThinkingShowsSnippet(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("thinking", "Considering the parser refactor"))
	// The reasoning tail surfaces in the ThinkingText line (Ink relocates it out of the status bar).
	if !strings.Contains(m.thinkSnip, "Considering the parser") {
		t.Fatalf("thinking not surfaced: %q", m.thinkSnip)
	}
	m.busy = true
	if !strings.Contains(stripANSI(m.thinkingView()), "Considering the parser") {
		t.Fatalf("thinking snippet not in thinkingView: %q", m.thinkingView())
	}
}

func TestInteractiveMenu(t *testing.T) {
	m, buf := newTestModel()
	m.height = 24
	menu := map[string]any{
		"id":    "menu-1",
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

	// Navigate down and select → a menuSelect carrying the option value + menu id is sent, so the
	// engine can run that menu's onSelect (not dispatch the value as a chat turn).
	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = m2.(model)
	m3, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = m3.(model)
	if m.menuOpen {
		t.Fatal("menu should close after selection")
	}
	var sent map[string]any
	_ = json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &sent)
	if sent["t"] != "menuSelect" || sent["value"] != "/diff" || sent["id"] != "menu-1" {
		t.Fatalf("selecting the 2nd option should send menuSelect /diff (id menu-1), got %v", sent)
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
	// Before the first token the live region shows the rotating ThinkingText (✻ phrase).
	if !strings.Contains(stripANSI(m.View()), "✻") {
		t.Fatalf("thinking indicator not shown while busy:\n%s", stripANSI(m.View()))
	}
	// Once tokens stream, the WorkingIndicator's braille spinner frame appears.
	m.handleEngine(ev("stream_token", "hello"))
	if frame := strings.TrimSpace(m.spin.View()); frame != "" && !strings.Contains(m.View(), frame) {
		t.Fatalf("spinner frame %q not in view while streaming", frame)
	}
}

// Inline mode: committed transcript lines are QUEUED for the terminal's native scrollback
// (flushed via tea.Println), not rendered in the live View. The live View only shows in-flight
// content (the streaming answer) plus chrome (input/footer/menus).
func TestInlineCommitsToScrollback(t *testing.T) {
	m, _ := newTestModel()
	m.height = 40

	m.append("❯ hi")
	m.append("Hey! What's on your mind today?")

	if len(m.printQueue) != 2 {
		t.Fatalf("expected 2 lines queued for scrollback, got %d", len(m.printQueue))
	}
	if strings.Contains(stripANSI(m.View()), "What's on your mind") {
		t.Fatalf("committed transcript must NOT be in the live View — it belongs in scrollback")
	}

	// An in-flight streamed answer DOES render live.
	m.stream = "thinking out loud"
	if !strings.Contains(stripANSI(m.View()), "thinking out loud") {
		t.Fatalf("live stream should render in the View")
	}
}

func TestFooterRendersBelowInput(t *testing.T) {
	m, _ := newTestModel()
	m.height = 24
	m.handleEngine(ev("model_tier", map[string]any{"tier": "lite"}))
	v := stripANSI(m.View())
	foot := strings.Index(v, "▸ default")
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

func runeKey(s string) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
}

func TestPasteCollapseAndExpand(t *testing.T) {
	m, buf := newTestModel()
	m.height = 24
	// A bracketed multi-line paste collapses to a single chip in the input.
	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("line1\nline2\nline3"), Paste: true})
	m = m2.(model)
	if len(m.pastes) != 1 || m.pastes[0].Lines != 3 {
		t.Fatalf("paste not collapsed to a 3-line chip: %+v", m.pastes)
	}
	if !strings.Contains(m.input.Value(), "[Pasted text #1 +3 lines]") {
		t.Fatalf("chip placeholder not inserted: %q", m.input.Value())
	}
	// On submit the chip expands back to the real text on the wire.
	m3, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = m3.(model)
	var sent map[string]any
	_ = json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &sent)
	if !strings.Contains(sent["text"].(string), "line1\nline2\nline3") {
		t.Fatalf("paste not expanded on submit: %v", sent["text"])
	}
	if len(m.pastes) != 0 {
		t.Fatalf("pastes not cleared after submit: %+v", m.pastes)
	}
}

func TestStashAndResume(t *testing.T) {
	m, _ := newTestModel()
	m.input.SetValue("draft prompt")
	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	m = m2.(model)
	if m.stash != "draft prompt" || m.input.Value() != "" {
		t.Fatalf("esc did not stash: stash=%q input=%q", m.stash, m.input.Value())
	}
	if !strings.Contains(stripANSI(m.View()), "[Stashed]") {
		t.Fatalf("stash hint not shown")
	}
	m3, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlR})
	m = m3.(model)
	if m.input.Value() != "draft prompt" || m.stash != "" {
		t.Fatalf("ctrl+r did not resume: input=%q stash=%q", m.input.Value(), m.stash)
	}
}

func TestSearchMatchesAndNavigation(t *testing.T) {
	m, _ := newTestModel()
	m.height = 30
	m.append("❯ fix the parser error")
	m.append(asstStyle.Render("the error was a missing token"))
	m.logs = append(m.logs, LogEntry{Level: "error", Text: "compile error here"})

	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlF})
	m = m2.(model)
	if !m.searchMode {
		t.Fatal("ctrl+f did not enter search mode")
	}
	for _, r := range "error" {
		mm, _ := m.Update(runeKey(string(r)))
		m = mm.(model)
	}
	matches := m.searchMatches()
	if len(matches) < 3 {
		t.Fatalf("expected ≥3 matches for 'error', got %d", len(matches))
	}
	if !strings.Contains(stripANSI(m.searchView()), "of") {
		t.Fatalf("search results header missing: %q", stripANSI(m.searchView()))
	}
	// Enter advances the current match index.
	before := m.searchIdx
	m3, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = m3.(model)
	if m.searchIdx == before {
		t.Fatal("enter did not advance search index")
	}
	// Esc exits and restores the prior input.
	m4, _ := m.Update(tea.KeyMsg{Type: tea.KeyEscape})
	m = m4.(model)
	if m.searchMode {
		t.Fatal("esc did not exit search mode")
	}
}

func TestMenuFuzzyFilter(t *testing.T) {
	m, _ := newTestModel()
	m.height = 24
	m.handleEngine(ev("message", map[string]any{
		"role": "system", "uiComponent": "menu",
		"payload": map[string]any{"title": "Palette", "options": []map[string]string{
			{"label": "/git", "value": "/git", "desc": "Git status"},
			{"label": "/config", "value": "/config", "desc": "Settings"},
			{"label": "/model", "value": "/model", "desc": "Pick model"},
		}},
	}))
	if !m.menuOpen {
		t.Fatal("menu not opened")
	}
	for _, r := range "conf" {
		mm, _ := m.Update(runeKey(string(r)))
		m = mm.(model)
	}
	filtered := m.filteredMenu()
	if len(filtered) != 1 || filtered[0].Value != "/config" {
		t.Fatalf("fuzzy filter wrong: %+v", filtered)
	}
	if !strings.Contains(stripANSI(m.menuView()), "/config") {
		t.Fatal("filtered menu not rendered")
	}
}

func TestHistoryPersistence(t *testing.T) {
	m, _ := newTestModel()
	m.pushHistory("alpha")
	m.pushHistory("beta")
	got := loadHistory()
	if len(got) < 2 || got[len(got)-1] != "beta" || got[len(got)-2] != "alpha" {
		t.Fatalf("history not persisted/loaded: %v", got)
	}
}

func TestThoughtTimeDisplay(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("message", map[string]any{"role": "user", "content": "hi"}))
	m.handleEngine(ev("message", map[string]any{
		"role": "assistant", "content": "done", "thoughtMs": 1500,
	}))
	joined := stripANSI(strings.Join(m.lines, "\n"))
	if !strings.Contains(joined, "Thought for 1s") {
		t.Fatalf("thought-time line missing: %q", joined)
	}
}

func TestToolCallTimingAndAgentLabel(t *testing.T) {
	tc := ToolCall{
		ID: "1", ToolName: "BashTool", Status: "success", Input: `{"command":"ls"}`,
		Output: "a\nb", StartTime: "2026-06-20T10:00:00Z", EndTime: "2026-06-20T10:00:02Z",
		AgentLabel: "explorer",
	}
	out := stripANSI(renderToolCall(tc))
	if !strings.Contains(out, "2.0s") {
		t.Fatalf("timing badge missing: %q", out)
	}
	if !strings.Contains(out, "[explorer]") {
		t.Fatalf("agent label missing: %q", out)
	}
}

func TestTokenMeterRenders(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"models":         map[string]string{"coding": "x/big-model", "lite": "x/lite"},
		"contextWindow":  1000,
		"tokensBaseline": 400, // fixed per-request cost (system prompt + tool schemas)
	}))
	// A user + assistant turn adds conversation tokens on top of the baseline.
	m.handleEngine(ev("message", map[string]any{"role": "user", "content": strings.Repeat("a", 400)})) // ~100 tok
	// Default (no pin / auto) → the meter shows the LITE model that actually answers.
	tm := stripANSI(m.tokenMeterView())
	if !strings.Contains(tm, "lite") || !strings.Contains(tm, "tok") {
		t.Fatalf("token meter should show the active (lite) model: %q", tm)
	}
	// 400 baseline + 100 history = 500 / 1000 = 50%.
	if !strings.Contains(tm, "50%") {
		t.Fatalf("token meter percent wrong (want 50%%): %q", tm)
	}
	// Pinned heavy → the meter switches to the coding model (matches the footer pointer).
	m.handleEngine(ev("model_tier", map[string]any{"tier": "heavy", "pinned": "heavy"}))
	if tmh := stripANSI(m.tokenMeterView()); !strings.Contains(tmh, "big-model") {
		t.Fatalf("heavy tier: meter should show the coding model: %q", tmh)
	}
}

func TestMapPanelRenders(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"models": map[string]string{"coding": "x/m"},
		"graph": map[string]any{
			"nodeCount": 42, "fileCount": 7, "aiGraphBuilt": true,
			"modules": []map[string]string{{"name": "core", "criticality": "CRITICAL"}},
		},
	}))
	if m.graph.NodeCount != 42 {
		t.Fatalf("graph snapshot not stored: %+v", m.graph)
	}
	panel := stripANSI(m.mapPanelView())
	if !strings.Contains(panel, "42 nodes") || !strings.Contains(panel, "core") {
		t.Fatalf("map panel missing data: %q", panel)
	}
}

func TestDashboardRouting(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("message", map[string]any{
		"role": "system", "uiComponent": "HelpDashboard",
		"payload": map[string]any{"sections": []map[string]any{
			{"title": "Core", "color": "green", "commands": []map[string]string{
				{"cmd": "/help", "desc": "Show help"},
			}},
		}},
	}))
	joined := stripANSI(strings.Join(m.lines, "\n"))
	if !strings.Contains(joined, "/help") || !strings.Contains(joined, "Show help") {
		t.Fatalf("help dashboard not rendered: %q", joined)
	}
}

func TestMaskedInputPrompt(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(Outbound{T: "request", ID: 7, Kind: "input", Question: "Enter your API key:"})
	if !m.reqMasked {
		t.Fatal("API key prompt not flagged masked")
	}
	m.input.SetValue("sk-123456")
	if strings.Contains(stripANSI(m.promptView()), "sk-123456") {
		t.Fatal("masked prompt leaked the secret value")
	}
	if !strings.Contains(stripANSI(m.promptView()), "•") {
		t.Fatal("masked prompt not rendered as bullets")
	}
}

func TestLogViewToggle(t *testing.T) {
	m, _ := newTestModel()
	m.height = 30
	m.logs = append(m.logs, LogEntry{Level: "warn", Text: "heads up", Timestamp: "2026-06-20T10:00:00Z"})
	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlO})
	m = m2.(model)
	if !m.showLogs {
		t.Fatal("ctrl+o did not toggle log view")
	}
	lv := stripANSI(m.logView())
	if !strings.Contains(lv, "WARN") || !strings.Contains(lv, "heads up") {
		t.Fatalf("log view missing entry: %q", lv)
	}
}

func TestShortcutsCommandLocal(t *testing.T) {
	m, buf := newTestModel()
	m.input.SetValue("/shortcuts")
	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = m2.(model)
	// Handled Go-side: nothing sent to the engine, shortcuts rendered into the transcript.
	if buf.Len() != 0 {
		t.Fatalf("/shortcuts should not hit the engine, sent: %q", buf.String())
	}
	if !strings.Contains(stripANSI(strings.Join(m.lines, "\n")), "Command palette") {
		t.Fatal("shortcuts table not rendered")
	}
}

func TestMultilineHint(t *testing.T) {
	m, _ := newTestModel()
	m.input.SetValue("line1\nline2")
	if !strings.Contains(stripANSI(m.promptView()), "2 lines") {
		t.Fatalf("multi-line hint missing: %q", stripANSI(m.promptView()))
	}
}

// TestClearFlow reproduces the real /clear keystroke path: type "/clear", the engine returns a
// completion, Enter runs the command, and the engine's menu message opens the confirm menu.
func TestClearFlow(t *testing.T) {
	m, buf := newTestModel()
	m.height = 24

	// Completion dropdown for "/clear" (as the engine's queryResult would populate it).
	m.input.SetValue("/clear")
	m.queryID = 1
	m.handleEngine(Outbound{T: "queryResult", ID: 1, Items: []CompletionItem{
		{Value: "/clear", Label: "/clear", Desc: "Clear", Kind: "command"},
	}})
	if !m.compOpen {
		t.Fatal("completion dropdown should be open for /clear")
	}

	// Enter runs the highlighted command.
	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = m2.(model)
	var sent map[string]any
	_ = json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &sent)
	if sent["t"] != "input" || sent["text"] != "/clear" {
		t.Fatalf("Enter on /clear completion should send input /clear, got %v", sent)
	}

	// The engine answers with the confirm menu → it must open.
	menu := map[string]any{
		"id":    "menu-1",
		"title": "Clear the conversation and screen?",
		"options": []map[string]string{
			{"label": "Yes, clear it", "value": "/clear force", "desc": "wipe"},
			{"label": "Cancel", "value": "", "desc": "keep"},
		},
	}
	m.handleEngine(ev("message", map[string]any{"role": "system", "uiComponent": "menu", "payload": menu}))
	if !m.menuOpen {
		t.Fatal("confirm menu should open after /clear")
	}
	if !strings.Contains(m.menuView(), "Clear the conversation") {
		t.Fatalf("menu not rendered: %q", m.menuView())
	}

	// The clear event wipes the transcript.
	m.append("some old line")
	m.handleEngine(ev("clear"))
	if len(m.lines) != 0 {
		// showWelcome re-adds the banner as ONE entry, so after clear lines should be just the banner.
		if len(m.lines) > 1 {
			t.Fatalf("clear should wipe transcript (welcome banner only), got %d lines", len(m.lines))
		}
	}
}

// TestTranscriptBounded guards the in-memory search copy: append() keeps m.lines (used only by
// Ctrl+F search) bounded on very long sessions. The visible transcript lives in terminal scrollback.
func TestTranscriptBounded(t *testing.T) {
	m, _ := newTestModel()

	for i := 0; i < transcriptCap+300; i++ {
		m.append("x")
	}

	if len(m.lines) > transcriptCap {
		t.Fatalf("in-memory search copy exceeded cap: %d > %d", len(m.lines), transcriptCap)
	}
}
