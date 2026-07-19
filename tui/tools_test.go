package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
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

func TestComputerSummaryUsesSemanticResultInsteadOfJSONLineCount(t *testing.T) {
	tc := ToolCall{
		ToolName: "ComputerTool",
		Output:   "{\n  \"ok\": true,\n  \"summary\": \"observed Settings: 60 indexed UI elements + screenshot\",\n  \"elements\": [\n    {}\n  ]\n}",
	}

	got := summarizeToolOutput(tc)
	if got != "observed Settings: 60 indexed UI elements + screenshot" {
		t.Fatalf("summarizeToolOutput() = %q", got)
	}
	if strings.Contains(got, "lines") {
		t.Fatalf("computer summary leaked JSON line count: %q", got)
	}
}

func writeTestScreenshot(t *testing.T, name string, w, h int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 30), G: uint8(y * 30), B: 120, A: 255})
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	_ = f.Close()
	return path
}

// The default transcript must NOT contain inline pixel spam. A see→act loop captures a screen on
// every action; rendering each as half-block pixels is the "[Image #1]" spam we removed. Instead a
// clean one-line card names the exact file (with dimensions) so it stays inspectable.
func TestComputerScreenshotRendersCompactCardNotPixelSpam(t *testing.T) {
	t.Setenv("BIMAX_COMPUTER_THUMBS", "")
	path := writeTestScreenshot(t, "screen.png", 8, 8)
	tc := ToolCall{
		ToolName: "ComputerTool", Status: "success",
		Output: `{"ok":true,"summary":"visible native cursor click delivered to Notes","screenshot":"` + path + `"}`,
	}
	got := renderToolCall(tc, 80)
	if strings.Contains(got, "▀") {
		t.Fatalf("screenshot pixel spam leaked into the default transcript: %q", got)
	}
	if !strings.Contains(got, "screen.png") || !strings.Contains(got, "8×8") {
		t.Fatalf("compact screenshot card missing dims/name: %q", got)
	}
}

// A screenshot/observe summary already names the file, so the card would be redundant — suppress it.
func TestComputerScreenshotCardSuppressedWhenSummaryNamesFile(t *testing.T) {
	t.Setenv("BIMAX_COMPUTER_THUMBS", "")
	path := writeTestScreenshot(t, "shot.png", 8, 8)
	tc := ToolCall{
		ToolName: "ComputerTool", Status: "success",
		Output: `{"ok":true,"summary":"screenshot of display 1 → shot.png (screen points 8×8)","screenshot":"` + path + `"}`,
	}
	got := renderToolCall(tc, 80)
	if strings.Contains(got, "▣ screen") {
		t.Fatalf("card should be suppressed when summary already names the file: %q", got)
	}
}

// Debug opt-in still renders the inline pixel preview for developers who want it.
func TestComputerScreenshotThumbnailBehindDebugFlag(t *testing.T) {
	t.Setenv("BIMAX_COMPUTER_THUMBS", "1")
	path := writeTestScreenshot(t, "screen.png", 8, 8)
	tc := ToolCall{
		ToolName: "ComputerTool", Status: "success",
		Output: `{"ok":true,"summary":"fresh screen attached","screenshot":"` + path + `"}`,
	}
	got := renderToolCall(tc, 80)
	if !strings.Contains(got, "\x1b[38;2;") || !strings.Contains(got, "▀") {
		t.Fatalf("debug thumbnail not rendered under BIMAX_COMPUTER_THUMBS=1: %q", got)
	}
}

func TestComputerCallsNeverCollapseAwayTheirScreens(t *testing.T) {
	run := make([]ToolCall, 6)
	for i := range run {
		run[i] = ToolCall{ID: string(rune('a' + i)), ToolName: "ComputerTool", Status: "success", Output: `{"summary":"screen"}`}
	}
	rows := formatRun(run, 100, true)
	if len(rows) != len(run) {
		t.Fatalf("computer calls collapsed: got %d rows, want %d", len(rows), len(run))
	}
}
