package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (m *model) renderMessage(me MessageEntry) {
	switch me.UIComponent {
	case "menu":
		var menu Menu
		if json.Unmarshal(me.Payload, &menu) == nil && len(menu.Options) > 0 {
			m.menuOpen = true
			m.menuID = menu.ID
			m.menuTitle = menu.Title
			m.menuOpts = menu.Options
			// Land the cursor on the currently-set option (toggle submenus send initialIndex);
			// clamp so a stale index can't point past the list.
			m.menuIdx = menu.InitialIndex
			if m.menuIdx < 0 || m.menuIdx >= len(menu.Options) {
				m.menuIdx = 0
			}
			m.menuFilter = ""
			m.relayout()
		}
		return
	case "HelpDashboard", "StatsDashboard", "DataTableDashboard":
		m.append(renderDashboard(me))
		return
	}
	switch me.Role {
	case "user":
		// A new turn begins — scope tool-call dedupe to this turn so a later turn's tool ids can't
		// collide with an earlier turn's line indices (and the map doesn't grow without bound).
		m.runningTools = map[string]string{}
		m.runningOrder = nil
		// Reset the per-turn reasoning clock so "Thought for Ns" measures THIS turn, and drop any
		// leftover streamed partial so a prior turn's text can't bleed into this one.
		m.turnThinkStart = time.Time{}
		m.turnThoughtMs = 0
		m.thinkSnip = ""
		m.stream = ""
		m.histTokens += len([]rune(me.Content)) / 4
		if m.started {
			m.append("") // a blank line between turns so the transcript reads as distinct exchanges
		}
		m.append(caretStyle.Render("❯ ") + userStyle.Render(me.Content))
	case "assistant":
		m.stream = "" // the final message supersedes the streamed partial
		m.histTokens += len([]rune(me.Content)) / 4
		// "✻ Thought for Ns" — prefer the engine's thoughtMs, else the Go-side clock. ≥500ms only.
		thought := me.ThoughtMs
		if thought == 0 {
			thought = m.turnThoughtMs
		}
		var b strings.Builder
		if thought >= 500 {
			fmt.Fprintf(&b, "%s\n", thoughtSty.Render(fmt.Sprintf("  ✻ Thought for %ds", thought/1000)))
		}
		// Render at width-2 and indent by a 2-space gutter so the reply lines up under the rest of the
		// transcript (tool lines, todos, the welcome block all sit at +2) instead of starting flush at
		// column 0 with no structure. The first line gets an accent ⏺ marker, Claude-Code style, so a
		// turn's answer is visually anchored.
		md := indentLines(renderMarkdown(me.Content, m.vp.Width-2), "  ")
		if md != "" {
			md = toolDot.Render("⏺ ") + strings.TrimPrefix(md, "  ")
		}
		b.WriteString(md)
		m.append(b.String())
	default: // system
		st := dimStyle
		switch me.Level {
		case "error":
			st = errStyle
		case "success":
			st = okStyle // green confirmation, matching the Ink UI (was dim, indistinguishable from info)
		}
		m.append(st.Render(me.Content))
	}
}

func (m *model) answer(value string) {
	m.engine.Send(encodeReply(m.reqID, value))
	shown := value
	if m.reqKind == "input" && value != "" {
		shown = strings.Repeat("•", min(len(value), 8)) // masked-ish echo for free-form answers
	}
	if shown != "" {
		m.append(dimStyle.Render("  → " + shown))
	}
	m.reqOpen = false
	m.reqKind = ""
	m.reqBody = ""
	m.reqOpts = nil
	m.reqMasked = false
}

// filteredMenu applies the live fuzzy filter (case-insensitive substring over label/desc/value),
// mirroring Ink InteractiveMenu's enableSearch. Empty filter → the full list.
func (m model) filteredMenu() []menuOption {
	if m.menuFilter == "" {
		return m.menuOpts
	}
	q := strings.ToLower(m.menuFilter)
	out := make([]menuOption, 0, len(m.menuOpts))
	for _, o := range m.menuOpts {
		if strings.Contains(strings.ToLower(o.Label+" "+o.Desc+" "+o.Value), q) {
			out = append(out, o)
		}
	}
	return out
}
