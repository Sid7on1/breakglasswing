package main

import (
	"strings"

	"github.com/charmbracelet/glamour"
)

// Markdown rendering for assistant output (bold, lists, and syntax-highlighted code blocks),
// matching the Ink UI. The renderer is width-dependent, so we cache it and rebuild only when the
// viewport width changes. Falls back to the raw text if glamour ever errors.

var (
	mdRenderer *glamour.TermRenderer
	mdWidth    int
)

func renderMarkdown(src string, width int) string {
	if width < 20 {
		width = 80
	}
	if mdRenderer == nil || mdWidth != width {
		r, err := glamour.NewTermRenderer(
			glamour.WithAutoStyle(),       // match the terminal's light/dark background
			glamour.WithWordWrap(width-2), // leave a small gutter
		)
		if err != nil {
			return src
		}
		mdRenderer, mdWidth = r, width
	}
	out, err := mdRenderer.Render(src)
	if err != nil {
		return src
	}
	// glamour pads with blank lines + a leading margin; trim so it sits flush in the transcript.
	return strings.Trim(out, "\n")
}
