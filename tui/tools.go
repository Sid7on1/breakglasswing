package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// toolLabels maps tool class names to short action labels so lines read like actions, not classes
// (mirrors TOOL_LABELS in ToolCallLine.tsx).
var toolLabels = map[string]string{
	"BashTool": "Bash", "ReadFileTool": "Read", "WriteFileTool": "Write", "EditFileTool": "Edit",
	"MultiEditTool": "MultiEdit", "DeleteTool": "Delete", "CreateDirectoryTool": "mkdir",
	"ChangeDirectoryTool": "cd", "GrepTool": "Grep", "GlobTool": "Glob", "WebFetchTool": "Fetch",
	"TodoWriteTool": "Todo", "GraphQueryTool": "Graph", "MemoryQueryTool": "Memory",
	"SpawnSubagentTool": "Subagent", "RegisterAgentTool": "RegisterAgent", "AskUserTool": "Ask",
	"SkillTool": "Skill", "McpManageTool": "MCP",
}

func toolLabelFor(name string) string {
	if l, ok := toolLabels[name]; ok {
		return l
	}
	return strings.TrimSuffix(name, "Tool")
}

// summarizeToolInput pulls the most meaningful argument (command/path/pattern/…) for the header,
// truncated, mirroring summarizeInput() in ToolCallLine.tsx.
func summarizeToolInput(input string) string {
	var p map[string]any
	if json.Unmarshal([]byte(input), &p) == nil {
		for _, k := range []string{"command", "filePath", "path", "pattern", "glob", "url", "query", "question", "directory", "name", "action"} {
			if v, ok := p[k].(string); ok && v != "" {
				return clip(strings.ReplaceAll(v, "\n", " "), 70)
			}
		}
		return ""
	}
	return clip(strings.ReplaceAll(input, "\n", " "), 70)
}

// bashOutput unwraps BashTool's {stdout,stderr} JSON; other tools return their raw output.
func bashOutput(tc ToolCall) string {
	if tc.ToolName == "BashTool" {
		var o struct {
			Stdout string `json:"stdout"`
			Stderr string `json:"stderr"`
		}
		if json.Unmarshal([]byte(tc.Output), &o) == nil && (o.Stdout != "" || o.Stderr != "") {
			return strings.TrimSpace(strings.TrimSpace(o.Stdout) + "\n" + strings.TrimSpace(o.Stderr))
		}
	}
	return strings.TrimSpace(tc.Output)
}

// summarizeToolOutput renders the one-line "⎿" summary: first line + "(+N lines)", mirroring
// summarizeOutput() in ToolCallLine.tsx.
func summarizeToolOutput(tc ToolCall) string {
	out := bashOutput(tc)
	if out == "" {
		if tc.Status == "success" {
			return "Done"
		}
		return ""
	}
	lines := strings.Split(out, "\n")
	preview := clip(lines[0], 80)
	if len(lines) > 1 {
		return fmt.Sprintf("%s (+%d lines)", preview, len(lines)-1)
	}
	return preview
}

// toolDuration returns a "0.1s" timing badge from the ISO start/end timestamps, or "" if absent.
func toolDuration(tc ToolCall) string {
	if tc.StartTime == "" || tc.EndTime == "" {
		return ""
	}
	start, err1 := time.Parse(time.RFC3339, tc.StartTime)
	end, err2 := time.Parse(time.RFC3339, tc.EndTime)
	if err1 != nil || err2 != nil {
		return ""
	}
	d := end.Sub(start).Seconds()
	if d < 0 {
		return ""
	}
	return fmt.Sprintf("%.1fs", d)
}

