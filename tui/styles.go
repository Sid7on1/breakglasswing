package main

import "github.com/charmbracelet/lipgloss"

// Lip Gloss palette for the BiMax TUI — a faithful port of the Ink "dark" theme (src/cli/themes.ts).
// Warm, low-chrome, content-first: a terracotta accent rather than a neon brand bar, muted greys for
// chrome, and restrained semantic colors. Truecolor hex so it matches the Ink build pixel-for-pixel
// on a capable terminal (lipgloss degrades it for 256/16-color terminals automatically).
var (
	// Core Ink "dark" palette (rgb → hex).
	colAccent   = lipgloss.Color("#D77757") // terracotta — BiMax brand (was neon magenta)
	colShimmer  = lipgloss.Color("#F59575") // lighter accent for the logo's middle row
	colText     = lipgloss.Color("#E6E6E6") // bright text
	colInactive = lipgloss.Color("#787878") // secondary text / summaries
	colSubtle   = lipgloss.Color("#787878") // dim chrome (gutters, hints) — Ink subtle is darker but
	//                                          #505050 is invisible on many terminals, so we lift it.
	colDim     = lipgloss.Color("#5A5A5A")
	colUser    = lipgloss.Color("#E6E6E6") // user lines: bright, marked by an accent caret
	colAsst    = lipgloss.Color("#E6E6E6")
	colTool    = lipgloss.Color("#50C850") // success green
	colErr     = lipgloss.Color("#DC3246") // red
	colWarn    = lipgloss.Color("#DCB432") // amber (running / in-progress)
	colOK      = lipgloss.Color("#50C850")
	colInfo    = lipgloss.Color("#5769F7") // blue (info / agent labels)
	colDiffAdd = lipgloss.Color("#69DB7C")
	colDiffDel = lipgloss.Color("#FFA8B4")
	colHunk    = lipgloss.Color("#57C7C7")

	// Welcome banner / wordmark.
	logoStyle   = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	logoMid     = lipgloss.NewStyle().Foreground(colShimmer).Bold(true)
	brandStyle  = lipgloss.NewStyle().Foreground(colText).Bold(true)
	tipStyle    = lipgloss.NewStyle().Foreground(colInactive)
	metaKey     = lipgloss.NewStyle().Foreground(colInactive)
	metaVal     = lipgloss.NewStyle().Foreground(colInactive)
	statusStyle = lipgloss.NewStyle().Foreground(colInactive)

	// User echo is the accent color (terracotta) so a turn's prompt is instantly distinct from the
	// white assistant reply — they were both bright white before and ran together.
	userStyle   = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	caretStyle  = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	asstStyle   = lipgloss.NewStyle().Foreground(colAsst)
	toolStyle   = lipgloss.NewStyle().Foreground(colTool)
	errStyle    = lipgloss.NewStyle().Foreground(colErr)
	okStyle     = lipgloss.NewStyle().Foreground(colOK) // success-level system messages (green, matches tool success)
	warnStyle   = lipgloss.NewStyle().Foreground(colWarn)
	dimStyle    = lipgloss.NewStyle().Foreground(colInactive)
	subtleStyle = lipgloss.NewStyle().Foreground(colSubtle)
	streamStyle = lipgloss.NewStyle().Foreground(colAsst)

	// Tool-call rendering (Ink's ToolCallLine.tsx): ⏺ dot · bold label · dim (args) · ⎿ summary.
	toolDot   = lipgloss.NewStyle().Foreground(colOK)
	toolDotW  = lipgloss.NewStyle().Foreground(colWarn)
	toolDotE  = lipgloss.NewStyle().Foreground(colErr)
	toolLabel = lipgloss.NewStyle().Foreground(colText).Bold(true)
	toolArgs  = lipgloss.NewStyle().Foreground(colInactive)
	toolGut   = lipgloss.NewStyle().Foreground(colSubtle)

	// Low-chrome input box: a quiet rounded border, brightening on nothing fancy — just the accent.
	promptBox = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).BorderForeground(colDim).
			Padding(0, 1)

	requestBox = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).BorderForeground(colErr).
			Padding(0, 1)

	// Footer (mirrors Ink's Footer.tsx): a single dim status line.
	footerBar  = lipgloss.NewStyle().Foreground(colInactive)
	footerVal  = lipgloss.NewStyle().Foreground(colInactive)
	footerTier = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	footerMode = lipgloss.NewStyle().Foreground(colOK).Bold(true)
	footerSep  = lipgloss.NewStyle().Foreground(colSubtle).Render(" · ")

	// Autocomplete dropdown / menu selection — accent text + arrow, no heavy inverse bar.
	compSel = lipgloss.NewStyle().Foreground(colAccent).Bold(true)

	// Diff rendering in the approval overlay.
	diffAdd  = lipgloss.NewStyle().Foreground(colDiffAdd)
	diffDel  = lipgloss.NewStyle().Foreground(colDiffDel)
	diffHunk = lipgloss.NewStyle().Foreground(colHunk)

	// Full-line diff (Claude-Code style): the WHOLE changed line gets a coloured background with
	// bright readable text — dark green for additions, dark red for deletions (not neon; respects the
	// warm theme). Line numbers sit in a dim gutter.
	diffAddLine = lipgloss.NewStyle().Background(lipgloss.Color("#1B4332")).Foreground(lipgloss.Color("#D8F3DC"))
	diffDelLine = lipgloss.NewStyle().Background(lipgloss.Color("#5A1E28")).Foreground(lipgloss.Color("#FFD6DD"))
	diffLineNum = lipgloss.NewStyle().Foreground(colDim)

	// Word-level diff (edit-tool preview): tinted background like Ink's diffWordsWithSpace.
	diffAddWord = lipgloss.NewStyle().Background(lipgloss.Color("#1F3A1F")).Foreground(colDiffAdd)
	diffDelWord = lipgloss.NewStyle().Background(lipgloss.Color("#3A1F1F")).Foreground(colDiffDel)

	// Search mode (Ctrl+F): the focused match gets the accent background; others a faint underline.
	searchHL      = lipgloss.NewStyle().Background(colAccent).Foreground(lipgloss.Color("#1A1A1A")).Bold(true)
	searchHLOther = lipgloss.NewStyle().Foreground(colWarn).Bold(true)
	searchCur     = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	searchSrc     = lipgloss.NewStyle().Foreground(colSubtle)
	searchHdr     = lipgloss.NewStyle().Foreground(colAccent)
	searchWarn    = lipgloss.NewStyle().Foreground(colWarn)

	// Structured log view (Ctrl+O): a TIME | LEVEL | MESSAGE table with level-colored rows.
	logHdr   = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	logTime  = lipgloss.NewStyle().Foreground(colSubtle)
	logErr   = lipgloss.NewStyle().Foreground(colErr)
	logWarn  = lipgloss.NewStyle().Foreground(colWarn)
	logOK    = lipgloss.NewStyle().Foreground(colOK)
	logInfo  = lipgloss.NewStyle().Foreground(colText)
	logDim   = lipgloss.NewStyle().Foreground(colDim) // debug level — dimmer than info
	logPanel = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colDim).Padding(0, 1)

	// Codebase-map panel — a quiet bordered box, right-aligned above the prompt.
	mapPanel = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colDim).Padding(0, 1)
	mapHdr   = lipgloss.NewStyle().Foreground(colSubtle)
	mapVal   = lipgloss.NewStyle().Foreground(colInactive)
	critCrit = lipgloss.NewStyle().Foreground(colErr)
	critHigh = lipgloss.NewStyle().Foreground(colWarn)
	critMed  = lipgloss.NewStyle().Foreground(colAccent)
	critLow  = lipgloss.NewStyle().Foreground(colInactive)

	// Token meter — bar + dim model/count line, right-aligned above the input.
	meterFill  = lipgloss.NewStyle().Foreground(colAccent)
	meterEmpty = lipgloss.NewStyle().Foreground(colDim)
	meterText  = lipgloss.NewStyle().Foreground(colSubtle)

	// Working / thinking indicators (braille spinner, shimmer phrase).
	workFrame  = lipgloss.NewStyle().Foreground(colShimmer).Bold(true)
	workLabel  = lipgloss.NewStyle().Foreground(colSubtle)
	thinkMark  = lipgloss.NewStyle().Foreground(colShimmer).Bold(true)
	thinkSnip  = lipgloss.NewStyle().Foreground(colSubtle).Italic(true)
	thoughtSty = lipgloss.NewStyle().Foreground(colSubtle)

	// Dashboard panels (HelpDashboard / StatsDashboard / DataTableDashboard).
	dashPanel = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colDim).Padding(0, 1)
	dashTitle = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	dashKey   = lipgloss.NewStyle().Foreground(colInactive)
	dashVal   = lipgloss.NewStyle().Foreground(colText)

	// Agent-label badge on sub-agent tool calls.
	agentBadge = lipgloss.NewStyle().Foreground(colInfo).Bold(true)

	// Footer status glyph + hint text (Ink Footer.tsx parity).
	footerIcon = lipgloss.NewStyle().Foreground(colAccent)
	footerIdle = lipgloss.NewStyle().Foreground(colSubtle)
	footerHint = lipgloss.NewStyle().Foreground(colSubtle)
)

// dashColor maps a dashboard section's named color to a lipgloss style.
func dashColor(name string) lipgloss.Style {
	switch name {
	case "red", "error":
		return lipgloss.NewStyle().Foreground(colErr).Bold(true)
	case "green", "success":
		return lipgloss.NewStyle().Foreground(colOK).Bold(true)
	case "yellow", "amber", "warn":
		return lipgloss.NewStyle().Foreground(colWarn).Bold(true)
	case "blue", "info":
		return lipgloss.NewStyle().Foreground(colInfo).Bold(true)
	case "cyan":
		return lipgloss.NewStyle().Foreground(colHunk).Bold(true)
	default:
		return lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	}
}

// critStyle picks the colored-dot style for a module's criticality (Ink CodebaseMapPanel).
func critStyle(c string) lipgloss.Style {
	switch c {
	case "CRITICAL":
		return critCrit
	case "HIGH":
		return critHigh
	case "MEDIUM":
		return critMed
	default:
		return critLow
	}
}
