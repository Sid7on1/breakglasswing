package main

import (
	"strings"
	"testing"
)

func TestEditStatsUsesRenderedDiffForOverwrite(t *testing.T) {
	tc := ToolCall{
		ToolName: "WriteFileTool",
		Input:    `{"path":"~/Desktop/story.txt","content":"new one\n\nnew two\n\nnew three\n"}`,
		Output: "Updated ~/Desktop/story.txt:\n" +
			"@@ -1,3 +1,5 @@\n" +
			"-old one\n" +
			"+new one\n" +
			" \n" +
			"-old two\n" +
			"+new two\n" +
			"+\n" +
			"+new three",
	}

	if got, want := editStats(tc), "Added 4 lines, removed 2 lines"; got != want {
		t.Fatalf("editStats() = %q, want %q", got, want)
	}
}

func TestEditSummaryDoesNotReportProtocolLineCount(t *testing.T) {
	tc := ToolCall{
		ToolName: "WriteFileTool",
		Input:    `{"path":"~/Desktop/story.txt","content":"new"}`,
		Output:   "Updated ~/Desktop/story.txt:\n@@ -1,1 +1,1 @@\n-old\n+new",
	}

	got := summarizeToolOutput(tc)
	if got != "Updated ~/Desktop/story.txt" {
		t.Fatalf("summarizeToolOutput() = %q", got)
	}
	if strings.Contains(got, "lines") {
		t.Fatalf("summary leaked protocol output line count: %q", got)
	}
}

// A mismatched engine may still send a Desktop-only tool frame. Terminal must give it no special
// screenshot UI or non-collapsing behavior; it is merely an unknown additive tool frame.
func TestDesktopToolPayloadGetsNoTerminalSpecificPresentation(t *testing.T) {
	tc := ToolCall{
		ToolName: "ExternalActionTool",
		Status:   "success",
		Output:   `{"ok":true,"summary":"fresh screen attached","screenshot":"/tmp/desktop-only.png"}`,
	}
	got := renderToolCall(tc, 80)
	for _, forbidden := range []string{"▣", "▀"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("Desktop-only presentation %q leaked into Terminal: %q", forbidden, got)
		}
	}
	if !strings.Contains(got, `{"ok":true`) {
		t.Fatalf("unknown tool frame should use the generic raw summary: %q", got)
	}
}

func TestDesktopOnlyToolFramesFollowGenericCollapsePolicy(t *testing.T) {
	run := make([]ToolCall, 6)
	for i := range run {
		run[i] = ToolCall{ID: string(rune('a' + i)), ToolName: "ExternalActionTool", Status: "success", Output: `{"summary":"state"}`}
	}
	rows := formatRun(run, 100, true)
	if len(rows) != 1 {
		t.Fatalf("Desktop-only tool frames bypassed generic collapse: got %d rows, want 1", len(rows))
	}
}
