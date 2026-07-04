package main

import "github.com/charmbracelet/lipgloss"

// Lip Gloss palette for the BiMax TUI — the "Graphite & Phosphor" design system (supersedes the old
// Ink terracotta port). Instrument-grade and content-first: cool graphite neutrals carry the chrome,
// a SINGLE phosphor accent marks only what is live / focused / active, and functional (Braun-dot)
// semantics are reserved strictly for state. Truecolor hex; lipgloss degrades it for 256/16-color
// terminals automatically. We paint foreground only — the ground is the user's own terminal.
var (
	// Graphite & Phosphor core palette.
	colAccent   = lipgloss.Color("#7EE7C4") // Phosphor — the one signal accent (live / focus / active)
	colShimmer  = lipgloss.Color("#B8F2E0") // lighter phosphor for the shimmer highlight / logo mid-row
	colText     = lipgloss.Color("#EDEFF2") // Mist — primary text
	colInactive = lipgloss.Color("#9AA1AC") // secondary text / summaries (cool graphite)
	colSubtle   = lipgloss.Color("#626974") // tertiary — dim chrome (gutters, hints)
	colDim      = lipgloss.Color("#444A54") // faint graphite — DECORATIVE ONLY (panel hairline borders,
	//                                         empty meter track); 2.2:1, WCAG-exempt. Never use for text.
	colUser     = lipgloss.Color("#EDEFF2") // user lines: bright, marked by the phosphor caret
	colAsst     = lipgloss.Color("#EDEFF2")
	colTool     = lipgloss.Color("#5FD08A") // ok green (Braun dot)
	colErr      = lipgloss.Color("#E5534B") // signal red
	colWarn     = lipgloss.Color("#E0B341") // sodium amber (running / in-progress / warn)
	colOK       = lipgloss.Color("#5FD08A")
	colInfo     = lipgloss.Color("#6E9BFF") // info blue (agent labels)
	colDiffAdd  = lipgloss.Color("#7EE7A0") // diff add prefix / word fg
	colDiffDel  = lipgloss.Color("#F08A82") // diff remove prefix / word fg
	colHunk     = lipgloss.Color("#57C7C7")

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
			Border(lipgloss.RoundedBorder()).BorderForeground(colAccent).
			Padding(0, 1)

	welcomeBox = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).BorderForeground(colDim).
			Padding(2, 2)

	// Footer (mirrors Ink's Footer.tsx): a single dim status line.
	footerBar  = lipgloss.NewStyle().Foreground(colInactive)
	footerVal  = lipgloss.NewStyle().Foreground(colInactive)
	footerTier = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	footerMode = lipgloss.NewStyle().Foreground(colOK).Bold(true)
	footerSep  = lipgloss.NewStyle().Foreground(colSubtle).Render(" · ")

	// Per-mode footer CHIP: bold, uppercase, a solid colored block (reads big/loud at terminal scale).
	// general = yellow (the base); every other mode a distinct hue so the active mode is unmissable.
	colSketch     = lipgloss.Color("#B084EB") // purple — the architect
	modeChipColor = map[string]lipgloss.Color{
		"general": colInfo,   // blue (base)
		"explore": colWarn,   // yellow / amber
		"sketch":  colSketch, // purple
		"code":    colOK,     // green
		"beast":   colAccent, // terracotta (brand)
	}
	// dark text on the colored block for contrast.
	modeChipBase = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#1A1A1A")).Padding(0, 1)
	// Connected-MCP segment: bold yellow, same family as the chip so the two read as one cluster.
	mcpChipStyle = lipgloss.NewStyle().Bold(true).Foreground(colWarn)

	// Autocomplete dropdown / menu selection — accent text + arrow, no heavy inverse bar.
	compSel = lipgloss.NewStyle().Foreground(colAccent).Bold(true)

	// Diff rendering in the approval overlay.
	diffAdd  = lipgloss.NewStyle().Foreground(colDiffAdd)
	diffDel  = lipgloss.NewStyle().Foreground(colDiffDel)
	diffHunk = lipgloss.NewStyle().Foreground(colHunk)

	// Full-line diff (Claude-Code style): the WHOLE changed line gets a coloured background with
	// bright readable text — dark green for additions, dark red for deletions (not neon; respects the
	// warm theme). Line numbers sit in a dim gutter.
	// Graphite-tinted diff pair: a deep green/red fill with a phosphor-adjacent readable fg.
	diffAddLine = lipgloss.NewStyle().Background(lipgloss.Color("#0E2A1C")).Foreground(lipgloss.Color("#7EE7A0"))
	diffDelLine = lipgloss.NewStyle().Background(lipgloss.Color("#2E1416")).Foreground(lipgloss.Color("#F08A82"))
	// Diff gutter line numbers: bright white + bold so they read as a clear, prominent column (the
	// dim grey was nearly invisible). Terminals can't change font size, so "big" = bold/bright.
	diffLineNum = lipgloss.NewStyle().Foreground(lipgloss.Color("#FFFFFF")).Bold(true)

	// Word-level diff (edit-tool preview): tinted background like Ink's diffWordsWithSpace.
	diffAddWord = lipgloss.NewStyle().Background(lipgloss.Color("#0E2A1C")).Foreground(colDiffAdd)
	diffDelWord = lipgloss.NewStyle().Background(lipgloss.Color("#2E1416")).Foreground(colDiffDel)

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
	logDim   = lipgloss.NewStyle().Foreground(colSubtle) // debug level — dimmer than info, but text so it
	//                                                       stays readable (colSubtle 3.5:1, not colDim 2.2:1)
	logPanel = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colDim).Padding(0, 1)

	// Task-list panel — a bordered box pinned above the prompt (Claude-Code TaskListV2 style).
	todoPanel  = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(colDim).Padding(0, 1)
	todoTitle  = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	todoDone   = lipgloss.NewStyle().Foreground(colOK)
	todoActive = lipgloss.NewStyle().Foreground(colAccent).Bold(true)

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
