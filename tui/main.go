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

	// No mouse capture: the terminal keeps native text selection/copy (like Claude Code). Scroll the
	// transcript with PgUp/PgDn, Ctrl+U/Ctrl+D, or Shift+Up/Down. (WithMouseCellMotion would enable
	// wheel scrolling but hijacks the mouse, breaking copy — not worth the trade.)
	p := tea.NewProgram(initialModel(eng), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		eng.Close()
		os.Exit(1)
	}
	eng.Close()
}
