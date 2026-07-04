package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

var hunkRe = regexp.MustCompile(`@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@`)

// diffApprovalRows is the diff window height in the approval overlay; PgUp/PgDn scroll by half.
const diffApprovalRows = 16

type diffRow struct {
	num  int
	sign byte
	text string
}

// parseDiffRows turns a unified diff into displayable rows; `@@` hunk headers are consumed to
// drive line numbers, not shown. Shared by the renderer and the approval overlay's scroll clamp.
func parseDiffRows(diff string) []diffRow {
	var rows []diffRow
	oldLn, newLn := 0, 0
	for _, ln := range strings.Split(strings.TrimRight(diff, "\n"), "\n") {
		if m := hunkRe.FindStringSubmatch(ln); m != nil {
			fmt.Sscanf(m[1], "%d", &oldLn)
			fmt.Sscanf(m[2], "%d", &newLn)
			continue
		}
		if ln == "" {
			rows = append(rows, diffRow{newLn, ' ', ""})
			oldLn++
			newLn++
			continue
		}
		switch ln[0] {
		case '+':
			rows = append(rows, diffRow{newLn, '+', ln[1:]})
			newLn++
		case '-':
			rows = append(rows, diffRow{oldLn, '-', ln[1:]})
			oldLn++
		default:
			rows = append(rows, diffRow{newLn, ' ', strings.TrimPrefix(ln, " ")})
			oldLn++
			newLn++
		}
	}
	return rows
}

// renderDiff renders a unified diff Claude-Code style: a dim line-number gutter, and the WHOLE
// changed line on a coloured background (dark green = added, dark red = removed) with bright text;
// context lines stay dim. Capped to maxLines from the top.
func renderDiff(diff string, maxLines int, fillWidth int, filename string) string {
	return renderDiffAt(diff, 0, maxLines, fillWidth, filename)
}

// renderDiffAt is renderDiff with a scroll offset: it shows maxLines rows starting at `offset`
// (clamped), with ↑/↓ markers when rows exist beyond the window. This is what lets the approval
// overlay actually REVIEW a 200-line diff (PgUp/PgDn) instead of approving the first 16 rows blind.
func renderDiffAt(diff string, offset, maxLines, fillWidth int, filename string) string {
	rows := parseDiffRows(diff)
	if len(rows) == 0 {
		return ""
	}
	if maxOff := len(rows) - maxLines; offset > maxOff {
		offset = maxOff
	}
	if offset < 0 {
		offset = 0
	}
	// Gutter width grows with the largest line number (was a fixed %4d that misaligned past 9999).
	digits := 3
	for _, r := range rows {
		if d := len(fmt.Sprint(r.num)); d > digits {
			digits = d
		}
	}
	gutterCols := digits + 1 // "%*d " — line number + one trailing space
	// Claude-Code-style diffs: changed lines get a full-width green/red BACKGROUND (added/removed),
	// context lines are syntax-highlighted on the default background. The background is the source of
	// the old "red/green bleeds to column 0" bug — a background-styled line that exceeds the terminal
	// auto-wraps and the colour continues at column 0 on the wrapped row. We defeat that two ways:
	//   1. pad each changed line to EXACTLY `fillWidth` so the bg fills the row and no further,
	//   2. hard-clamp every emitted line to `fillWidth` with an ANSI-aware truncate (closes the SGR),
	// so it is mathematically impossible for a diff line to be wider than its budget and wrap. codeW
	// excludes the gutter + the 2-char "+ "/"- " sign prefix.
	clampW := fillWidth
	if clampW <= 0 {
		clampW = 80
	}
	codeW := clampW - gutterCols - 2
	if codeW < 1 {
		codeW = 1
	}
	lexer := lexers.Match(filename) // resolved once for the whole diff

	var b strings.Builder
	if offset > 0 {
		fmt.Fprintf(&b, "%s\n", dimStyle.Render(fmt.Sprintf("  ↑ %d more (PgUp)", offset)))
	}
	shown := 0
	for _, r := range rows[offset:] {
		if shown >= maxLines {
			fmt.Fprintf(&b, "%s\n", dimStyle.Render(fmt.Sprintf("  ↓ %d more (PgDn)", len(rows)-offset-shown)))
			break
		}
		num := fmt.Sprintf("%*d ", digits, r.num)
		txt := r.text
		if rs := []rune(txt); len(rs) > codeW {
			txt = string(rs[:codeW-1]) + "…"
		}
		pad := codeW - len([]rune(txt))
		if pad < 0 {
			pad = 0
		}
		// Gutter line number: bright white + bold on every line type (prominent column, per request).
		// On changed lines it keeps the diff background; on context lines it has none.
		var line string
		switch r.sign {
		case '+':
			line = diffAddLine.Foreground(lipgloss.Color("#FFFFFF")).Bold(true).Render(num) + diffAddLine.Render("+ ") +
				chromaRender(diffAddLine, lexer, txt) + diffAddLine.Render(strings.Repeat(" ", pad))
		case '-':
			line = diffDelLine.Foreground(lipgloss.Color("#FFFFFF")).Bold(true).Render(num) + diffDelLine.Render("- ") +
				chromaRender(diffDelLine, lexer, txt) + diffDelLine.Render(strings.Repeat(" ", pad))
		default:
			// Context: white+bold line number (diffLineNum) + subtle syntax colours (dim fallback), no bg.
			line = diffLineNum.Render(num) + " " + chromaRender(dimStyle, lexer, txt)
		}
		// Belt-and-suspenders: never let a row exceed its width budget, whatever the content.
		fmt.Fprintf(&b, "%s\n", ansi.Truncate(line, clampW, ""))
		shown++
	}
	return strings.TrimRight(b.String(), "\n")
}

// Nord — a calm, muted, low-pink palette for subtle syntax highlighting (keywords steel-blue, not
// the neon pink of monokai/onedark). Used for diff code so it reads as "normal", not rainbow.
var syntaxTheme = styles.Get("nord")

type codeSeg struct {
	color string // "#rrggbb", or "" for the base/default foreground
	text  string
}

// chromaSegs tokenises one line of code into coloured runs. Nil lexer / error → one uncoloured run.
func chromaSegs(lexer chroma.Lexer, code string) []codeSeg {
	if lexer == nil {
		return []codeSeg{{"", code}}
	}
	it, err := lexer.Tokenise(nil, code)
	if err != nil {
		return []codeSeg{{"", code}}
	}
	var out []codeSeg
	for _, t := range it.Tokens() {
		hex := ""
		if c := syntaxTheme.Get(t.Type).Colour; c.IsSet() {
			hex = c.String()
		}
		out = append(out, codeSeg{hex, t.Value})
	}
	return out
}

// chromaRender colours each token with its nord syntax foreground over the given base style. The base
// carries the background (the diff add/remove fill) and the fallback foreground for uncoloured tokens,
// so a changed line keeps its green/red bg and a context line stays dim.
func chromaRender(base lipgloss.Style, lexer chroma.Lexer, code string) string {
	var b strings.Builder
	for _, seg := range chromaSegs(lexer, code) {
		st := base
		if seg.color != "" {
			st = base.Foreground(lipgloss.Color(seg.color))
		}
		b.WriteString(st.Render(seg.text))
	}
	return b.String()
}

// diffPath pulls the edited file path out of a tool-call input so the diff can be syntax-highlighted.
func diffPath(input string) string {
	var p map[string]any
	if json.Unmarshal([]byte(input), &p) == nil {
		for _, k := range []string{"filePath", "file_path", "path"} {
			if v, ok := p[k].(string); ok && v != "" {
				return v
			}
		}
	}
	return ""
}
