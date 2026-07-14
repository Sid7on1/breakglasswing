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
	fmt.Fprintf(&b, "\n%s\n\n", tipStyle.Render("Describe an outcome. Bimax can explore, build, verify, and show its work."))

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
		fmt.Fprintf(&b, "%s%s\n", metaKey.Render("mcp    "), metaVal.Render(fmt.Sprintf("%d active", mcpCount)))
	}

	if m.fMode == "bypass" {
		fmt.Fprintf(&b, "%s%s\n", metaKey.Render("guard  "), warnStyle.Render("bypassed — no approval prompts"))
	}
	fmt.Fprintf(&b, "\n%s", tipStyle.Render("Ctrl+G actions · Ctrl+F search · Ctrl+O activity · Ctrl+X memory"))

	// Stretch the banner across the terminal instead of hugging its content. width-3 keeps the box one
	// column short of the edge (border 2 + a spare col) so it never wraps the inline renderer.
	box := welcomeBox
	if m.width > 20 {
		box = box.Width(m.width - 6) // content width; border(2)+padding(4) bring the outer box to width-2
	}
	m.append("\n" + box.Render(b.String()) + "\n")
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
