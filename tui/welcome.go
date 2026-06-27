package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LOGO is the BiMax wordmark, mirroring Ink's WelcomeBanner.tsx.
var logoLines = []string{
	"▗▄▄▄▖ ▗▄▄▄▖ ▗▖  ▗▖  ▗▄▖  ▗▖  ▗▖",
	"▐▌  █   █   ▐▛▚▞▜▌ ▐▌ ▐▌  ▝▚▞▘ ",
	"▐▛▀▀▜   █   ▐▌  ▐▌ ▐▛▀▜▌   ▐▌  ",
	"▐▌▄▄▟ ▗▄█▄▖ ▐▌  ▐▌ ▐▌ ▐▌ ▗▞▘▝▚▖",
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
	for i, ln := range logoLines {
		st := logoStyle
		if i == 1 {
			st = logoMid
		}
		fmt.Fprintf(&b, "%s\n", st.Render(ln))
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
	fmt.Fprintf(&b, "%s", tipStyle.Render("/help · Ctrl+G palette · Ctrl+F search · Ctrl+O logs · Esc stash · Ctrl+R restore"))

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