// editStats reports "Added N lines, removed M lines" for write/edit tools, parsed from the diff-ish
// output or oldString/newString args, mirroring ToolCallLine.tsx's edit summary.
func editStats(tc ToolCall) string {
	switch tc.ToolName {
	case "EditFileTool", "MultiEditTool", "WriteFileTool":
	default:
		return ""
	}
	var p struct {
		OldString string `json:"oldString"`
		NewString string `json:"newString"`
		Content   string `json:"content"`
	}
	_ = json.Unmarshal([]byte(tc.Input), &p)
	added, removed := 0, 0
	if p.NewString != "" || p.OldString != "" {
		added = strings.Count(p.NewString, "\n") + 1
		removed = strings.Count(p.OldString, "\n") + 1
		if p.NewString == "" {
			added = 0
		}
		if p.OldString == "" {
			removed = 0
		}
	} else if p.Content != "" {
		added = strings.Count(p.Content, "\n") + 1
	}
	if added == 0 && removed == 0 {
		return ""
	}
	return fmt.Sprintf("Added %d lines, removed %d lines", added, removed)
}

// renderToolCall draws one tool entry the Ink way: a status dot, the bold label, dim (args), a
// timing badge, and an indented ⎿ summary line. Sub-agent calls get an [agentLabel] prefix and a
// 2-space indent. Running calls show no summary yet; errors show the summary in red.
func renderToolCall(tc ToolCall, termWidth int) string {
	dot := toolDot
	switch tc.Status {
	case "error":
		dot = toolDotE
	case "running", "":
		dot = toolDotW
	}
	indent := "  "
	if tc.AgentLabel != "" {
		indent = "    " // sub-agent work nests under its spawner
	}
	header := dot.Render("⏺ ")
	if tc.AgentLabel != "" {
		header += agentBadge.Render("[" + tc.AgentLabel + "] ")
	}
	header += toolLabel.Render(toolLabelFor(tc.ToolName))
	if in := summarizeToolInput(tc.Input); in != "" {
		header += toolArgs.Render("(" + in + ")")
	}
	if d := toolDuration(tc); d != "" && tc.Status != "running" && tc.Status != "" {
		header += toolGut.Render(" · " + d)
	}
	if tc.Status == "running" || tc.Status == "" {
		return indent + header
	}
	summary := summarizeToolOutput(tc)
	if stats := editStats(tc); stats != "" {
		if summary == "" || summary == "Done" {
			summary = stats
		} else {
			summary = stats + " · " + summary
		}
	}
	// For edit/write tools, show the actual colorized diff (green adds, red deletes) like Claude
	// Code — the engine returns a unified diff (@@ hunks) in the output. Shown below the summary.
	var diffBlock string
	if tc.Status != "error" {
		switch tc.ToolName {
		case "EditFileTool", "MultiEditTool", "WriteFileTool":
			if d := extractDiff(tc.Output); d != "" {
				// Background fills to the right edge: terminal width minus the gutter+indent the diff sits under.
				diffW := termWidth - len(indent) - 4 - 6
				diffBlock = "\n" + indentLines(renderDiff(d, 20, diffW, diffPath(tc.Input)), indent+"    ")
			}
		}
	}
	if summary == "" && diffBlock == "" {
		return indent + header
	}
	sumStyle := lipgloss.Style(dimStyle)
	if tc.Status == "error" {
		sumStyle = errStyle
	}
	out := indent + header
	if summary != "" {
		out += "\n" + indent + "  " + toolGut.Render("⎿ ") + sumStyle.Render(summary)
	}
	return out + diffBlock
}

// extractDiff returns the unified-diff portion of a tool's output (from the first @@ hunk), or "" if
// there is none — so non-edit output never gets diff-colorized.
func extractDiff(out string) string {
	if i := strings.Index(out, "@@"); i >= 0 {
		return out[i:]
	}
	return ""
}

// toolCollapseThreshold is how many consecutive tool calls trigger collapse into category counts.
const toolCollapseThreshold = 5

func isMutatingTool(name string) bool {
	switch name {
	case "EditFileTool", "MultiEditTool", "WriteFileTool":
		return true
	}
	return false
}

