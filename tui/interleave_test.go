package main

import (
	"strings"
	"testing"
)

// Text → tool → text must commit to scrollback IN ORDER (Claude-Code interleaving), not with the
// tools jumping above the answer text when the turn ends.
func TestInterleaveTextToolText(t *testing.T) {
	m, _ := newTestModel()
	m.width = 100
	m.handleEngine(ev("spinner_state", "thinking", "Thinking"))
	m.handleEngine(ev("stream_token", "Checking the docs first."))
	m.handleEngine(ev("tool_call", map[string]any{"id": "1", "toolName": "BashTool", "status": "running", "input": `{"command":"ls ~/Desktop"}`}))
	m.handleEngine(ev("tool_call_result", map[string]any{"id": "1", "toolName": "BashTool", "status": "success", "input": `{"command":"ls ~/Desktop"}`, "output": "a.md\nb.md"}))
	m.handleEngine(ev("stream_token", "Found the files, spawning agents."))
	m.handleEngine(ev("message", map[string]any{"role": "assistant", "content": "Checking the docs first.Found the files, spawning agents."}))
	m.handleEngine(ev("spinner_state", "idle", "Ready"))

	joined := strings.Join(m.lines, "\n")
	i1 := strings.Index(joined, "Checking the docs")
	iTool := strings.Index(joined, "ls ~/Desktop")
	i2 := strings.Index(joined, "Found the files")
	if i1 < 0 || iTool < 0 || i2 < 0 {
		t.Fatalf("missing pieces: text1=%d tool=%d text2=%d\n%s", i1, iTool, i2, joined)
	}
	if !(i1 < iTool && iTool < i2) {
		t.Fatalf("order wrong (want text1 < tool < text2): %d < %d < %d\n%s", i1, iTool, i2, joined)
	}
}
