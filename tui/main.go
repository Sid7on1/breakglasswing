package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
)

// version is stamped by the release build (-ldflags "-X main.version=…"); "dev" otherwise.
var version = "dev"

// BiMax TUI — a Bubble Tea front-end that spawns the headless Node engine and drives it over the
// NDJSON stdio protocol. The engine (all 16k LOC of it) is reused verbatim; this binary only
// renders its events and forwards input. In a release build (-tags embedengine) the bun-compiled
// engine is baked in via go:embed, so the whole thing ships as one file with no Node on the host.
func main() {
	// Fast, engine-free flags so installers/scripts can verify the binary without booting anything.
	for _, a := range os.Args[1:] {
		switch a {
		case "--version", "-v":
			fmt.Println("bimax", version)
			return
		case "--help", "-h":
			fmt.Println("bimax — build software with an agent team")
			fmt.Println("usage: bimax            open Bimax in the current project")
			fmt.Println("       bimax --version  print the version and exit")
			fmt.Println("       bimax --no-anim  reduce motion (freeze spinner/shimmer)")
			fmt.Println()
			fmt.Println("env:   NO_COLOR=1              plain output, no color")
			fmt.Println("       BIMAX_REDUCED_MOTION=1  same as --no-anim")
			return
		}
	}

	// Accessibility: NO_COLOR + reduced motion, resolved before any style renders.
	initAccessibility(os.Args[1:])

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
	// INLINE mode (opencode / Claude-Code style): NO alt-screen. Committed transcript lines are printed
	// into the terminal's OWN scrollback (via tea.Println), so the terminal's NATIVE scrollbar scrolls
	// the history — smooth, native, no custom scrollbar.
	p := tea.NewProgram(initialModel(eng))

	// Graceful SIGTERM/SIGHUP (kill, closed terminal tab, system shutdown): quit through Bubble Tea
	// so it restores the terminal (cursor, raw mode) and Run returns — which reaches eng.Close() and
	// reaps the Node engine child. Without this, a SIGTERM leaves a wrecked terminal AND an orphaned
	// engine process still holding the pipes. Ctrl+C stays a KeyMsg handled inside the model.
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		<-sigs
		p.Quit()
	}()

	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		eng.Close()
		os.Exit(1)
	}
	eng.Close()
}
