package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Compact wordmark: the dual-orbit glyph mirrors the desktop icon without taking over the terminal.
var logoLines = []string{
	"  ◜◉◝  BIMAX",
	"  ◟ ◞  two minds, one workspace",
}

// gradientLine sweeps the wordmark left → right from the phosphor accent into its lighter shimmer
// and back — depth within the one signal color, never a second hue. Spaces are skipped so the
// escape-code cost stays proportional to visible glyphs.
func gradientLine(ln string) string {
	runes := []rune(ln)
	n := len(runes)
	if n == 0 {
		return ""
	}
	var b strings.Builder
	for i, r := range runes {
		if r == ' ' {
			b.WriteRune(r)
			continue
		}
		// Triangle wave 0→1→0 across the line: edges phosphor, center the lighter shimmer.
		t := float64(i) / float64(n-1)
		if t > 0.5 {
			t = 1 - t
		}
		c := lerpRGB(baseRGB, rgb{229, 154, 119}, t*2) // colShimmer #E59A77
		b.WriteString(logoStyle.Foreground(lipgloss.Color(c.hex())).Render(string(r)))
	}
	return b.String()
}

// shortPath collapses the home prefix to ~ (mirrors WelcomeBanner.tsx).
func shortPath(p string) string {
	if home, err := os.UserHomeDir(); err == nil && strings.HasPrefix(p, home) {
		return "~" + p[len(home):]
	}
	return p
}

// showWelcome injects the landing banner at the top of the (freshly cleared) screen, once.
// Design: NO box — a full-width bordered rectangle on an empty screen read as stark and broken.
// Instead: the gradient wordmark + version, then the three model slots in plain words (work /
// quick / vision) so "which model does what" is answered before the first prompt, then cwd and
// one line of key hints. Left-aligned, six rows of quiet metadata, content-first.
func (m *model) showWelcome() {
	if m.welcomed {
		return
	}
	m.welcomed = true

	var b strings.Builder
	if version != "dev" {
		fmt.Fprintf(&b, "%s %s\n", gradientLine(logoLines[0]), metaVal.Render("v"+version))
	} else {
		fmt.Fprintf(&b, "%s\n", gradientLine(logoLines[0]))
	}
	fmt.Fprintf(&b, "%s\n\n", gradientLine(logoLines[1]))

	work := shortModel(m.fCoding)
	if work == "" {
		// Never pretend a "default" was chosen — an unconfigured session says so and points at
		// the wizard (which also opens automatically when there is no key at all).
		fmt.Fprintf(&b, "  %s %s\n", metaKey.Render("model "), warnStyle.Render("not chosen yet — run /setup"))
	} else {
		fmt.Fprintf(&b, "  %s %s %s\n", metaKey.Render("work  "), metaVal.Render(work), tipStyle.Render("· deep work"))
		if q := shortModel(m.fLite); q != "" && q != work {
			fmt.Fprintf(&b, "  %s %s %s\n", metaKey.Render("quick "), metaVal.Render(q), tipStyle.Render("· instant small replies"))
		}
		if v := shortModel(m.fVision); v != "" {
			fmt.Fprintf(&b, "  %s %s %s\n", metaKey.Render("vision"), metaVal.Render(v), tipStyle.Render("· sees screenshots"))
		}
	}

	cwd := m.cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	loc := shortPath(cwd)
	if mcpCount := countMcpServers(cwd); mcpCount > 0 {
		loc += tipStyle.Render(fmt.Sprintf(" · %d mcp", mcpCount))
	}
	fmt.Fprintf(&b, "  %s %s\n", metaKey.Render("cwd   "), metaVal.Render(loc))

	if m.fMode == "bypass" {
		fmt.Fprintf(&b, "  %s %s\n", metaKey.Render("guard "), warnStyle.Render("bypassed — no approval prompts"))
	}

	fmt.Fprintf(&b, "\n  %s\n  %s", tipStyle.Render("Describe an outcome — Bimax explores, builds, and verifies."),
		tipStyle.Render("/model models · /help commands · Shift+Tab modes · Ctrl+F search"))

	m.append("\n" + b.String() + "\n")
}

func countMcpServers(cwd string) int {
	home, err := os.UserHomeDir()
	if err != nil {
		return 0
	}

	countActive := func(p string) int {
		data, err := os.ReadFile(filepath.Join(p, ".bimax", "mcp.json"))
		if err != nil {
			return 0
		}
		var config struct {
			Servers []struct {
				Disabled bool `json:"disabled"`
			} `json:"servers"`
		}
		if json.Unmarshal(data, &config) != nil {
			return 0
		}
		c := 0
		for _, s := range config.Servers {
			if !s.Disabled {
				c++
			}
		}
		return c
	}

	count := countActive(home)
	if cwd != "" && cwd != home {
		count += countActive(cwd)
	}
	return count
}
