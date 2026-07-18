package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
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
	m.height = 40
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

	// Footer mirrors Ink Footer.tsx: ⇧ marks the heavy tier, the mode is a bold uppercase CHIP, plus
	// the model name, token estimate, goal count and 📌 pin.
	foot := stripANSI(m.footerLine())
	for _, want := range []string{"⇧", "minimax-m3", "1.0k tok", "2 goals", "EXPLORE", "◈"} {
		if !strings.Contains(foot, want) {
			t.Errorf("footer missing %q in:\n%s", want, foot)
		}
	}
}

func TestOutcomeStripUsesEngineCompletionFacts(t *testing.T) {
	m, _ := newTestModel()
	m.width = 140
	m.handleEngine(ev("outcome_update", map[string]any{
		"sessionId": "s1", "objective": "Implement the verified outcome runtime",
		"phase": "verifying", "iteration": 7, "elapsedMs": 125000,
		"passed": 4, "required": 6, "openTasks": 2, "activeTasks": 1, "recoveringTasks": 1,
		"continuationState": "running", "continuationWakeups": 2,
		"openGaps": 2, "canComplete": false,
		"schedule": map[string]any{"activeAgents": 2, "readyTasks": 1, "waitingTasks": 1, "blockedTasks": 1, "parallelTasks": 3, "criticalTaskTitle": "API integration"},
	}))
	strip := stripANSI(m.outcomeStripView())
	for _, want := range []string{"LOOP 7", "VERIFYING", "4/6 PASSED", "2 GAPS", "2 TASKS", "3∥", "RUN 2", "RECOVER 1", "AUTO 2", "READY 1", "WAIT 1", "BLOCK 1", "CRIT API integration"} {
		if !strings.Contains(strip, want) {
			t.Errorf("outcome strip missing %q in %q", want, strip)
		}
	}
	if got := lipgloss.Width(m.outcomeStripView()); got > m.width-2 {
		t.Fatalf("outcome strip width %d exceeds budget %d", got, m.width-2)
	}

	// Null clears the strip when a new/simple thread has no substantial outcome contract.
	m.handleEngine(ev("outcome_update", nil))
	if m.fOutcome != nil || m.outcomeStripView() != "" {
		t.Fatal("null outcome update should clear the compact strip")
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
	m.handleEngine(ev("spinner_state", "idle", "Ready"))
	if m.busy {
		t.Fatal("busy not cleared on spinner_state idle")
	}
	if _, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC}); cmd == nil {
		t.Fatal("Ctrl+C while idle should quit (non-nil cmd expected)")
	}
}

func TestEngineBatchCoalesces(t *testing.T) {
	// A fast model floods stream_token events. waitForEngine must coalesce everything already queued
	// into ONE engineBatch so Update renders once per burst, not once per token (the 6-min stall).
	e := &Engine{stdin: nopWC{&bytes.Buffer{}}, Msgs: make(chan Outbound, 16)}
	for i := 0; i < 5; i++ {
		e.Msgs <- ev("stream_token", "tok")
	}
	msg := waitForEngine(e)()
	batch, ok := msg.(engineBatch)
	if !ok {
		t.Fatalf("expected engineBatch, got %T", msg)
	}
	if len(batch) != 5 {
		t.Fatalf("expected 5 coalesced messages in one batch, got %d", len(batch))
	}
}

func TestQueueWhileBusy(t *testing.T) {
	m, buf := newTestModel()

	// A turn is running — a submitted prompt is queued, NOT sent to the engine.
	m.handleEngine(ev("spinner_state", "thinking", "Thinking…"))
	m.input.SetValue("queued task")
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(model)
	if len(m.queued) != 1 {
		t.Fatalf("prompt not queued while busy: %v", m.queued)
	}
	if strings.Contains(buf.String(), "queued task") {
		t.Fatalf("queued prompt was sent to the engine immediately; wire = %q", buf.String())
	}

	// Turn ends → idle drains the queue and dispatches the prompt.
	m.handleEngine(ev("spinner_state", "idle", "Ready"))
	if len(m.queued) != 0 {
		t.Fatalf("queue not drained on idle: %v", m.queued)
	}
	if !strings.Contains(buf.String(), "queued task") {
		t.Fatalf("queued prompt not dispatched after the turn; wire = %q", buf.String())
	}
}

func TestAmbientPanelsNeverFullWidth(t *testing.T) {
	// A line that fills the whole terminal width auto-wraps the cursor and desyncs the inline
	// renderer, making the map panel / token meter ghost & duplicate on resize. They must always
	// stay at least one column short of m.width — even with an over-long module name.
	m, _ := newTestModel()
	m.width = 80
	m.graph = GraphSummary{
		NodeCount: 1234, FileCount: 56, AIGraphBuilt: false,
		Modules: []GraphModule{{Name: "some/absurdly/long/module/path/that/would/overflow/the/box/edge", Criticality: "high"}},
	}
	m.fLite = "stepfun-ai/step-3.5-flash"
	m.ctxBaseline, m.ctxWindow = 2000, 100000

	for name, view := range map[string]string{"map": m.mapPanelView(), "meter": m.tokenMeterView()} {
		for _, ln := range strings.Split(view, "\n") {
			if w := lipgloss.Width(ln); w >= m.width {
				t.Errorf("%s line is full-width (%d >= %d) — will ghost on resize: %q", name, w, m.width, stripANSI(ln))
			}
		}
	}
}

