package main

import (
	"encoding/json"
	"fmt"
	"image"
	_ "image/png"
	"os"
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
	"OutcomeTool":       "Outcome",
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
	if tc.ToolName == "ComputerTool" {
		var result struct {
			Summary string `json:"summary"`
		}
		if json.Unmarshal([]byte(tc.Output), &result) == nil && result.Summary != "" {
			return clip(result.Summary, 100)
		}
	}
	lines := strings.Split(out, "\n")
	preview := clip(lines[0], 80)
	// Edit cards render their actual diff directly below this summary. Reporting the number of
	// ENGINE-OUTPUT lines here (header + hunk + markers) as "(+18 lines)" looked like a second,
	// contradictory edit count beside "Added 10 lines". Keep only the action/path; editStats owns
	// the real added/removed counts.
	if isMutatingTool(tc.ToolName) && extractDiff(tc.Output) != "" {
		return strings.TrimSuffix(preview, ":")
	}
	if len(lines) > 1 {
		return fmt.Sprintf("%s (+%d lines)", preview, len(lines)-1)
	}
	return preview
}

func computerScreenshotPath(tc ToolCall) string {
	if tc.ToolName != "ComputerTool" || tc.Status == "running" || tc.Output == "" {
		return ""
	}
	var result struct {
		Screenshot string `json:"screenshot"`
	}
	if json.Unmarshal([]byte(tc.Output), &result) != nil {
		return ""
	}
	return result.Screenshot
}

// screenshotThumbsEnabled reports whether the user opted into inline pixel thumbnails. Default OFF:
// a see→act loop captures a screen on EVERY action, so rendering each one as blocky half-block
// pixels turned the transcript into unreadable image spam. The compact card names the exact file so
// it stays inspectable; BIMAX_COMPUTER_THUMBS=1 brings the inline pixel preview back for debugging.
func screenshotThumbsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("BIMAX_COMPUTER_THUMBS"))) {
	case "1", "true", "on", "yes":
		return true
	}
	return false
}

// renderScreenshotCard returns a compact one-line reference to a captured screenshot — an icon, its
// pixel dimensions (read from the PNG header without decoding the pixels), and the file's base name
// — instead of dumping the image into scrollback. Returns "" when the summary already names the file
// (screenshot/observe summaries do), so the card only appears where it adds information (clicks,
// typing, drags — actions whose summary would otherwise not mention that a screen was captured).
func renderScreenshotCard(path, summary string) string {
	if path == "" {
		return ""
	}
	name := path
	if i := strings.LastIndexByte(path, '/'); i >= 0 {
		name = path[i+1:]
	}
	if name != "" && strings.Contains(summary, name) {
		return ""
	}
	dims := ""
	if f, err := os.Open(path); err == nil {
		if cfg, _, derr := image.DecodeConfig(f); derr == nil {
			dims = fmt.Sprintf("%d×%d ", cfg.Width, cfg.Height)
		}
		_ = f.Close()
	}
	return subtleStyle.Render("▣ " + captureScope(name) + " " + dims + "· " + name)
}

// captureScope names what a capture actually covers, read from the file the engine wrote: a
// window-scoped PNG is `window-<ts>.png`, a whole-display one is `shot-<ts>.png`.
//
// This card used to say "screen" for every capture. A window capture of TextEdit was therefore
// presented as `▣ screen 1568×1538`, which reads as a full-screen grab — and in a real session the
// model went on to describe that file to the user as "a full-display screenshot showing both
// Calculator and TextEdit windows". It showed one window. The label should not be the part of the
// transcript that makes a false claim easy to believe.
func captureScope(name string) string {
	switch {
	case strings.HasPrefix(name, "window-"):
		return "window"
	case strings.HasPrefix(name, "shot-"):
		return "display"
	default:
		return "capture"
	}
}

