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

	// INLINE mode (opencode / Claude-Code style): NO alt-screen. Committed transcript lines are printed
	// into the terminal's OWN scrollback (via tea.Println), so the terminal's NATIVE scrollbar scrolls
	// the history — smooth, native, no custom scrollbar. Only a small live region (streaming answer,
	// running tools, input box, footer) is redrawn in place at the bottom.
	//
	// "Lock the screen": clear the visible screen AND the scrollback (ESC[3J) ONCE before the UI starts,
	// so the banner becomes the absolute top — you can't scroll up into pre-launch shell output or empty
	// space above it. From here on only post-launch transcript fills the scrollback.
	fmt.Print("\x1b[2J\x1b[3J\x1b[H")
	p := tea.NewProgram(initialModel(eng))
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		eng.Close()
		os.Exit(1)
	}
	eng.Close()
}