// Alt-screen: a COMPACT one-line map is pinned above the prompt (P2 — it used to be hidden because a
// tall pinned panel multiplied under the inline renderer). The full multi-line panel is still shown
// on demand via /map, committed into the transcript.
func TestCompactMapPinnedAndFullViaCommand(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 80, 40
	m.graph = GraphSummary{NodeCount: 12, FileCount: 3, Modules: []GraphModule{{Name: "core", Criticality: "high"}}}

	v := stripANSI(m.View())
	if !strings.Contains(v, "Map") || !strings.Contains(v, "12 nodes") {
		t.Fatalf("compact map should be pinned above the prompt, got:\n%s", v)
	}
	// The compact line is one row — the full multi-line "Codebase Map" panel only appears via /map.
	if strings.Contains(v, "Codebase Map") {
		t.Fatal("the full multi-line panel must NOT be pinned — only the compact one-liner")
	}

	m.input.SetValue("/map")
	res, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = res.(model)
	if !m.showFullMap {
		t.Fatal("/map should toggle showFullMap to true")
	}
	v = stripANSI(m.View())
	if !strings.Contains(v, "Codebase Map") {
		t.Fatalf("/map should show the full map panel, got:\n%s", v)
	}
}

func TestMapViaAutocomplete(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 80, 40
	m.graph = GraphSummary{NodeCount: 12, FileCount: 3, Modules: []GraphModule{{Name: "core", Criticality: "high"}}}

	m.input.SetValue("/ma")
	m.compOpen = true
	m.comps = []CompletionItem{{Value: "/map", Kind: "command"}}
	m.compIdx = 0

	t.Logf("Before update: input='%s', compOpen=%v, showFullMap=%v", m.input.Value(), m.compOpen, m.showFullMap)
	msg := tea.KeyMsg{Type: tea.KeyEnter}
	t.Logf("msg.String() = %q", msg.String())
	res, _ := m.Update(msg)
	m = res.(model)

	t.Logf("After update, status is '%s', input is '%s', showFullMap is %v\n", m.status, m.input.Value(), m.showFullMap)

	if m.input.Value() != "" {
		t.Fatalf("input should be cleared, got '%s'", m.input.Value())
	}
	if !m.showFullMap {
		t.Fatal("/map should toggle showFullMap to true")
	}
	v := stripANSI(m.View())
	if !strings.Contains(v, "Codebase Map") {
		t.Fatalf("/map should show the full map panel, got:\n%s", v)
	}
}

// P6: a long run of consecutive finished tool calls collapses into category counts in the live
// region; Ctrl+B expands it back to one line per call.
func TestToolCallCollapse(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 80, 40

	fin := func(id, name string) Outbound {
		return ev("tool_call_result", map[string]any{"id": id, "toolName": name, "status": "completed"})
	}
	m.handleEngine(fin("1", "ReadTool"))
	m.handleEngine(fin("2", "ReadTool"))
	m.handleEngine(fin("3", "ReadTool"))
	m.handleEngine(fin("4", "EditTool"))
	m.handleEngine(fin("5", "BashTool"))

	v := stripANSI(m.View())
	if !strings.Contains(v, "5 tool calls") || !strings.Contains(v, "3 reads") || !strings.Contains(v, "1 edits") || !strings.Contains(v, "1 bash") {
		t.Fatalf("expected collapsed category summary, got:\n%s", v)
	}

	// Ctrl+B expands: each tool's own line is now shown (no summary).
	res, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlB})
	m = res.(model)
	if m.collapseTools {
		t.Fatal("Ctrl+B should have toggled collapse off")
	}
	if strings.Contains(stripANSI(m.View()), "5 tool calls") {
		t.Fatal("expanded run must not show the collapsed summary")
	}
}

// Regression: task-list bookkeeping must never be reported as a code "edit". A read-only run that
// updates its todo list once said "1 edits" and looked like it silently changed files.
func TestTodoWriteIsNotAnEdit(t *testing.T) {
	if got := toolCategory("TodoWriteTool"); got == "edits" {
		t.Fatalf("TodoWriteTool must not bucket as an edit, got %q", got)
	}
	if got := toolCategory("EditFileTool"); got != "edits" {
		t.Fatalf("EditFileTool must still bucket as an edit, got %q", got)
	}
	if got := toolCategory("WriteFileTool"); got != "edits" {
		t.Fatalf("WriteFileTool must still bucket as an edit, got %q", got)
	}
}

