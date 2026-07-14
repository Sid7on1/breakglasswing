package main

import (
	"strings"
	"testing"
)

// The live sub-agent panel: tagged tool calls nest under their agent (not the parent's flat run), the
// collapsed row tracks the agent's latest tool action, and an expanded card shows PROMPT/TOOLS/OUTPUT.
func TestSubAgentPanelLiveAndExpand(t *testing.T) {
	m, _ := newTestModel()

	board := []map[string]any{
		{"taskId": "t1", "agentType": "Explore", "scope": "src/core", "prompt": "Explore core TS subagent/protocol code", "status": "running", "toolCalls": 0, "startedAt": 1},
		{"taskId": "t2", "agentType": "Explore", "scope": "tui", "prompt": "Explore TUI Go code", "status": "running", "toolCalls": 0, "startedAt": 2},
	}
	m.handleEngine(ev("subagent_update", board))

	// A running Read tagged to t2 → its card should read the live "Reading main.go tui/" action.
	m.handleEngine(ev("tool_call", map[string]any{
		"id": "c1", "toolName": "ReadFileTool", "status": "running",
		"input": `{"filePath":"tui/main.go"}`, "parentId": "t2", "agentLabel": "Explore",
	}))

	// Sub-agent tool calls nest under the agent, never in the parent's flat run / scrollback.
	if len(m.turnTools) != 0 {
		t.Fatalf("sub-agent tool leaked into turnTools: %+v", m.turnTools)
	}
	if got := len(m.subAgentTools["t2"]); got != 1 {
		t.Fatalf("expected 1 nested tool under t2, got %d", got)
	}

	panel := stripANSI(m.subAgentPanel())
	for _, want := range []string{"Sub-agents (2 running/2)", "SubAgent", "Explore", "Reading main.go tui/", "Explore core TS"} {
		if !strings.Contains(panel, want) {
			t.Errorf("collapsed panel missing %q in:\n%s", want, panel)
		}
	}

	// Expand t1: finish a tool + mark it done with a result → card shows PROMPT/TOOLS/OUTPUT + ✓ badge.
	m.saFocus = true
	m.saSel = 0
	m.saExpanded["t1"] = true
	m.handleEngine(ev("tool_call", map[string]any{
		"id": "c2", "toolName": "GrepTool", "status": "success",
		"input": `{"pattern":"blackboard"}`, "parentId": "t1", "agentLabel": "Explore",
	}))
	board[0]["status"] = "done"
	board[0]["result"] = "Found the blackboard pattern in subagent.manager.ts."
	board[0]["toolCalls"] = 1
	m.handleEngine(ev("subagent_update", board))

	exp := stripANSI(m.subAgentPanel())
	for _, want := range []string{"PROMPT", "Explore core TS", "TOOLS", "Searching blackboard", "OUTPUT", "Found the blackboard pattern", "done"} {
		if !strings.Contains(exp, want) {
			t.Errorf("expanded card missing %q in:\n%s", want, exp)
		}
	}
}

// Once every agent has finished and no card is expanded, the live panel retires (the agents' final
// results already reached scrollback via the spawn tool).
func TestSubAgentPanelRetiresWhenIdle(t *testing.T) {
	m, _ := newTestModel()
	board := []map[string]any{
		{"taskId": "t1", "agentType": "Explore", "prompt": "x", "status": "done", "toolCalls": 0, "startedAt": 1},
	}
	m.handleEngine(ev("subagent_update", board))
	if p := m.subAgentPanel(); p != "" {
		t.Fatalf("panel should retire when all done and none expanded, got:\n%s", p)
	}
}

func TestSubAgentPanelShowsOutcomeAssignmentPhase(t *testing.T) {
	m, _ := newTestModel()
	m.handleEngine(ev("subagent_update", []map[string]any{
		{"taskId": "agent-1", "outcomeTaskId": "api-integration", "agentType": "BiMax", "phase": "testing", "status": "running", "startedAt": 1},
	}))
	panel := stripANSI(m.subAgentPanel())
	for _, want := range []string{"TESTING", "api-integration"} {
		if !strings.Contains(panel, want) {
			t.Errorf("assignment panel missing %q in:\n%s", want, panel)
		}
	}
}

// pathTail renders "base parent/" like the GUI's "main.go tui/", and passes bare names through.
func TestPathTail(t *testing.T) {
	cases := map[string]string{
		"tui/main.go":                  "main.go tui/",
		"src/core/subagent.manager.ts": "subagent.manager.ts core/",
		"main.go":                      "main.go",
		"":                             "",
	}
	for in, want := range cases {
		if got := pathTail(in); got != want {
			t.Errorf("pathTail(%q) = %q, want %q", in, got, want)
		}
	}
}
