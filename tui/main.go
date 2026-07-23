package main

import (
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
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
		case "--third-party-notices":
			fmt.Println(thirdPartyNotices)
			return
		case "--help", "-h":
			fmt.Println("bimax — build software with an agent team")
			fmt.Println("usage: bimax            open Bimax in the current project")
			fmt.Println("       bimax --version  print the version and exit")
			fmt.Println("       bimax --third-party-notices  print bundled licenses")
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

	// ALTERNATE-SCREEN viewport (ADR-001, revised): the transcript is model state (m.lines) and the
	// whole frame is a pure function of it. Resize REFLOWS state at the new width — committed output
	// is never cleared, reprinted, or repaired, which the inline renderer could not guarantee
	// (post-reflow, previously painted rows cannot be located, so every repair was a clear+reprint).
	// The user's own shell screen/scrollback is preserved by the terminal and restored on exit;
	// the session transcript is printed once after exit so the conversation survives.
	p := tea.NewProgram(
		initialModel(eng),
		tea.WithAltScreen(),
		// Alternate-screen mode has no terminal-owned scrollback while the program is running.
		// Capture wheel/trackpad events so the transcript viewport remains reachable with the
		// interaction users naturally try first; keyboard paging remains available as a fallback.
		tea.WithMouseCellMotion(),
	)

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

	finalModel, err := p.Run()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		eng.Close()
		os.Exit(1)
	}
	eng.Close()
	// The alt screen vanished with the program — print the session transcript into the real
	// terminal once, so the conversation survives exit (and lands in native scrollback after all).
	if m, ok := finalModel.(model); ok && len(m.lines) > 0 {
		fmt.Println(strings.Join(m.lines, "\n"))
	}
}