// A tool occupies ONE fixed slot for its whole lifecycle: the same id arriving as running then as
// a result updates the card in place (never a second entry), and the finished card commits to
// scrollback only when non-tool content lands.
func TestToolFixedSlotLifecycle(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 80, 40

	// Tool starts running.
	m.handleEngine(ev("tool_call", map[string]any{"id": "t1", "toolName": "BashTool", "status": "running", "input": `{"command":"go test"}`}))
	if len(m.turnTools) != 1 || !m.hasRunningTool() {
		t.Fatalf("running tool not tracked: %+v", m.turnTools)
	}
	if strings.Contains(stripANSI(strings.Join(m.lines, "\n")), "Bash") {
		t.Fatal("a running tool must stay live, not commit to scrollback")
	}

	// Same id returns a result — update IN PLACE, still exactly one entry, now finished.
	m.handleEngine(ev("tool_call_result", map[string]any{"id": "t1", "toolName": "BashTool", "status": "success", "input": `{"command":"go test"}`, "output": "ok"}))
	if len(m.turnTools) != 1 {
		t.Fatalf("result created a second entry instead of updating in place: %+v", m.turnTools)
	}
	if m.hasRunningTool() {
		t.Fatal("tool should be finished after its result")
	}

	// Non-tool content (an assistant block) triggers the flush → the finished card lands in scrollback.
	m.handleEngine(ev("message", map[string]any{"role": "assistant", "content": "Tests pass."}))
	committed := stripANSI(strings.Join(m.lines, "\n"))
	if !strings.Contains(committed, "Bash") {
		t.Fatalf("finished tool not committed on flush:\n%s", committed)
	}
	if len(m.turnTools) != 0 {
		t.Fatalf("turnTools should be empty after flush, got %+v", m.turnTools)
	}
}

// The ambient repo-health line surfaces ONLY drives that are off setpoint — with their measurement
// and a sparkline — and stays silent when everything is at setpoint (calm by default).
func TestAmbientHealthLine(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 80, 40

	// All drives healthy → nothing rendered.
	m.fMind.Drives = []MindDrive{{Label: "Build is green", Value: "build passing", Ok: true, Spark: []int{1, 1, 1}}}
	if hl := m.healthLineView(); hl != "" {
		t.Fatalf("health line should be silent when all drives are at setpoint, got: %q", stripANSI(hl))
	}

	// A deviating drive → its measurement surfaces in the line and in the composed View.
	m.fMind.Drives = []MindDrive{
		{Label: "TypeScript clean", Value: "3 type errors", Ok: false, Spark: []int{1, 1, 0, 0}},
		{Label: "Build is green", Value: "build passing", Ok: true, Spark: []int{1, 1, 1}},
	}
	hl := stripANSI(m.healthLineView())
	if !strings.Contains(hl, "3 type errors") {
		t.Fatalf("deviating drive not surfaced: %q", hl)
	}
	if strings.Contains(hl, "build passing") {
		t.Fatalf("healthy drive should not appear in the health line: %q", hl)
	}
	if !strings.Contains(stripANSI(m.View()), "3 type errors") {
		t.Fatalf("health line not pinned into the view")
	}
}

// Multi-repo workspace chip: hidden in single-repo sessions, short names inline when they fit,
// count form when they don't. Fed by ui_snapshot.workspace.
func TestWorkspaceChipInFooter(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 100, 40

	// Single repo (or none): no chip.
	m.fWorkspace = WorkspaceStrip{Count: 1, Names: []string{"Bimax"}, Writable: 1}
	if strings.Contains(stripANSI(m.footerLine()), "⌂") {
		t.Fatalf("workspace chip must be hidden in single-repo sessions: %q", stripANSI(m.footerLine()))
	}

	// Two repos with short names → names inline.
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"workspace": map[string]any{"count": 2, "names": []string{"Bimax", "aider"}, "writable": 1},
	}))
	foot := stripANSI(m.footerLine())
	if !strings.Contains(foot, "⌂ Bimax+aider") {
		t.Fatalf("expected inline repo names in footer, got: %q", foot)
	}

	// Many/long names → count form.
	m.fWorkspace = WorkspaceStrip{Count: 4, Names: []string{"Bimax", "aider", "vestige", "agent-lsp-server"}, Writable: 1}
	foot = stripANSI(m.footerLine())
	if !strings.Contains(foot, "⌂ 4 repos") {
		t.Fatalf("expected count-form workspace chip, got: %q", foot)
	}
}

