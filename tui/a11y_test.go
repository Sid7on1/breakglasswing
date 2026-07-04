package main

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

// NO_COLOR must force plain output: after initAccessibility sees it, no style emits an SGR escape.
func TestNoColorStripsSGR(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	// Restore the default profile after the test so other tests keep their color.
	defer lipgloss.SetColorProfile(termenv.TrueColor)

	initAccessibility(nil)
	out := logoStyle.Render("BIMAX") + userStyle.Render("prompt") + errStyle.Render("err")
	if strings.Contains(out, "\x1b") {
		t.Fatalf("NO_COLOR set but output still contains an ANSI escape: %q", out)
	}
}

// Reduced motion is set by either the env var or the --no-anim flag.
func TestReducedMotionFlagAndEnv(t *testing.T) {
	defer func() { reducedMotion = false }()

	reducedMotion = false
	initAccessibility([]string{"--no-anim"})
	if !reducedMotion {
		t.Fatal("--no-anim did not enable reduced motion")
	}

	reducedMotion = false
	t.Setenv("BIMAX_REDUCED_MOTION", "1")
	initAccessibility(nil)
	if !reducedMotion {
		t.Fatal("BIMAX_REDUCED_MOTION did not enable reduced motion")
	}
}
