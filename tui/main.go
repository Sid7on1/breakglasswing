package main

import (
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"
)

// BiMax TUI — a Bubble Tea front-end that spawns the headless Node engine and drives it over the
// NDJSON stdio protocol. The engine (all 16k LOC of it) is reused verbatim; this binary only
// renders its events and forwards input. Next step: embed the bun-compiled engine via go:embed so
// the whole thing ships as one file with no Node on the user's machine.
func main() {
	root := os.Getenv("BIMAX_REPO_ROOT")
	if root == "" {
		wd, _ := os.Getwd()
		if filepath.Base(wd) == "tui" {
			root = filepath.Dir(wd) // running from tui/ → repo root is the parent
		} else {
			root = wd
		}
	}

	eng, err := StartEngine(root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to start engine:", err)
		os.Exit(1)
	}

	p := tea.NewProgram(initialModel(eng), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		eng.Close()
		os.Exit(1)
	}
	eng.Close()
}
