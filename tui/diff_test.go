package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

// buildDiff makes a unified diff with n added lines.
func buildDiff(n int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "@@ -1,0 +1,%d @@\n", n)
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&b, "+line %d\n", i)
	}
	return b.String()
}

func TestRenderDiffAtScrollWindow(t *testing.T) {
	diff := buildDiff(40)

	top := ansi.Strip(renderDiffAt(diff, 0, 16, 80, ""))
	if !strings.Contains(top, "line 1") || strings.Contains(top, "↑") {
		t.Fatalf("top window wrong:\n%s", top)
	}
	if !strings.Contains(top, "↓ 24 more (PgDn)") {
		t.Fatalf("missing below-marker at top:\n%s", top)
	}

	mid := ansi.Strip(renderDiffAt(diff, 10, 16, 80, ""))
	if !strings.Contains(mid, "↑ 10 more (PgUp)") || !strings.Contains(mid, "↓ 14 more (PgDn)") {
		t.Fatalf("mid window markers wrong:\n%s", mid)
	}
	if !strings.Contains(mid, "line 11") || strings.Contains(mid, "line 10\n") {
		t.Fatalf("mid window rows wrong:\n%s", mid)
	}

	// Offsets past the end clamp to the last full window; nothing below, so no ↓ marker.
	bottom := ansi.Strip(renderDiffAt(diff, 999, 16, 80, ""))
	if !strings.Contains(bottom, "line 40") || strings.Contains(bottom, "PgDn") {
		t.Fatalf("bottom clamp wrong:\n%s", bottom)
	}

	// A short diff never shows scroll markers.
	small := ansi.Strip(renderDiffAt(buildDiff(5), 3, 16, 80, ""))
	if strings.Contains(small, "more (") {
		t.Fatalf("short diff should have no markers:\n%s", small)
	}
}

// A brand-new file with no trailing newline makes the `diff` library emit a
// "\ No newline at end of file" marker for the empty OLD side — right after the
// @@ header, before any content. That marker is not a line of the file and must
// never be rendered (it once showed up as row "1" above the real first line).
func TestParseDiffRowsDropsNoNewlineMarker(t *testing.T) {
	diff := "@@ -1,0 +1,2 @@\n" +
		"\\ No newline at end of file\n" +
		"+The House at the End of Stillwater Lane\n" +
		"+It was not a welcoming house.\n" +
		"\\ No newline at end of file"
	rows := parseDiffRows(diff)
	if len(rows) != 2 {
		t.Fatalf("expected 2 content rows, got %d: %+v", len(rows), rows)
	}
	if rows[0].num != 1 || rows[0].text != "The House at the End of Stillwater Lane" {
		t.Fatalf("first row should be the real first line at num 1, got %+v", rows[0])
	}
	if out := ansi.Strip(renderDiff(diff, 20, 80, "")); strings.Contains(out, "No newline") {
		t.Fatalf("rendered diff must not contain the marker:\n%s", out)
	}
}

// An overwrite of unrelated content drifts the old/new line counters apart. Removed lines must NOT
// show a number (they have no position in the new file) — otherwise the single gutter reads
// backwards (1,2,3,3,5,4,4…). Visible numbers must stay monotonic: the new file's real line numbers.
func TestOverwriteGutterStaysMonotonic(t *testing.T) {
	diff := "@@ -1,5 +1,5 @@\n Title\n \n-old paragraph one\n+new paragraph one\n \n-old paragraph two\n+new paragraph two"
	out := ansi.Strip(renderDiff(diff, 40, 100, "story.txt"))
	re := regexp.MustCompile(`^\s*(\d+)\s`)
	last := 0
	for _, ln := range strings.Split(out, "\n") {
		m := re.FindStringSubmatch(ln)
		if m == nil {
			if strings.Contains(ln, "-") { // removed rows carry no gutter number
				continue
			}
			continue
		}
		n, _ := strconv.Atoi(m[1])
		if n < last {
			t.Fatalf("gutter went backwards: %d after %d in %q", n, last, ln)
		}
		last = n
	}
	if last == 0 {
		t.Fatal("expected some numbered rows")
	}
}

func TestParseDiffRowsCount(t *testing.T) {
	if n := len(parseDiffRows(buildDiff(7))); n != 7 {
		t.Fatalf("expected 7 rows, got %d", n)
	}
	if n := len(parseDiffRows("")); n != 1 { // a single empty line still renders one blank row
		t.Fatalf("expected 1 row for empty diff, got %d", n)
	}
}
