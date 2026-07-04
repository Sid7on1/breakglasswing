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

func TestParseDiffRowsCount(t *testing.T) {
	if n := len(parseDiffRows(buildDiff(7))); n != 7 {
		t.Fatalf("expected 7 rows, got %d", n)
	}
	if n := len(parseDiffRows("")); n != 1 { // a single empty line still renders one blank row
		t.Fatalf("expected 1 row for empty diff, got %d", n)
	}
}
