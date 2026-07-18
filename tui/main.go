package main

import (
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
)

// Build provenance (§10): a build must be able to say exactly what it is. The release build stamps
// all of these via -ldflags -X (scripts/lib-build.sh); a plain `go build` leaves them empty and
// versionString() falls back to the VCS metadata Go embeds automatically (vcs.revision/time/
// modified) — so even a dev build names its commit and whether the tree was dirty.
var (
	version   = "dev" // semver of a cut release; "dev" otherwise
	channel   = "dev" // "release" only when built by release.sh; "dev" for local builds
	commit    = ""    // git short hash
	buildTime = ""    // RFC3339
	dirty     = ""    // "true" when built from a modified tree
)

// versionString assembles the provenance line. Never guesses: any field it cannot determine is
// reported as "unknown" rather than omitted or invented.
func versionString() string {
	c, ts, d := commit, buildTime, dirty
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			switch s.Key {
			case "vcs.revision":
				if c == "" && len(s.Value) >= 8 {
					c = s.Value[:8]
				}
			case "vcs.time":
				if ts == "" {
					ts = s.Value
				}
			case "vcs.modified":
				if d == "" {
					d = s.Value
				}
			}
		}
	}
	if c == "" {
		c = "unknown"
	}
	if ts == "" {
		ts = "unknown"
	}
	tree := "clean"
	switch d {
	case "true":
		tree = "dirty"
	case "":
		tree = "unknown-tree"
	}
	return fmt.Sprintf("bimax %s\ncommit:  %s (%s)\nbuilt:   %s\nchannel: %s", version, c, tree, ts, channel)
}

// BiMax TUI — a Bubble Tea front-end that spawns the headless Node engine and drives it over the
// NDJSON stdio protocol. The engine (all 16k LOC of it) is reused verbatim; this binary only
// renders its events and forwards input. In a release build (-tags embedengine) the bun-compiled
// engine is baked in via go:embed, so the whole thing ships as one file with no Node on the host.
func main() {
	// Fast, engine-free flags so installers/scripts can verify the binary without booting anything.
	for _, a := range os.Args[1:] {
		switch a {
		case "--version", "-v":
			fmt.Println(versionString())
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
	// Launch scroll-lock: wipe the visible screen AND the terminal's saved scrollback (2J + 3J), then
	// home the cursor, so the session starts with nothing above it — scrolling up at launch shows no
	// stale shell output or ghost frames from a previous bimax run. From here on the scrollback is
	// bimax's own transcript only. (Escape codes are safe here: bubbletea requires a TTY to run, and
	// the engine-free flags above returned before this point for scripted/piped invocations.)
	fmt.Print("\x1b[2J\x1b[3J\x1b[H")
	p := tea.NewProgram(initialModel(eng))

	// Graceful SIGHUP (closed terminal tab / hangup): quit through Bubble Tea so it restores the
	// terminal and Run returns — which reaches eng.Close() and reaps the Node engine child.
	//
	// SIGTERM is deliberately NOT handled here: Bubble Tea ≥1.3 installs its own SIGINT/SIGTERM
	// handler that feeds QuitMsg through the normal message loop. Handling it here too created a
	// deadlock — our p.Quit() stopped the event loop while bubbletea's own signal goroutine was
	// still blocked sending its QuitMsg into p.msgs (tea.go:303 is an unguarded channel send), so
	// Program.shutdown waited on that goroutine forever and `kill` left a raw, cursor-less terminal
	// with an orphaned engine. One owner per signal. (Regression-tested by the PTY lifecycle suite.)
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGHUP)
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