// A live automated browser page shows as a host-only chip in the footer (◍), fed by the engine's
// ui_snapshot computer posture — a running browser session must never be invisible.
func TestBrowserSessionChipInFooter(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 100, 40

	// No computer posture (older engine) or no live page: no chip.
	if strings.Contains(stripANSI(m.footerLine()), "◍") {
		t.Fatalf("browser chip must be hidden with no live session: %q", stripANSI(m.footerLine()))
	}
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"computer": map[string]any{"browserUrl": "", "desktop": "connected", "tainted": false},
	}))
	if strings.Contains(stripANSI(m.footerLine()), "◍") {
		t.Fatalf("browser chip must be hidden when browserUrl is empty: %q", stripANSI(m.footerLine()))
	}

	// Live page → host-only chip.
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"computer": map[string]any{"browserUrl": "https://app.example.com/checkout?step=2", "desktop": "connected", "tainted": true},
	}))
	foot := stripANSI(m.footerLine())
	if !strings.Contains(foot, "◍ app.example.com") {
		t.Fatalf("expected host-only browser chip, got: %q", foot)
	}
	if strings.Contains(foot, "checkout") {
		t.Fatalf("chip must not leak the URL path: %q", foot)
	}
}

// The working indicator names which slot is handling the turn in the product's one vocabulary —
// "quick" or "work" — so routing is visible live, not just in the footer pointer.
func TestTierTagVisibleWhileWorking(t *testing.T) {
	m, _ := newTestModel()
	m.busy = true

	m.fTier = "lite"
	if !strings.Contains(stripANSI(m.thinkingView()), "· quick") {
		t.Fatalf("quick routing should show '· quick':\n%s", stripANSI(m.thinkingView()))
	}
	m.fTier = "heavy"
	if !strings.Contains(stripANSI(m.workingView()), "· work") {
		t.Fatalf("work routing should show '· work':\n%s", stripANSI(m.workingView()))
	}
}

func TestCompletionDebounce(t *testing.T) {
	m, buf := newTestModel()
	m.input.SetValue("/he")
	if cmd := m.requestCompletions(); cmd == nil {
		t.Fatal("non-empty input should schedule a debounce cmd")
	}
	cur := m.compSeq

	// A stale tick (superseded by a newer keystroke) must NOT query the engine.
	m.Update(compTickMsg{seq: cur - 1, text: "/h"})
	if strings.Contains(buf.String(), `"t":"query"`) {
		t.Fatalf("stale debounce tick queried the engine; wire = %q", buf.String())
	}

	// The current tick fires exactly one query.
	m.Update(compTickMsg{seq: cur, text: "/he"})
	if !strings.Contains(buf.String(), `"t":"query"`) {
		t.Fatalf("current debounce tick did not query; wire = %q", buf.String())
	}
}

