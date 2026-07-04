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
