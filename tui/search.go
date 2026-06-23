package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// --- search (Ctrl+F) -----------------------------------------------------------------------

type searchMatch struct {
	source string // "you" | "assistant" | "system" | "log"
	text   string
}

// searchMatches scans the committed transcript and the log cache for the current query.
func (m model) searchMatches() []searchMatch {
	q := strings.ToLower(strings.TrimSpace(m.searchQuery))
	if q == "" {
		return nil
	}
	var out []searchMatch
	for _, ln := range m.lines {
		for _, sub := range strings.Split(ln, "\n") {
			plain := strings.TrimSpace(stripAnsi(sub))
			if plain == "" || !strings.Contains(strings.ToLower(plain), q) {
				continue
			}
			src := "assistant"
			if strings.Contains(plain, "❯") {
				src = "you"
			} else if strings.HasPrefix(plain, "✖") || strings.HasPrefix(plain, "ℹ") || strings.HasPrefix(plain, "⚠") {
				src = "system"
			}
			out = append(out, searchMatch{src, plain})
		}
	}
	for _, lg := range m.logs {
		if strings.Contains(strings.ToLower(lg.Text), q) {
			out = append(out, searchMatch{"log", lg.Text})
		}
	}
	return out
}

var searchLabels = map[string]string{"you": "you", "assistant": "bimax", "system": "sys", "log": "log"}

// highlightQuery wraps each case-insensitive occurrence of the query in the given style.
func highlightQuery(text, query string, hl lipgloss.Style) string {
	if query == "" {
		return text
	}
	lower, q := strings.ToLower(text), strings.ToLower(query)
	var b strings.Builder
	for {
		i := strings.Index(lower, q)
		if i < 0 {
			b.WriteString(text)
			break
		}
		b.WriteString(text[:i])
		b.WriteString(hl.Render(text[i : i+len(query)]))
		text, lower = text[i+len(query):], lower[i+len(query):]
	}
	return b.String()
}

// searchView renders the SearchResults panel (Ink SearchResults.tsx): an "N of M" header and a
// windowed match list with source labels and the query highlighted.
func (m model) searchView() string {
	if strings.TrimSpace(m.searchQuery) == "" {
		return searchSrc.Render(" Search: type to find in transcript and logs…")
	}
	matches := m.searchMatches()
	if len(matches) == 0 {
		return searchWarn.Render(fmt.Sprintf(" No matches for \u201c%s\u201d", m.searchQuery))
	}
	cur := m.searchIdx % len(matches)
	const maxRows = 10
	start := cur - maxRows/2
	if start < 0 {
		start = 0
	}
	end := start + maxRows
	if end > len(matches) {
		end = len(matches)
		start = end - maxRows
		if start < 0 {
			start = 0
		}
	}
	var b strings.Builder
	plural := "es"
	if len(matches) == 1 {
		plural = ""
	}
	fmt.Fprintf(&b, "%s%s\n", searchHdr.Render(fmt.Sprintf(" 🔍 %d of %d match%s for \u201c%s\u201d", cur+1, len(matches), plural, m.searchQuery)), searchSrc.Render("  (↑/↓ or Enter to navigate · Esc to exit)"))
	for i := start; i < end; i++ {
		mm := matches[i]
		label := searchLabels[mm.source]
		txt := mm.text
		if len([]rune(txt)) > 120 {
			txt = string([]rune(txt)[:117]) + "…"
		}
		if i == cur {
			fmt.Fprintf(&b, "%s%s\n", searchCur.Render("▸ "+fmt.Sprintf("%-5s", label)+" │ "), highlightQuery(txt, m.searchQuery, searchHL))
		} else {
			fmt.Fprintf(&b, "%s%s\n", searchSrc.Render("  "+fmt.Sprintf("%-5s", label)+" │ "), dimStyle.Render(highlightQuery(txt, m.searchQuery, searchHLOther)))
		}
	}
	return strings.TrimRight(b.String(), "\n")
}
