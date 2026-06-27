package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// activeTodoPanel returns the boxed task list while any task is still unfinished, else "" (a
// fully-done list disappears rather than lingering above the prompt).
func (m model) activeTodoPanel() string {
	for _, t := range m.todos {
		if t.Status != "completed" {
			// width-1, never full width: a box that fills the last column auto-wraps and the inline
			// renderer's row count desyncs → the panel ghosts/multiplies. (Same rule as the footer/map.)
			return renderTodos(m.todos, m.width-1)
		}
	}
	return ""
}

// renderTodos draws the task list as a bordered panel (Claude-Code TaskListV2 style): ✔/▪/□ icons,
// unfinished tasks first, and an "… +N more" summary when the list is long. Task text is clipped to
// the terminal width so a long task can't blow out the box border. Empty list → "".
func renderTodos(todos []TodoItem, width int) string {
	if len(todos) == 0 {
		return ""
	}
	// Border (2) + padding (2) + "icon " (2) = 6 cells of chrome around the text.
	textW := width - 6
	if textW < 10 {
		textW = 10
	}
	// Unfinished first so the cap never hides what's actually pending.
	ordered := make([]TodoItem, 0, len(todos))
	done := 0
	for _, t := range todos {
		if t.Status == "completed" {
			done++
		} else {
			ordered = append(ordered, t)
		}
	}
	for _, t := range todos {
		if t.Status == "completed" {
			ordered = append(ordered, t)
		}
	}

	const maxShow = 8
	var b strings.Builder
	for i, t := range ordered {
		if i >= maxShow {
			fmt.Fprintf(&b, "%s\n", dimStyle.Render(fmt.Sprintf("… +%d more", len(ordered)-maxShow)))
			break
		}
		icon, st := "□", dimStyle
		switch t.Status {
		case "completed":
			icon, st = "✔", todoDone
		case "in_progress":
			icon, st = "▪", todoActive
		}
		fmt.Fprintf(&b, "%s\n", st.Render(icon+" "+clip(t.Content, textW)))
	}
	title := todoTitle.Render(fmt.Sprintf("Tasks (%d/%d)", done, len(todos)))
	return todoPanel.Render(title + "\n" + strings.TrimRight(b.String(), "\n"))
}

// --- codebase map panel --------------------------------------------------------------------

// mapPanelView renders the right-aligned CodebaseMapPanel (Ink CodebaseMapPanel.tsx).
func (m model) mapPanelView() string {
	// Fix the inner content width so the box stays one column SHORT of the terminal. Border (2) +
	// padding (2) = 4 cols of chrome, plus 1 spare column so the placed line is m.width-1 wide. A
	// full-width line auto-wraps the cursor, which desyncs the inline renderer's row count and makes
	// this box ghost/duplicate on resize (and overflow when zoomed narrow). Keeping it < m.width fixes
	// both.
	inner := m.width - 5
	if inner < 12 {
		return "" // too narrow for the panel — skip it rather than spill over the transcript
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s%s\n", mapHdr.Render("Codebase Map · "), mapVal.Render(fmt.Sprintf("%d nodes · %d files", m.graph.NodeCount, m.graph.FileCount)))
	if m.graph.Engine == "codebase-memory" {
		fmt.Fprintf(&b, "%s%s\n", mapHdr.Render("engine: "), logOK.Render("⚡ codebase-memory · 158-lang · semantic"))
	}
	if len(m.graph.Modules) > 0 {
		fmt.Fprintf(&b, "%s\n", mapHdr.Render("top modules (by criticality)"))
		for _, mod := range m.graph.Modules {
			dot := "○ "
			if mod.Criticality != "" {
				dot = "● "
			}
			// Clip the (plain) name before styling so each row stays one line within inner.
			budget := inner - 2 // the dot
			if mod.Criticality != "" {
				budget -= len(mod.Criticality) + 2
			}
			name := mod.Name
			if budget > 1 && len(name) > budget {
				name = clip(name, budget)
			}
			line := critStyle(mod.Criticality).Render(dot) + mapVal.Render(name)
			if mod.Criticality != "" {
				line += mapHdr.Render("  " + mod.Criticality)
			}
			fmt.Fprintf(&b, "%s\n", line)
		}
	}
	ai := mapVal.Render("✗ (run /index-ai)")
	if m.graph.AIGraphBuilt {
		ai = logOK.Render("✓")
	}
	fmt.Fprintf(&b, "%s%s", mapHdr.Render("AI graph: "), ai)
	box := mapPanel.Width(inner).Render(b.String())
	// Place within m.width-1, never the full width — see the inner-width note above.
	return lipgloss.PlaceHorizontal(m.width-1, lipgloss.Right, box)
}

// compactMapView is the one-line pinned codebase-map summary (right-aligned above the prompt): node
// count + the top few modules by criticality, colour-dotted. Empty until the graph is indexed. The
// full multi-line panel is still available via /map.
func (m model) compactMapView() string {
	cbm := m.graph.Engine == "codebase-memory"
	// The engine keeps its own 158-language index, so it can be live even when the native in-memory
	// graph (NodeCount) is empty — still show the badge in that case.
	if m.graph.NodeCount == 0 && !cbm {
		return ""
	}
	// LEFT-aligned, plain (no wide/ambiguous glyphs), and truncated to width-2 — NOT right-aligned and
	// padded to full width. A full-width line with a width-miscounted glyph (the old ⛁/● right-aligned
	// version) overflows the terminal, wraps, and desyncs Bubble Tea's inline cursor-up clear → the
	// whole live region multiplies on every tea.Println / zoom. A short left-aligned line can't wrap.
	var b strings.Builder
	if cbm {
		fmt.Fprintf(&b, "%s", logOK.Render("⚡ codebase-memory"))
		if m.graph.NodeCount > 0 {
			fmt.Fprintf(&b, "%s", mapHdr.Render(fmt.Sprintf(" · %d nodes", m.graph.NodeCount)))
		}
	} else {
		fmt.Fprintf(&b, "%s%s", mapHdr.Render("Map "), mapVal.Render(fmt.Sprintf("%d nodes · %d files", m.graph.NodeCount, m.graph.FileCount)))
	}
	shown := 0
	for _, mod := range m.graph.Modules {
		if shown >= 3 {
			break
		}
		fmt.Fprintf(&b, "%s%s", mapHdr.Render(" · "), mapVal.Render(clip(mod.Name, 18)))
		shown++
	}
	line := b.String()
	// width-2 (not width-1): a 1-cell safety margin in case any glyph is rendered wider than measured.
	if max := m.width - 2; max > 0 && lipgloss.Width(line) > max {
		line = ansi.Truncate(line, max, "…")
	}
	return line
}
