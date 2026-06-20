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

	userStyle   = lipgloss.NewStyle().Foreground(colUser).Bold(true)
	caretStyle  = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	asstStyle   = lipgloss.NewStyle().Foreground(colAsst)
	toolStyle   = lipgloss.NewStyle().Foreground(colTool)
	errStyle    = lipgloss.NewStyle().Foreground(colErr)
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
)
