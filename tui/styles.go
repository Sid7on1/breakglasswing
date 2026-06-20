package main

import "github.com/charmbracelet/lipgloss"

// Lip Gloss palette for the BiMax TUI. Kept in one place so the look is consistent and easy to
// theme later (the engine already forwards theme info we can wire in).
var (
	colAccent = lipgloss.Color("13") // magenta — BiMax brand
	colDim    = lipgloss.Color("240")
	colUser   = lipgloss.Color("12")  // blue
	colAsst   = lipgloss.Color("15")  // bright white
	colTool   = lipgloss.Color("42")  // green
	colErr    = lipgloss.Color("196") // red
	colOK     = lipgloss.Color("42")

	headerStyle = lipgloss.NewStyle().
			Bold(true).Foreground(lipgloss.Color("0")).Background(colAccent).
			Padding(0, 1)

	statusStyle = lipgloss.NewStyle().Foreground(colDim)

	userStyle   = lipgloss.NewStyle().Foreground(colUser).Bold(true)
	asstStyle   = lipgloss.NewStyle().Foreground(colAsst)
	toolStyle   = lipgloss.NewStyle().Foreground(colTool)
	errStyle    = lipgloss.NewStyle().Foreground(colErr)
	dimStyle    = lipgloss.NewStyle().Foreground(colDim)
	streamStyle = lipgloss.NewStyle().Foreground(colAsst)

	promptBox = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).BorderForeground(colAccent).
			Padding(0, 1)

	requestBox = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).BorderForeground(colErr).
			Padding(0, 1)

	// Footer (mirrors Ink's Footer.tsx): model/tier · tokens · goals · mode.
	footerBar  = lipgloss.NewStyle().Foreground(colDim)
	footerVal  = lipgloss.NewStyle().Foreground(lipgloss.Color("250"))
	footerTier = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	footerMode = lipgloss.NewStyle().Foreground(colOK).Bold(true)
	footerSep  = lipgloss.NewStyle().Foreground(colDim).Render("  ·  ")

	// Autocomplete dropdown.
	compSel = lipgloss.NewStyle().Foreground(lipgloss.Color("0")).Background(colAccent)
)
