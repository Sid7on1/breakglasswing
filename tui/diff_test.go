package main

import (
	"fmt"
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
	if rows[0].oldNum != 0 || rows[0].newNum != 1 || rows[0].text != "The House at the End of Stillwater Lane" {
		t.Fatalf("first row should be the real first line at num 1, got %+v", rows[0])
	}
	if out := ansi.Strip(renderDiff(diff, 20, 80, "")); strings.Contains(out, "No newline") {
		t.Fatalf("rendered diff must not contain the marker:\n%s", out)
	}
}

// Parity guard for the two wrap paths that a diff card passes through: the LIVE region wrap
// (ansi.Hardwrap at width-1, in View) and the COMMIT wrap (indentAwareWrap at width-2, in
// Update). A diff row is pre-laid-out and hard-clamped to fill its width; NEITHER path may
// re-wrap it onto a continuation row, or its coloured background spills to column 0. This
// asserts both paths leave a rendered, indented diff block's row count unchanged.
func TestWrapPathParityNoBleed(t *testing.T) {
	long := "Elena Marquez found the lighthouse on a map she didn’t remember buying—the ink faded, the coordinates clear: a tower standing alone on the far horizon at dusk."
	diff := "@@ -1,0 +1,2 @@\n+The Cartographer of Lost Things\n+" + long + "\n\\ No newline at end of file"
	for _, w := range []int{190, 140, 100, 80, 64} {
		indent := "  "
		diffW := w - len(indent) - 4 - 6
		block := indentLines(renderDiff(diff, 40, diffW, "story.txt"), indent+"    ")
		rows := strings.Count(block, "\n")
		// LIVE path: ansi.Hardwrap at width-1 over the whole region.
		if got := strings.Count(ansi.Hardwrap(block, w-1, true), "\n"); got != rows {
			t.Fatalf("LIVE wrap added rows at width=%d: %d != %d", w, got, rows)
		}
		// COMMIT path: indentAwareWrap at width-2 per line.
		if got := strings.Count(indentAwareWrap(block, w-2), "\n"); got != rows {
			t.Fatalf("COMMIT wrap added rows at width=%d: %d != %d", w, got, rows)
		}
	}
}

// A replacement uses one visually stable gutter: red rows name their old-file position, while green
// and context rows name their resulting-file position. There must be no duplicated context gutter
// such as "2 2", and +/- markers must begin in the same column on every changed row.
func TestOverwriteGutterUsesOneStableLineNumberColumn(t *testing.T) {
	diff := "@@ -1,5 +1,5 @@\n Title\n \n-old paragraph one\n+new paragraph one\n \n-old paragraph two\n+new paragraph two"
	rows := parseDiffRows(diff)
	if len(rows) != 7 {
		t.Fatalf("expected 7 rows, got %d: %+v", len(rows), rows)
	}
	if rows[2].sign != '-' || rows[2].oldNum != 3 || rows[2].newNum != 0 {
		t.Fatalf("removed row needs old=3/new=blank, got %+v", rows[2])
	}
	if rows[3].sign != '+' || rows[3].oldNum != 0 || rows[3].newNum != 3 {
		t.Fatalf("added row needs old=blank/new=3, got %+v", rows[3])
	}

	out := ansi.Strip(renderDiff(diff, 40, 100, "story.txt"))
	var removed, added string
	for _, ln := range strings.Split(out, "\n") {
		if strings.Contains(ln, "- old paragraph one") {
			removed = ln
		}
		if strings.Contains(ln, "+ new paragraph one") {
			added = ln
		}
	}
	if removed == "" || !strings.Contains(strings.Split(removed, "-")[0], "3") {
		t.Fatalf("rendered removal has no old line number:\n%s", out)
	}
	if added == "" || !strings.Contains(strings.Split(added, "+")[0], "3") {
		t.Fatalf("rendered addition has no new line number:\n%s", out)
	}
	if strings.Contains(out, "1 1") || strings.Contains(out, "2 2") {
		t.Fatalf("rendered context duplicated old/new line numbers:\n%s", out)
	}
	if strings.Index(removed, "-") != strings.Index(added, "+") {
		t.Fatalf("replacement markers do not share one stable column:\nremoved=%q\nadded=%q", removed, added)
	}
}

// Regression fixture matching a long prose replacement: alternating removals/additions plus context
// must stay visually aligned even when line numbers grow from one to two digits.
func TestLongOverwriteKeepsGutterAligned(t *testing.T) {
	diff := "@@ -1,7 +1,14 @@\n" +
		"-old title\n+new title\n \n-old paragraph one\n+new line one\n+new line two\n+new line three\n \n-old paragraph two\n+new line four\n+new line five\n+new line six\n \n-old ending\n+new line seven\n+new line eight\n+new line nine"
	out := ansi.Strip(renderDiff(diff, 40, 120, "story.txt"))
	markerCol := -1
	for _, ln := range strings.Split(out, "\n") {
		idx := strings.IndexAny(ln, "+-")
		if idx < 0 {
			continue
		}
		if markerCol < 0 {
			markerCol = idx
		} else if idx != markerCol {
			t.Fatalf("diff marker shifted columns (%d != %d):\n%s", idx, markerCol, out)
		}
	}
	if markerCol < 0 {
		t.Fatalf("fixture rendered no changed rows:\n%s", out)
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