// formatRun processes a list of tools. If collapse is true, it groups consecutive non-mutating
// tools and collapses them into a summary line if the group size >= toolCollapseThreshold. Mutating
// tools (edits/writes) are ALWAYS rendered fully expanded.
func formatRun(run []ToolCall, width int, collapse bool) []string {
	var out []string
	if !collapse {
		for _, tc := range run {
			out = append(out, renderToolCall(tc, width))
		}
		return out
	}

	var boring []ToolCall
	flushBoring := func() {
		if len(boring) == 0 {
			return
		}
		if len(boring) >= toolCollapseThreshold {
			out = append(out, toolRunSummary(boring))
		} else {
			for _, tc := range boring {
				out = append(out, renderToolCall(tc, width))
			}
		}
		boring = nil
	}

	for _, tc := range run {
		if isMutatingTool(tc.ToolName) {
			flushBoring()
			out = append(out, renderToolCall(tc, width))
		} else {
			boring = append(boring, tc)
		}
	}
	flushBoring()
	return out
}

// toolFinished reports whether a tool call has returned a result (any status other than the
// pending/running placeholder). A finished tool can commit to scrollback; a running one cannot.
func toolFinished(tc ToolCall) bool { return tc.Status != "running" && tc.Status != "" }

// toolIdx returns the index of the tool with id in turnTools, or -1.
func (m *model) toolIdx(id string) int {
	for i := range m.turnTools {
		if m.turnTools[i].ID == id {
			return i
		}
	}
	return -1
}

// hasRunningTool reports whether any tool in the current run is still executing.
func (m model) hasRunningTool() bool {
	for _, tc := range m.turnTools {
		if !toolFinished(tc) {
			return true
		}
	}
	return false
}

// runningToolCount counts tools still executing (for the "Running N tools…" indicator).
func (m model) runningToolCount() int {
	n := 0
	for _, tc := range m.turnTools {
		if !toolFinished(tc) {
			n++
		}
	}
	return n
}

// flushToolRun commits the FINISHED leading prefix of the current tool run to scrollback, stopping
// at the first still-running tool so committed order matches start order and nothing lands before
// its result is known. The still-running tail stays live in View.
func (m *model) flushToolRun() {
	n := 0
	for n < len(m.turnTools) && toolFinished(m.turnTools[n]) {
		n++
	}
	if n == 0 {
		return
	}
	run := m.turnTools[:n]
	m.flushing = true
	for _, line := range formatRun(run, m.width, m.collapseTools) {
		m.append(line)
	}
	m.flushing = false
	m.turnTools = append(m.turnTools[:0:0], m.turnTools[n:]...) // keep the running tail in a fresh array
}

// toolCategory buckets a tool name for the collapsed summary.
func toolCategory(name string) string {
	switch {
	case strings.Contains(name, "Read") || strings.Contains(name, "Cat"):
		return "reads"
	case strings.Contains(name, "Edit") || strings.Contains(name, "Write"):
		return "edits"
	case strings.Contains(name, "Bash") || strings.Contains(name, "Shell"):
		return "bash"
	case strings.Contains(name, "Grep") || strings.Contains(name, "Glob") || strings.Contains(name, "Search") || strings.Contains(name, "Find"):
		return "searches"
	default:
		return "other"
	}
}

// toolRunSummary renders a collapsed run as "⏺ N tool calls · 4 reads · 2 edits · 1 bash (ctrl+b to expand)".
func toolRunSummary(run []ToolCall) string {
	counts := map[string]int{}
	order := []string{"reads", "edits", "bash", "searches", "other"}
	for _, tc := range run {
		counts[toolCategory(tc.ToolName)]++
	}
	var parts []string
	for _, cat := range order {
		if counts[cat] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", counts[cat], cat))
		}
	}
	head := toolDot.Render("⏺ ") + toolLabel.Render(fmt.Sprintf("%d tool calls", len(run)))
	body := toolArgs.Render(" · " + strings.Join(parts, " · "))
	hint := subtleStyle.Render("  (ctrl+b to expand)")
	return head + body + hint
}

// toolRunLive renders the whole current tool run (running + finished, in start order) for the live
// region — each tool in its fixed slot, filling in place as results arrive.
func (m model) toolRunLive() string {
	if len(m.turnTools) == 0 {
		return ""
	}
	lines := formatRun(m.turnTools, m.width, m.collapseTools)
	return strings.Join(lines, "\n")
}
