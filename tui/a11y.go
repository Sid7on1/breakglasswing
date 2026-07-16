package main

import (
	"os"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

// Accessibility switches, resolved once at startup from the environment and CLI flags.
//
//   - NO_COLOR (any non-empty value, per https://no-color.org) forces the ASCII/no-color profile,
//     so every lipgloss style renders as plain text — no SGR at all.
//   - BIMAX_REDUCED_MOTION=1 or --no-anim freezes the animated chrome (braille spinner, per-frame
//     shimmer sweep, cycling verbs, dot rotation). The working line becomes a single static row
//     whose only change is the whole-second elapsed clock (information, not decoration). This
//     honors the same intent as the web platform's prefers-reduced-motion.
var reducedMotion bool

// initAccessibility applies NO_COLOR and reduced-motion settings. Call before building the model,
// so the color profile is set before any style renders. args is os.Args[1:].
func initAccessibility(args []string) {
	// Resolve the background ONCE, without ever querying the terminal. lipgloss resolves any
	// AdaptiveColor (bubbles' textarea defaults carry several) by asking termenv for the terminal
	// background, which writes an OSC-11 query and BLOCKS up to 5s reading the reply from the tty —
	// on terminals that don't answer, that froze the first paint for ~7s AND swallowed everything
	// the user typed in that window (the query reader consumes stdin). Bimax's Graphite palette is
	// explicit truecolor hex on the terminal's own background, so the adaptive lookup carries no
	// design information here — pin it and never block. BIMAX_LIGHT_BG=1 flips the hint for the
	// rare light-terminal user.
	lipgloss.SetHasDarkBackground(os.Getenv("BIMAX_LIGHT_BG") == "")
	if os.Getenv("NO_COLOR") != "" {
		lipgloss.SetColorProfile(termenv.Ascii)
	}
	if os.Getenv("BIMAX_REDUCED_MOTION") != "" {
		reducedMotion = true
	}
	for _, a := range args {
		if a == "--no-anim" {
			reducedMotion = true
		}
	}
}
