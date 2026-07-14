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
