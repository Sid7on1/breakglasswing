package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

// BiMax TUI — a Bubble Tea front-end that spawns the headless Node engine and drives it over the
// NDJSON stdio protocol. The engine (all 16k LOC of it) is reused verbatim; this binary only
// renders its events and forwards input. In a release build (-tags embedengine) the bun-compiled
// engine is baked in via go:embed, so the whole thing ships as one file with no Node on the host.
func main() {
	eng, err := StartEngine(ResolveRoot())
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to start engine:", err)
		os.Exit(1)
	}

	// INLINE mode (no alt-screen): committed transcript is printed into the terminal's OWN scrollback
	// via tea.Println, so native scroll + native copy work and all text stays visible — like Claude
	// Code. Only the live region (streaming answer, input box, footer, menus) is redrawn in place.
	p := tea.NewProgram(initialModel(eng))
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		eng.Close()
		os.Exit(1)
	}
	eng.Close()
}
