package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// renderShortcuts returns the /shortcuts key table (handled Go-side; the headless engine has no
// keybindings registry).
func renderShortcuts() string {
	rows := [][2]string{
		{"Enter", "Submit input"},
		{"Ctrl+J", "Insert newline"},
		{"Ctrl+C", "Cancel turn / quit when idle"},
		{"Ctrl+G", "Command palette"},
		{"Ctrl+F", "Search transcript & logs"},
		{"Ctrl+O", "Toggle log view"},
		{"Ctrl+X", "Mind HUD (weak spots · drives · habits)"},
		{"Ctrl+B", "Collapse/expand tool calls"},
		{"Ctrl+P", "Preview pasted blocks"},
		{"Esc", "Stash input / dismiss"},
		{"Ctrl+R", "Resume stashed input"},
		{"Tab", "Accept autocomplete"},
		{"↑/↓", "History / completion nav"},
		{"PgUp/PgDn", "Scroll transcript"},
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n", dashTitle.Render("Keyboard shortcuts"))
	for _, r := range rows {
		fmt.Fprintf(&b, "%s%s\n", dashKey.Render(fmt.Sprintf("  %-12s", r[0])), dashVal.Render(r[1]))
	}
	return dashPanel.Render(strings.TrimRight(b.String(), "\n"))
}

// renderDashboard renders a HelpDashboard / StatsDashboard / DataTableDashboard message into a
// bordered panel (Ink Dashboards.tsx + Transcript MessageRow).
func renderDashboard(me MessageEntry) string {
	var b strings.Builder
	switch me.UIComponent {
	case "HelpDashboard":
		var p HelpPayload
		_ = json.Unmarshal(me.Payload, &p)
		fmt.Fprintf(&b, "%s\n", dashTitle.Render("Commands"))
		for _, sec := range p.Sections {
			fmt.Fprintf(&b, "%s\n", dashColor(sec.Color).Render(sec.Title))
			for _, c := range sec.Commands {
				fmt.Fprintf(&b, "%s%s\n", dashKey.Render(fmt.Sprintf("  %-14s", c.Cmd)), dashVal.Render(c.Desc))
			}
		}
	case "StatsDashboard":
		var p StatsPayload
		_ = json.Unmarshal(me.Payload, &p)
		if p.Title != "" {
			fmt.Fprintf(&b, "%s\n", dashTitle.Render(p.Title))
		}
		for _, it := range p.Items {
			// Trailing space guarantees a gap even when the label is >= the 20-col pad (e.g. "Tokens saved
			// (session)" or a long model id) — otherwise the value butts straight against the label.
			fmt.Fprintf(&b, "%s%s\n", dashKey.Render(fmt.Sprintf("  %-20s ", it.Label)), dashVal.Render(it.Value))
		}
	case "DataTableDashboard":
		var p DataTablePayload
		_ = json.Unmarshal(me.Payload, &p)
		if p.Title != "" {
			fmt.Fprintf(&b, "%s\n", dashTitle.Render(p.Title))
		}
		if len(p.Headers) > 0 {
			fmt.Fprintf(&b, "%s\n", dashColor("cyan").Render(tableRow(p.Headers)))
		}
		for _, row := range p.Rows {
			fmt.Fprintf(&b, "%s\n", dashVal.Render(tableRow(row)))
		}
	}
	return dashPanel.Render(strings.TrimRight(b.String(), "\n"))
}

// tableRow lays out a data-table row: first column 15 wide, the rest 30 (Ink DataTableDashboard).
func tableRow(cells []string) string {
	var parts []string
	for i, c := range cells {
		w := 30
		if i == 0 {
			w = 15
		}
		parts = append(parts, fmt.Sprintf("%-*s", w, clip(c, w-1)))
	}
	return strings.Join(parts, " ")
}