func TestTodoUpdatePinsPanel(t *testing.T) {
	m, _ := newTestModel()

	todos := []map[string]any{
		{"content": "write parser", "status": "completed"},
		{"content": "wire the loop", "status": "in_progress"},
		{"content": "add tests", "status": "pending"},
	}
	m.handleEngine(ev("todo_update", todos))

	// The list is pinned above the prompt (not appended into scrollback) while work is unfinished.
	if strings.Contains(strings.Join(m.lines, "\n"), "write parser") {
		t.Fatalf("todos leaked into the transcript scrollback")
	}
	panel := m.activeTodoPanel()
	for _, want := range []string{"Tasks (1/3)", "write parser", "wire the loop", "add tests"} {
		if !strings.Contains(panel, want) {
			t.Errorf("pinned todo panel missing %q in:\n%s", want, panel)
		}
	}

	// Once every task is completed, the panel disappears rather than lingering above the prompt.
	allDone := []map[string]any{
		{"content": "write parser", "status": "completed"},
		{"content": "wire the loop", "status": "completed"},
		{"content": "add tests", "status": "completed"},
	}
	m.handleEngine(ev("todo_update", allDone))
	if p := m.activeTodoPanel(); p != "" {
		t.Fatalf("completed task list should not pin, got:\n%s", p)
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

func TestLoopDetectedErrorThrashingLabel(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("loop_detected", map[string]any{
		"type": "error_thrashing", "tool": "EditFileTool", "count": 4, "severity": "hard",
	}))
	joined := strings.Join(m.lines, "\n")
	// An error spiral must read as failures, not a generic "loop detected", and still carry the
	// tool name + ×count so the user knows exactly what stalled.
	if !strings.Contains(joined, "repeated failures") || !strings.Contains(joined, "EditFileTool") || !strings.Contains(joined, "×4") {
		t.Fatalf("error_thrashing not rendered as expected:\n%s", joined)
	}
	if strings.Contains(joined, "loop detected") {
		t.Fatalf("error_thrashing should not use the generic 'loop detected' label:\n%s", joined)
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

func TestProgressiveBlockCommit(t *testing.T) {
	m, _ := newTestModel()
	// A closed paragraph (terminated by a blank line) commits to scrollback mid-stream; the trailing
	// open paragraph stays live in m.stream, not yet in the transcript.
	m.handleEngine(ev("stream_token", "First para.\n\nSecond "))
	committed := stripANSI(strings.Join(m.lines, "\n"))
	if !strings.Contains(committed, "First para.") {
		t.Fatalf("closed block not committed mid-stream:\n%s", committed)
	}
	if strings.Contains(committed, "Second") {
		t.Fatalf("open block leaked into transcript early:\n%s", committed)
	}
	// The open remainder is still what View renders live.
	if open := m.stream[m.streamCommitted:]; !strings.Contains(open, "Second") {
		t.Fatalf("open tail lost: %q", open)
	}
	// Finalize: the trailing block commits, nothing duplicates.
	m.handleEngine(ev("message", map[string]any{"role": "assistant", "content": "First para.\n\nSecond para."}))
	final := stripANSI(strings.Join(m.lines, "\n"))
	if strings.Count(final, "First para.") != 1 {
		t.Fatalf("first block duplicated on finalize:\n%s", final)
	}
	if !strings.Contains(final, "Second para.") {
		t.Fatalf("trailing block not committed on finalize:\n%s", final)
	}
}

func TestUnclosedFenceStaysLive(t *testing.T) {
	m, _ := newTestModel()
	// An open code fence must NOT commit until its closing ``` arrives, even across blank lines
	// inside the block — otherwise a half-streamed code block would render broken then snap.
	m.handleEngine(ev("stream_token", "```go\nfunc main() {\n\n\tx := 1\n"))
	committed := stripANSI(strings.Join(m.lines, "\n"))
	if strings.Contains(committed, "func main") {
		t.Fatalf("unclosed fence committed early:\n%s", committed)
	}
	// Close the fence + a terminating blank line → the whole code block commits as one unit.
	m.handleEngine(ev("stream_token", "}\n```\n\n"))
	committed = stripANSI(strings.Join(m.lines, "\n"))
	if !strings.Contains(committed, "func main") || !strings.Contains(committed, "x := 1") {
		t.Fatalf("closed fence not committed whole:\n%s", committed)
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

func TestRenderDiffHighlightsAndAligns(t *testing.T) {
	// A Go diff with a line number past 9999 — the gutter must widen (was a fixed %4d).
	diff := "@@ -1,1 +10000,1 @@\n-x := 1\n+const y = 2\n"
	const fill = 60
	out := renderDiff(diff, 20, fill, "main.go")
	if !strings.Contains(out, "10000") {
		t.Fatalf("dynamic gutter dropped the 5-digit line number:\n%s", out)
	}
	// THE invariant that kills the bleed: no diff line may exceed the fill width. Changed lines carry
	// a full-width background, so any overflow would wrap and the colour would bleed back to column 0.
	// renderDiff pads to exactly fillWidth and hard-clamps with an ANSI-aware truncate, so this holds
	// for every row regardless of content/width.
	for _, l := range strings.Split(out, "\n") {
		if w := lipgloss.Width(l); w > fill {
			t.Fatalf("diff line width %d exceeds fill %d (will wrap → bleed): %q", w, fill, l)
		}
	}
	// Sign prefixes + content survive (colour escapes are stripped in this non-TTY test, so we assert
	// on structure, not ANSI). Diff code is solid green/red (git-style) — no per-token syntax colours.
	plain := stripANSI(out)
	if !strings.Contains(plain, "+ const y = 2") || !strings.Contains(plain, "- x := 1") {
		t.Fatalf("diff lost its +/- sign prefixes or content:\n%s", plain)
	}
}

// A changed line far longer than the fill width must be clamped, never emitted at full length — that
// overflow is exactly what wrapped and bled the background back to column 0.
func TestRenderDiffClampsLongLines(t *testing.T) {
	long := strings.Repeat("x = veryLongIdentifier + ", 20) // ~500 cols, well over the fill
	diff := "@@ -1,1 +1,1 @@\n+" + long + "\n"
	const fill = 50
	out := renderDiff(diff, 20, fill, "main.go")
	for _, l := range strings.Split(out, "\n") {
		if w := lipgloss.Width(l); w > fill {
			t.Fatalf("long diff line not clamped: width %d > fill %d", w, fill)
		}
	}
}

// Every changed (add/remove) diff line must render to the SAME width regardless of content length —
// a short comment line and a long code line both fill their green/red background to the fill width.
// (User report: the comment's coloured line looked shorter than the code's.)
func TestRenderDiffChangedLinesEqualWidth(t *testing.T) {
	diff := "@@ -1,2 +1,2 @@\n+// short comment\n+const reallyLongVariableNameHere = computeSomething(a, b, c)\n"
	const fill = 60
	out := renderDiff(diff, 20, fill, "main.go")
	var widths []int
	for _, l := range strings.Split(out, "\n") {
		widths = append(widths, lipgloss.Width(l))
	}
	if len(widths) != 2 {
		t.Fatalf("expected 2 changed lines, got %d", len(widths))
	}
	if widths[0] != widths[1] {
		t.Fatalf("changed diff lines differ in width: comment=%d code=%d (bg fill must be uniform)", widths[0], widths[1])
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
	if strings.Contains(stripANSI(m.menuView()), "Type to search") {
		t.Fatal("small menus should not spend a row on an idle search prompt")
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

func TestLargeMenuKeepsSearchPrompt(t *testing.T) {
	m, _ := newTestModel()
	m.menuTitle = "Many choices"
	for i := 0; i < menuMaxVisible+1; i++ {
		m.menuOpts = append(m.menuOpts, menuOption{Label: fmt.Sprintf("Option %d", i), Value: fmt.Sprint(i)})
	}
	if !strings.Contains(stripANSI(m.menuView()), "Type to search") {
		t.Fatal("large menus should advertise search")
	}
}

func TestConsecutiveDuplicateSystemMessageRendersOnce(t *testing.T) {
	m, _ := newTestModel()
	msg := MessageEntry{Role: "system", Content: "Vision model → vision/model"}
	m.renderMessage(msg)
	m.renderMessage(msg)
	joined := strings.Join(m.lines, "\n")
	if strings.Count(stripANSI(joined), msg.Content) != 1 {
		t.Fatalf("duplicate system message was rendered: %q", joined)
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
	// Before the first token the live region shows the rotating ThinkingText (● phrase).
	if !strings.Contains(stripANSI(m.View()), "●") {
		t.Fatalf("thinking indicator not shown while busy:\n%s", stripANSI(m.View()))
	}
	// Once tokens stream, the WorkingIndicator's braille spinner frame appears.
	m.handleEngine(ev("stream_token", "hello"))
	if frame := strings.TrimSpace(m.spin.View()); frame != "" && !strings.Contains(m.View(), frame) {
		t.Fatalf("spinner frame %q not in view while streaming", frame)
	}
}

// Inline mode (native scrollbar): committed transcript lines are QUEUED for the terminal's native
// scrollback (flushed via tea.Println), NOT rendered in the live View. The live View shows only
// in-flight content (the streaming answer) plus chrome (input/footer/menus).
func TestInlineCommitsToScrollback(t *testing.T) {
	m, _ := newTestModel()
	m.height = 40

	m.append("❯ hi")
	m.append("Hey! What's on your mind today?")

	if len(m.printQueue) != 2 {
		t.Fatalf("expected 2 lines queued for scrollback, got %d", len(m.printQueue))
	}
	if strings.Contains(stripANSI(m.View()), "What's on your mind") {
		t.Fatalf("committed transcript must NOT be in the live View — it belongs in native scrollback")
	}
	// An in-flight streamed answer DOES render live.
	m.stream = "thinking out loud"
	if !strings.Contains(stripANSI(m.View()), "thinking out loud") {
		t.Fatalf("live stream should render in the View")
	}
}

// The live region (View) must never exceed the terminal height, or the inline renderer pushes its top
// into scrollback every frame (the "footer multiplies itself" bug). Committed lines go to scrollback,
// so even a huge transcript leaves the live region bounded.
func TestLiveRegionFitsHeight(t *testing.T) {
	m, _ := newTestModel()
	m.width, m.height = 80, 24
	for i := 0; i < 200; i++ {
		m.append("line " + string(rune('a'+i%26)))
	}
	m.busy = true
	rows := strings.Count(m.View(), "\n") + 1
	if rows > m.height {
		t.Fatalf("live region overflows terminal height: %d rows > %d", rows, m.height)
	}
}

// No View line may reach the LAST column. A line == width trips the terminal's auto-wrap (cursor
// slides to the next row) and a line > width wraps — either desyncs Bubble Tea's inline clear and the
// live region stacks/multiplies every update. The invariant is therefore width ≤ m.width-1 for every
// line. Exercised with a long stream AND the full footer/meter/map chrome present.
// No live-region line may reach the LAST column. A line == width trips the terminal's auto-wrap (cursor
// slides to the next row) and a line > width wraps — either desyncs Bubble Tea's inline clear and the
// live region stacks/multiplies (or leaves a mirror box) every update. Invariant: width ≤ m.width-1.
func TestViewLinesStayInsideLastColumn(t *testing.T) {
	// Exercise the FULL live region — pinned map, pinned todo, busy indicator, input box, footer — at
	// several widths (incl. the exact zoom widths from the bug report). EVERY line must be ≤ width-1,
	// or a full-width line wraps and the whole region multiplies on the next tea.Println / zoom.
	for _, w := range []int{40, 80, 100, 120, 158} {
		m, _ := newTestModel()
		m.width, m.height = w, 30
		m.busy = true
		m.handleEngine(ev("model_tier", map[string]any{"tier": "heavy", "pinned": "heavy"})) // footer + 📌
		m.handleEngine(ev("ui_snapshot", map[string]any{
			"models": map[string]string{"coding": "stepfun-ai/step-3.7-flash", "lite": "stepfun-ai/step-3.7-flash"},
			"graph":  map[string]any{"nodeCount": 1384, "fileCount": 33, "modules": []map[string]any{{"name": "IncrementalParser", "criticality": "HIGH"}, {"name": "KnowledgeGraph", "criticality": "HIGH"}, {"name": "CSTLowering", "criticality": "MEDIUM"}}},
		}))
		m.handleEngine(ev("todo_update", []map[string]any{{"content": "wire the loop", "status": "in_progress"}}))
		m.stream = strings.Repeat("verylongtoken ", 30) // far wider than the terminal
		for _, l := range strings.Split(m.View(), "\n") {
			if lw := lipgloss.Width(l); lw > m.width-1 {
				t.Fatalf("width=%d: View line reaches/exceeds last column (auto-wrap → multiply/mirror): lineWidth=%d max=%d %q", w, lw, m.width-1, l)
			}
		}
	}
}

// The footer specifically must stay inside the last column — it was full-width and the prime cause of
// the multiplying live region.
func TestFooterStaysInsideLastColumn(t *testing.T) {
	m, _ := newTestModel()
	m.width = 80
	m.handleEngine(ev("model_tier", map[string]any{"tier": "lite"}))
	if w := lipgloss.Width(m.footerLine()); w > m.width-1 {
		t.Fatalf("footer reaches last column (auto-wrap → multiply): width=%d max=%d", w, m.width-1)
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
	out := renderMarkdown("# Title\n\n- one\n- two\n\n`code`")
	if out == "" || !strings.Contains(out, "one") || !strings.Contains(out, "two") {
		t.Fatalf("markdown not rendered: %q", out)
	}
	// Markdown was processed, not passed through verbatim: glamour turns "- " bullets into "•"
	// (and applies ANSI styling on a real terminal; color is suppressed in this non-TTY test).
	if !strings.Contains(out, "•") {
		t.Fatalf("markdown not transformed (no bullet glyph): %q", out)
	}
	// A fenced code block renders (syntax-highlighted on a real TTY; here we just confirm the code
	// survives and the styled-background config doesn't error the renderer).
	code := renderMarkdown("```go\nfunc main() {}\n```")
	if !strings.Contains(stripANSI(code), "func main()") {
		t.Fatalf("code block not rendered: %q", code)
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
	out := stripANSI(renderToolCall(tc, 80))
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

func TestMapPanelShowsCodebaseMemoryBadge(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("ui_snapshot", map[string]any{
		"models": map[string]string{"coding": "x/m"},
		"graph": map[string]any{
			"nodeCount": 0, "fileCount": 0, "engine": "codebase-memory",
		},
	}))
	// Full panel badges the engine even with an empty native graph.
	panel := stripANSI(m.mapPanelView())
	if !strings.Contains(panel, "codebase-memory") {
		t.Fatalf("map panel missing codebase-memory badge: %q", panel)
	}
	// Compact line surfaces it too (native NodeCount is 0).
	compact := stripANSI(m.compactMapView())
	if !strings.Contains(compact, "codebase-memory") {
		t.Fatalf("compact map missing codebase-memory badge: %q", compact)
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
	if !strings.Contains(joined, "help") || strings.Contains(joined, "/help") || !strings.Contains(joined, "Show help") {
		t.Fatalf("help dashboard not rendered: %q", joined)
	}
}

func TestHeadroomReportDashboardRenders(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("message", map[string]any{
		"role": "system", "uiComponent": "StatsDashboard",
		"payload": map[string]any{
			"type": "stats", "title": "Headroom savings",
			"items": []map[string]string{
				{"label": "Tokens saved (session)", "value": "5,852 tok"},
				{"label": "anthropic/claude-opus-4-8", "value": "4,272 tok saved · 1 pass(es)"},
			},
		},
	}))
	joined := stripANSI(strings.Join(m.lines, "\n"))
	if !strings.Contains(joined, "5,852 tok") || !strings.Contains(joined, "claude-opus-4-8") {
		t.Fatalf("headroom report not rendered: %q", joined)
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

// TestTranscriptBounded guards the in-app transcript buffer: append() keeps m.lines (the source fed
// into the scroll viewport, also searched by Ctrl+F) bounded on very long sessions.
func TestTranscriptBounded(t *testing.T) {
	m, _ := newTestModel()

	for i := 0; i < transcriptCap+300; i++ {
		m.append("x")
	}

	if len(m.lines) > transcriptCap {
		t.Fatalf("in-memory search copy exceeded cap: %d > %d", len(m.lines), transcriptCap)
	}
}

// A committed diff row is pre-laid-out and hard-clamped (line-number gutter + green/red background
// padded to a fixed width). indentAwareWrap must NOT re-wrap a line that already fits within its
// width budget — doing so spilled the coloured background onto a bogus continuation row at column 0
// (the "green bleeds to the far left after the response commits" bug). It must still wrap genuinely
// over-wide prose.
func TestIndentAwareWrapNoDiffBleed(t *testing.T) {
	long := "Maya found the lighthouse on a map she didn’t remember buying. The coordinates were clear: a tower standing alone on the horizon.—warm and cold at once"
	diff := "@@ -1,0 +1,2 @@\n+The Last Light\n+" + long + "\n\\ No newline at end of file"
	for _, termWidth := range []int{190, 120, 80} {
		for _, indent := range []string{"  ", "    "} {
			diffW := termWidth - len(indent) - 4 - 6
			rendered := indentLines(renderDiff(diff, 20, diffW, "story.txt"), indent+"    ")
			committed := indentAwareWrap(rendered, termWidth-2)
			if got, want := strings.Count(committed, "\n"), strings.Count(rendered, "\n"); got != want {
				t.Fatalf("diff re-wrapped on commit (bleed) at width=%d indent=%d: rows %d != %d",
					termWidth, len(indent), got+1, want+1)
			}
			for _, ln := range strings.Split(committed, "\n") {
				if w := lipgloss.Width(ln); w > termWidth-2 {
					t.Fatalf("committed line %d wide exceeds budget %d at width=%d", w, termWidth-2, termWidth)
				}
			}
		}
	}
	// Genuinely over-wide prose must still wrap.
	if !strings.Contains(indentAwareWrap("  ● "+strings.Repeat("word ", 80), 80), "\n") {
		t.Fatal("long prose line should still wrap")
	}
}

// Narrowing is the only resize direction that can leave ghost frames (painted rows re-wrap), so it
// is the only one allowed to pay the clear-and-reprint (which costs one duplicated screenful in
// scrollback). Widen / height-only changes must be free.
func TestResizeRepairOnlyOnNarrow(t *testing.T) {
	m, _ := newTestModel()
	m.terminalSized = true
	m.lines = []string{"committed line one", "committed line two"}

	// Widen: no repair scheduled.
	res, _ := m.update(tea.WindowSizeMsg{Width: 120, Height: 40})
	m = res.(model)
	if m.resizeNarrowed {
		t.Fatal("widening must not schedule a ghost repair")
	}
	m.resizeAt = time.Now().Add(-time.Second) // debounce elapsed
	res, _ = m.update(tickMsg(time.Now()))
	m = res.(model)
	if m.pendingClear || len(m.printQueue) != 0 {
		t.Fatalf("widen settle must not clear/reprint (pendingClear=%v queue=%d)", m.pendingClear, len(m.printQueue))
	}

	// Narrow: repair scheduled and fires on settle.
	res, _ = m.update(tea.WindowSizeMsg{Width: 60, Height: 40})
	m = res.(model)
	if !m.resizeNarrowed {
		t.Fatal("narrowing must schedule the ghost repair")
	}
	m.resizeAt = time.Now().Add(-time.Second)
	res, _ = m.update(tickMsg(time.Now()))
	m = res.(model)
	if !m.pendingClear || len(m.printQueue) == 0 {
		t.Fatalf("narrow settle must clear + reprint the last screenful (pendingClear=%v queue=%d)", m.pendingClear, len(m.printQueue))
	}
}

// Once an interrupt is sent, every working indicator must read "Stopping…" (not keep animating
// "Thinking…", which read as the Esc being ignored), and the state must resolve when the turn ends.
func TestInterruptShowsStoppingUntilIdle(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("spinner_state", "thinking", "Thinking…"))

	res, _ := m.update(tea.KeyMsg{Type: tea.KeyEsc})
	m = res.(model)
	if !m.interrupting {
		t.Fatal("esc while busy must set interrupting")
	}
	for name, view := range map[string]string{
		"thinkingView": m.thinkingView(),
		"workingView":  m.workingView(),
		"toolingView":  m.toolingView(),
	} {
		if !strings.Contains(stripANSI(view), "Stopping…") {
			t.Fatalf("%s must show Stopping… while interrupting; got %q", name, stripANSI(view))
		}
		if strings.Contains(stripANSI(view), "esc to stop") {
			t.Fatalf("%s must drop the esc hint while interrupting", name)
		}
	}

	m.handleEngine(ev("spinner_state", "idle", "Ready"))
	if m.interrupting {
		t.Fatal("interrupting must clear when the turn ends")
	}
}

// /exit and /quit are handled Go-side and quit immediately — they must never be forwarded to the
// engine (which has no such command and used to swallow them silently).
func TestSlashExitQuitsLocally(t *testing.T) {
	for _, cmdText := range []string{"/exit", "/quit"} {
		m, buf := newTestModel()
		m.input.SetValue(cmdText)
		_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
		if cmd == nil {
			t.Fatalf("%s must quit (non-nil cmd)", cmdText)
		}
		if strings.Contains(buf.String(), `"t":"input"`) {
			t.Fatalf("%s must not be forwarded to the engine; wire=%q", cmdText, buf.String())
		}
	}
}

// §10: the provenance line must always name every field — falling back to "unknown", never
// omitting or inventing. (Release builds stamp via ldflags; dev builds read Go's embedded VCS.)
func TestVersionStringProvenance(t *testing.T) {
	s := versionString()
	for _, want := range []string{"bimax ", "commit:", "built:", "channel:"} {
		if !strings.Contains(s, want) {
			t.Errorf("versionString missing %q in:\n%s", want, s)
		}
	}
}
