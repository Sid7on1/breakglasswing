package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// LOGO is the BiMax wordmark, mirroring Ink's WelcomeBanner.tsx.
var logoLines = []string{
	"▗▄▄▄▖ ▗▄▄▄▖ ▗▖  ▗▖  ▗▄▖  ▗▖  ▗▖",
	"▐▌  █   █   ▐▛▚▞▜▌ ▐▌ ▐▌  ▝▚▞▘ ",
	"▐▛▀▀▜   █   ▐▌  ▐▌ ▐▛▀▜▌   ▐▌  ",
	"▐▌▄▄▟ ▗▄█▄▖ ▐▌  ▐▌ ▐▌ ▐▌ ▗▞▘▝▚▖",
}

// gradientLine sweeps the wordmark left → right from the brand terracotta into its lighter
// shimmer and back — the same warm family the theme already uses, just with depth. Spaces are
// skipped so the escape-code cost stays proportional to visible glyphs.
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
		// Triangle wave 0→1→0 across the line: edges terracotta, center shimmer.
		t := float64(i) / float64(n-1)
		if t > 0.5 {
			t = 1 - t
		}
		c := lerpRGB(baseRGB, rgb{245, 149, 117}, t*2) // colShimmer #F59575
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

// showWelcome injects the low-chrome welcome banner at the top of the transcript, once: the accent
// wordmark, a dim metadata block, and a couple of quiet tips — content-first, like WelcomeBanner.tsx.
func (m *model) showWelcome() {
	if m.welcomed {
		return
	}
	m.welcomed = true

	var b strings.Builder
	for _, ln := range logoLines {
		fmt.Fprintf(&b, "%s\n", gradientLine(ln))
	}
	fmt.Fprintf(&b, "\n%s%s\n\n", brandStyle.Render("BiMax "), tipStyle.Render("v1.0.0 · autonomous agent for your terminal"))

	model := shortModel(m.fCoding)
	if model == "" {
		model = shortModel(m.fLite)
	}
	if model == "" {
		model = "default"
	}
	fmt.Fprintf(&b, "%s%s\n", metaKey.Render("model  "), metaVal.Render(model))
	cwd := m.cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	fmt.Fprintf(&b, "%s%s\n", metaKey.Render("cwd    "), metaVal.Render(shortPath(cwd)))

	mcpCount := countMcpServers(cwd)
	if mcpCount > 0 {
		fmt.Fprintf(&b, "%s%s\n", metaKey.Render("mcp    "), metaVal.Render(fmt.Sprintf("%d server(s) configured", mcpCount)))
	}

	if m.fMode == "bypass" {
		fmt.Fprintf(&b, "%s%s\n", metaKey.Render("guard  "), warnStyle.Render("bypassed (YOLO)"))
	}
	fmt.Fprintf(&b, "\n%s\n", tipStyle.Render("Ask anything, or describe a task to run it with tools."))
	fmt.Fprintf(&b, "%s", tipStyle.Render("/help · Ctrl+G palette · Ctrl+X mind · Ctrl+F search · Ctrl+O logs · Esc stash"))

	m.append("\n" + welcomeBox.Render(b.String()) + "\n")
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
