package main

import "github.com/charmbracelet/lipgloss"

// Lip Gloss palette for the Bimax TUI — the same warm Graphite system as the desktop app.
// Quiet graphite neutrals carry the chrome, one ember accent marks what is live/focused, and functional
// semantics are reserved strictly for state. Truecolor hex; lipgloss degrades it for 256/16-color
// terminals automatically. We paint foreground only — the ground is the user's own terminal.
var (
	// Warm Graphite core palette — synchronized with app/src/renderer/src/styles.css.
	colAccent   = lipgloss.Color("#D78562") // Ember — the one signal accent (live / focus / active)
	colShimmer  = lipgloss.Color("#E59A77") // lighter ember for subtle live shimmer
	colText     = lipgloss.Color("#F1EFE9") // warm primary ink
	colInactive = lipgloss.Color("#B0ADA5") // secondary text / summaries
	colSubtle   = lipgloss.Color("#77746E") // tertiary — dim chrome (gutters, hints)
	colDim      = lipgloss.Color("#383734") // faint graphite — DECORATIVE ONLY (panel hairline borders,
	//                                         empty meter track); 2.2:1, WCAG-exempt. Never use for text.
	colUser    = lipgloss.Color("#F1EFE9")
	colAsst    = lipgloss.Color("#F1EFE9")
	colTool    = lipgloss.Color("#82AD89")
	colErr     = lipgloss.Color("#DF766F")
	colWarn    = lipgloss.Color("#D4A35F")
	colOK      = lipgloss.Color("#82AD89")
	colInfo    = lipgloss.Color("#78A9D4")
	colDiffAdd = lipgloss.Color("#82AD89")
	colDiffDel = lipgloss.Color("#DF766F")
	colHunk    = lipgloss.Color("#78A9D4")

	// Extended semantic tokens (WS3-B) — named so NO style below carries a raw hex; this block is
	// the single source of truth for every colour in the TUI's chrome. (The code-syntax palette in
	// markdown.go is a separate chroma theme by design; views.go/welcome.go hold rgb decompositions
	// of these tokens for gradient math, annotated with the token they mirror.)
	colInk       = lipgloss.Color("#1A1A1A") // near-black text ON a colored block (mode chip, search hit)
	colBright    = lipgloss.Color("#FFFFFF") // max-contrast text (diff line numbers)
	colDiffAddBg = lipgloss.Color("#0E2A1C") // deep green fill behind an added diff line / word
	colDiffDelBg = lipgloss.Color("#2E1416") // deep red fill behind a removed diff line / word

	// Welcome banner / wordmark.
	logoStyle   = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	logoMid     = lipgloss.NewStyle().Foreground(colShimmer).Bold(true)
	brandStyle  = lipgloss.NewStyle().Foreground(colText).Bold(true)
	tipStyle    = lipgloss.NewStyle().Foreground(colInactive)
	metaKey     = lipgloss.NewStyle().Foreground(colInactive)
	metaVal     = lipgloss.NewStyle().Foreground(colInactive)
	statusStyle = lipgloss.NewStyle().Foreground(colInactive)

	// User echo is the accent color (phosphor) so a turn's prompt is instantly distinct from the
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
		"beast":   colAccent, // phosphor (brand)
	}
	// dark text on the colored block for contrast.
	modeChipBase = lipgloss.NewStyle().Bold(true).Foreground(colInk).Padding(0, 1)
	// Connected-MCP segment: bold yellow, same family as the chip so the two read as one cluster.
	mcpChipStyle = lipgloss.NewStyle().Bold(true).Foreground(colWarn)

	// Autocomplete dropdown / menu selection — accent text + arrow, no heavy inverse bar.
	compSel = lipgloss.NewStyle().Foreground(colAccent).Bold(true)

	// Grouped-menu chrome: category tab bar, section headers, and inline hyperlinks.
	menuTabActive = lipgloss.NewStyle().Background(colAccent).Foreground(colInk).Bold(true)
	menuTabIdle   = lipgloss.NewStyle().Foreground(colSubtle)
	menuSection   = lipgloss.NewStyle().Foreground(colInactive).Bold(true)
	linkStyle     = lipgloss.NewStyle().Foreground(colInfo).Underline(true)

	// Diff rendering in the approval overlay.
	diffAdd  = lipgloss.NewStyle().Foreground(colDiffAdd)
	diffDel  = lipgloss.NewStyle().Foreground(colDiffDel)
	diffHunk = lipgloss.NewStyle().Foreground(colHunk)

	// Full-line diff (Claude-Code style): the WHOLE changed line gets a coloured background with
	// bright readable text — dark green for additions, dark red for deletions (not neon; respects the
	// graphite theme). Line numbers sit in a dim gutter.
	// Graphite-tinted diff pair: a deep green/red fill with a phosphor-adjacent readable fg.
	diffAddLine = lipgloss.NewStyle().Background(colDiffAddBg).Foreground(colDiffAdd)
	diffDelLine = lipgloss.NewStyle().Background(colDiffDelBg).Foreground(colDiffDel)
	// Diff gutter line numbers: bright white + bold so they read as a clear, prominent column (the
	// dim grey was nearly invisible). Terminals can't change font size, so "big" = bold/bright.
	diffLineNum = lipgloss.NewStyle().Foreground(colBright).Bold(true)

	// Word-level diff (edit-tool preview): tinted background like Ink's diffWordsWithSpace.
	diffAddWord = lipgloss.NewStyle().Background(colDiffAddBg).Foreground(colDiffAdd)
	diffDelWord = lipgloss.NewStyle().Background(colDiffDelBg).Foreground(colDiffDel)

	// Search mode (Ctrl+F): the focused match gets the accent background; others a faint underline.
	searchHL      = lipgloss.NewStyle().Background(colAccent).Foreground(colInk).Bold(true)
	searchHLOther = lipgloss.NewStyle().Foreground(colWarn).Bold(true)
	searchCur     = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	searchSrc     = lipgloss.NewStyle().Foreground(colSubtle)
	searchHdr     = lipgloss.NewStyle().Foreground(colAccent)
	searchWarn    = lipgloss.NewStyle().Foreground(colWarn)

	// Structured log view (Ctrl+O): a TIME | LEVEL | MESSAGE table with level-colored rows.
	logHdr  = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	logTime = lipgloss.NewStyle().Foreground(colSubtle)
	logErr  = lipgloss.NewStyle().Foreground(colErr)
	logWarn = lipgloss.NewStyle().Foreground(colWarn)
	logOK   = lipgloss.NewStyle().Foreground(colOK)
	logInfo = lipgloss.NewStyle().Foreground(colText)
	logDim  = lipgloss.NewStyle().Foreground(colSubtle) // debug level — dimmer than info, but text so it
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

	// Sub-agent live panel — a bright animated accent so a running agent reads as ALIVE, not chrome.
	saSpin  = lipgloss.NewStyle().Foreground(colAccent).Bold(true) // animated braille spinner
	saType  = lipgloss.NewStyle().Foreground(colAccent).Bold(true) // agent type (BiMax/Explore)
	saVerb  = lipgloss.NewStyle().Foreground(colText).Bold(true)   // action verb (Reading/Running)
	saRobot = lipgloss.NewStyle().Foreground(colInfo)              // 🤖 tint (kept subtle)

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