// renderScreenshotThumbnail turns a native PNG into a compact true-colour terminal image. Each
// `▀` carries one source sample in its foreground and one in its background, so it works in an
// ordinary terminal without Kitty/iTerm-specific image protocols. Debug-only (see
// screenshotThumbsEnabled); the normal transcript uses renderScreenshotCard.
func renderScreenshotThumbnail(path string, maxCols int) string {
	if path == "" || maxCols < 8 {
		return ""
	}
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return ""
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 1 || h < 1 {
		return ""
	}
	cols := maxCols
	if cols > 44 {
		cols = 44
	}
	rows := (h*cols + 2*w - 1) / (2 * w)
	if rows > 18 {
		rows = 18
		cols = (2*w*rows + h - 1) / h
	}
	if cols < 1 {
		cols = 1
	}
	var out strings.Builder
	for row := 0; row < rows; row++ {
		if row > 0 {
			out.WriteByte('\n')
		}
		for col := 0; col < cols; col++ {
			x := b.Min.X + min(w-1, col*w/cols)
			yTop := b.Min.Y + min(h-1, (2*row)*h/(2*rows))
			yBottom := b.Min.Y + min(h-1, (2*row+1)*h/(2*rows))
			r1, g1, b1, _ := img.At(x, yTop).RGBA()
			r2, g2, b2, _ := img.At(x, yBottom).RGBA()
			fmt.Fprintf(&out, "\x1b[38;2;%d;%d;%d;48;2;%d;%d;%dm▀", r1>>8, g1>>8, b1>>8, r2>>8, g2>>8, b2>>8)
		}
		out.WriteString("\x1b[0m")
	}
	return out.String()
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
	case "EditFileTool", "MultiEditTool", "WriteFileTool", "SymbolEditTool":
	default:
		return ""
	}
	// The returned unified diff is the source of truth. Counting the WriteFileTool's full `content`
	// treated every unchanged/context line as newly added and could never report removals, producing
	// nonsense such as "Added 14 lines, removed 0" above a visibly red four-line replacement.
	if diff := extractDiff(tc.Output); diff != "" {
		added, removed := 0, 0
		for _, row := range parseDiffRows(diff) {
			switch row.sign {
			case '+':
				added++
			case '-':
				removed++
			}
		}
		if added > 0 || removed > 0 {
			return fmt.Sprintf("Added %d lines, removed %d lines", added, removed)
		}
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
	header := dot.Render("● ")
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
	var screenshotBlock string
	if tc.Status != "error" {
		switch tc.ToolName {
		case "EditFileTool", "MultiEditTool", "WriteFileTool":
			if d := extractDiff(tc.Output); d != "" {
				// Background fills to the right edge: terminal width minus the gutter+indent the diff sits under.
				diffW := termWidth - len(indent) - 4 - 6
				diffBlock = "\n" + indentLines(renderDiff(d, 20, diffW, diffPath(tc.Input)), indent+"    ")
			}
		}
		if shot := computerScreenshotPath(tc); shot != "" {
			if screenshotThumbsEnabled() {
				thumbW := termWidth - len(indent) - 6
				if thumb := renderScreenshotThumbnail(shot, thumbW); thumb != "" {
					screenshotBlock = "\n" + indentLines(thumb, indent+"    ")
				}
			} else if card := renderScreenshotCard(shot, summary); card != "" {
				screenshotBlock = "\n" + indent + "    " + card
			}
		}
	}
	if summary == "" && diffBlock == "" && screenshotBlock == "" {
		return indent + header
	}
	sumStyle := lipgloss.Style(dimStyle)
	if tc.Status == "error" {
		sumStyle = errStyle
	}
	out := indent + header
	if summary != "" {
		out += "\n" + indent + "  " + toolGut.Render("└ ") + sumStyle.Render(summary)
	}
	return out + diffBlock + screenshotBlock
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
	case "EditFileTool", "MultiEditTool", "WriteFileTool", "SymbolEditTool":
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
		if isMutatingTool(tc.ToolName) || tc.ToolName == "ComputerTool" {
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

// upsertSubAgentTool records a sub-agent's tool call under its spawn (tc.ParentID), filling the same
// slot on pending→running→done so the panel shows one row per call with a live status. Never touches
// the parent's turnTools/scrollback — sub-agent work stays nested under its agent card.
func (m *model) upsertSubAgentTool(tc ToolCall) {
	if m.subAgentTools == nil {
		m.subAgentTools = map[string][]ToolCall{}
	}
	run := m.subAgentTools[tc.ParentID]
	for i := range run {
		if tc.ID != "" && run[i].ID == tc.ID {
			run[i] = tc
			m.subAgentTools[tc.ParentID] = run
			return
		}
	}
	m.subAgentTools[tc.ParentID] = append(run, tc)
}

// latestSubAgentTool returns the most recent tool call for a spawn (last in start order), or a zero
// ToolCall (ToolName=="") if the agent hasn't run one yet.
func (m model) latestSubAgentTool(taskID string) ToolCall {
	run := m.subAgentTools[taskID]
	if len(run) == 0 {
		return ToolCall{}
	}
	return run[len(run)-1]
}

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
	// Task/plan bookkeeping is NOT a code edit. This must be checked before the Edit/Write
	// substring rule below, or TodoWriteTool (task-list updates) lands in "edits" and a
	// read-only run reports phantom edits — making the agent look like it lied about touching code.
	case strings.Contains(name, "Todo") || strings.Contains(name, "Task") || strings.Contains(name, "Plan"):
		return "other"
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
	head := toolDot.Render("● ") + toolLabel.Render(fmt.Sprintf("%d tool calls", len(run)))
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
