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

// subAgentPanel is the terminal analogue of the GUI's inline collapsible sub-agent cards. It renders
// a live panel — pinned in the bottom region because committed scrollback is immutable in this inline
// TUI — with one card per spawned agent. Collapsed, each card is a one-liner whose status tracks the
// agent's LATEST tool live (Running <cmd> / Reading <file> tui/ / task label / ✓done / ✗Failed). With
// Ctrl+A the panel takes focus; ↑/↓ select and enter expands the selected card to reveal its PROMPT,
// full TOOLS list, and OUTPUT. Shown while any agent runs or any card is still expanded, else "".
func (m model) subAgentPanel() string {
	if len(m.subagents) == 0 {
		return ""
	}
	running := 0
	for _, s := range m.subagents {
		if s.Status == "running" {
			running++
		}
	}
	// While agents run, the panel is always up (live monitoring). Once they've all finished it retires
	// unless you're actively inspecting it (Ctrl+A focus) — so it never lingers as dead chrome, and the
	// durable record is the parent's synthesized reply, not this transient panel.
	if running == 0 && !m.saFocus {
		return ""
	}
	// Border (2) + padding (2) + cursor/glyph (2) = 6 cells of chrome around the text.
	textW := m.width - 7
	if textW < 16 {
		textW = 16
	}
	titleText := fmt.Sprintf("Sub-agents (%d running/%d)", running, len(m.subagents))
	hintText := ""
	if m.saFocus {
		hintText = "  ↑/↓ select · enter expand · esc release"
	} else if running > 0 {
		hintText = "  Ctrl+A to inspect"
	}
	title := todoTitle.Render(titleText)
	// Only append the hint when it fits — on a narrow terminal it's dropped rather than overflowing
	// the box border (a ragged border is the difference between polished and janky).
	if hintText != "" && len(titleText)+len(hintText) <= textW {
		title += subtleStyle.Render(hintText)
	}

	const maxShow = 6
	var b strings.Builder
	b.WriteString(title + "\n")
	for i, s := range m.subagents {
		if i >= maxShow {
			b.WriteString(dimStyle.Render(fmt.Sprintf("  … +%d more", len(m.subagents)-maxShow)) + "\n")
			break
		}
		cursor := "  "
		if m.saFocus && i == m.saSel {
			cursor = userStyle.Render("❯ ")
		}
		// The expand affordance (chevron) only shows while focused — the unfocused monitor stays clean.
		chevron := "  "
		if m.saFocus {
			chevron = subtleStyle.Render("▸ ")
			if m.saExpanded[s.TaskID] {
				chevron = subtleStyle.Render("▾ ")
			}
		}
		// Leading status glyph: a live animated spinner while running, a green ✓ / red ✗ once finished —
		// this is what makes a running agent read as ALIVE instead of a static gray line.
		var glyph string
		switch s.Status {
		case "done":
			glyph = okStyle.Render("✓")
		case "failed":
			glyph = errStyle.Render("✗")
		default:
			glyph = saSpin.Render(m.saSpinner())
		}
		// <spinner> 🤖 SubAgent <type> · <live status>. Fixed prefix is short; only the status is clipped.
		head := cursor + chevron + glyph + " " + saRobot.Render("🤖") + dimStyle.Render(" SubAgent ") +
			saType.Render(s.AgentType) + dimStyle.Render(" · ") + m.subAgentStatus(s, textW-26)
		b.WriteString(head + "\n")
		// Detail cards only when the panel is focused — the unfocused view is a clean one-line-per-agent
		// live monitor; you opt into the heavy prompt/tools/output detail with Ctrl+A + enter.
		if m.saFocus && m.saExpanded[s.TaskID] {
			b.WriteString(m.subAgentDetail(s, textW))
		}
	}
	// Fixed content width (not auto-hug): the panel keeps ONE stable width instead of resizing on every
	// streamed tool action — a calm, non-jittering box reads as far more polished. textW < m.width so
	// the bordered box never reaches the last column, which would auto-wrap and cost a second row
	// (see TestViewLinesStayInsideLastColumn).
	return todoPanel.Width(textW).Render(strings.TrimRight(b.String(), "\n"))
}

// subAgentStatus is the live right-hand side of a collapsed card: a terminal badge once the agent is
// done/failed, else the current tool action (Running/Reading/…) while a tool is in flight, else the
// agent's task/scope label between tools. Mirrors the GUI's per-agent status that changes as it works.
func (m model) subAgentStatus(s SubAgent, budget int) string {
	if budget < 8 {
		budget = 8
	}
	// The leading row glyph already carries done/failed state, so the status text omits its own ✓/✗.
	switch s.Status {
	case "done":
		return okStyle.Render("done") + subtleStyle.Render(fmt.Sprintf(" · %d tools", s.ToolCalls))
	case "failed":
		msg := "failed"
		if s.Error != "" {
			msg += ": " + s.Error
		}
		return errStyle.Render(clip(msg, budget))
	}
	tc := m.latestSubAgentTool(s.TaskID)
	if tc.ToolName != "" {
		verb, target := subAgentAction(tc)
		if !toolFinished(tc) {
			// Live: the tool is running right now — bright verb + its target (the file/command/pattern).
			return saVerb.Render(verb+" ") + toolArgs.Render(clip(target, budget-len(verb)-1))
		}
		// Between tools (agent reasoning): keep the LAST activity visible with a "working…" hint instead
		// of reverting to the giant prompt — so the row always reflects what the agent is doing, not its
		// task text. The spinner glyph already signals it's alive.
		const hint = " · working…"
		return dimStyle.Render(clip(verb+" "+target, budget-len(hint))) + subtleStyle.Render(hint)
	}
	// No tool has run yet (agent still booting / first reasoning pass): a short "starting…" hint plus a
	// brief task clip — never the full multi-line prompt dumped into the row.
	if s.OutcomeTaskID != "" {
		phase := s.Phase
		if phase == "" {
			phase = "working"
		}
		return saVerb.Render(strings.ToUpper(phase)+" ") + toolArgs.Render(clip(s.OutcomeTaskID, clampInt(budget-len(phase)-1, 8, 60)))
	}
	label := firstLine(s.Prompt)
	if label == "" {
		label = firstLine(s.Scope)
	}
	return subtleStyle.Render("starting… ") + toolArgs.Render(clip(label, clampInt(budget-10, 8, 60)))
}

// subAgentDetail is the expanded card body: PROMPT, the agent's full TOOLS list (most recent last,
// oldest trimmed to a "+N earlier" line), and OUTPUT once done (or the error on failure).
func (m model) subAgentDetail(s SubAgent, textW int) string {
	ind := "     "
	iw := textW - len(ind)
	if iw < 12 {
		iw = 12
	}
	var b strings.Builder
	if s.Prompt != "" {
		b.WriteString(ind + subtleStyle.Render("PROMPT") + "\n")
		b.WriteString(ind + dimStyle.Render(clip(s.Prompt, iw)) + "\n")
	}
	run := m.subAgentTools[s.TaskID]
	if len(run) > 0 {
		count := len(run)
		label := fmt.Sprintf("TOOLS · %d", count)
		b.WriteString(ind + subtleStyle.Render(label) + "\n")
		const maxTools = 6
		start := 0
		if count > maxTools {
			start = count - maxTools
			b.WriteString(ind + dimStyle.Render(fmt.Sprintf("  … +%d earlier", start)) + "\n")
		}
		for _, tc := range run[start:] {
			b.WriteString(ind + subAgentToolLine(tc, iw) + "\n")
		}
	}
	switch {
	case s.Status == "done" && s.Result != "":
		b.WriteString(ind + subtleStyle.Render("OUTPUT") + "\n")
		for _, ln := range clipLines(s.Result, iw, 6) {
			b.WriteString(ind + dimStyle.Render(ln) + "\n")
		}
	case s.Status == "failed" && s.Error != "":
		b.WriteString(ind + errStyle.Render(clip(s.Error, iw)) + "\n")
	}
	return b.String()
}

// subAgentToolLine is a compact one-line tool entry for the expanded card: a status glyph, the action
// verb, and the target (a Read/Edit file shows "name dir/"; Bash/Grep show the command/pattern).
func subAgentToolLine(tc ToolCall, budget int) string {
	glyph, st := "◍", todoActive
	switch tc.Status {
	case "success":
		glyph, st = "✔", todoDone
	case "error":
		glyph, st = "✗", logErr
	}
	verb, target := subAgentAction(tc)
	line := verb + " " + target
	return st.Render(glyph+" ") + toolArgs.Render(clip(line, budget-2))
}

// subAgentAction maps a tool call to a human verb + target for the live status and tool list. File
// tools get "name dir/" (base + parent dir) like the GUI; command/search tools show the raw argument.
func subAgentAction(tc ToolCall) (verb, target string) {
	arg := summarizeToolInput(tc.Input)
	switch tc.ToolName {
	case "BashTool":
		return "Running", arg
	case "ReadFileTool":
		return "Reading", pathTail(arg)
	case "WriteFileTool":
		return "Writing", pathTail(arg)
	case "EditFileTool", "MultiEditTool":
		return "Editing", pathTail(arg)
	case "GrepTool":
		return "Searching", arg
	case "GlobTool":
		return "Globbing", arg
	case "WebFetchTool":
		return "Fetching", arg
	default:
		return toolLabelFor(tc.ToolName), arg
	}
}

// pathTail renders a path as "base parent/" (filename plus its immediate directory), the way the GUI
// shows "main.go tui/". Bare filenames (no slash) pass through unchanged.
func pathTail(p string) string {
	p = strings.TrimRight(strings.TrimSpace(p), "/")
	if p == "" {
		return ""
	}
	i := strings.LastIndex(p, "/")
	if i < 0 {
		return p
	}
	base := p[i+1:]
	parent := strings.Trim(p[:i], "/")
	if j := strings.LastIndex(parent, "/"); j >= 0 {
		parent = parent[j+1:]
	}
	if parent == "" {
		return base
	}
	return base + " " + parent + "/"
}

// clipLines splits text into up to max lines, each clipped to width; a truncated tail gets a "… +N
// more" line so a long sub-agent output can't blow out the panel height.
func clipLines(s string, width, max int) []string {
	raw := strings.Split(strings.TrimRight(s, "\n"), "\n")
	var out []string
	for _, ln := range raw {
		ln = strings.TrimRight(ln, "\r")
		if strings.TrimSpace(ln) == "" {
			continue
		}
		out = append(out, clip(ln, width))
		if len(out) >= max {
			if len(raw) > len(out) {
				out = append(out, fmt.Sprintf("… +%d more lines", len(raw)-len(out)))
			}
			break
		}
	}
	return out
}

// --- codebase map panel --------------------------------------------------------------------

// mapPanelView renders the right-aligned CodebaseMapPanel (Ink CodebaseMapPanel.tsx).
func (m model) mapPanelView() string {
	// Fix the inner content width so the box stays one column SHORT of the terminal. Border (2) +
	// padding (2) = 4 cols of chrome, plus 1 spare column so the placed line is m.width-1 wide. A
	// full-width line auto-wraps the cursor onto a second row, so the frame silently grows past the
	// height budget and the panel overflows when zoomed narrow. Keeping it < m.width fixes both.
	inner := m.width - 5
	if inner < 12 {
		return "" // too narrow for the panel — skip it rather than spill over the transcript
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s%s\n", mapHdr.Render("Codebase Map · "), mapVal.Render(fmt.Sprintf("%d nodes · %d files", m.graph.NodeCount, m.graph.FileCount)))
	if m.graph.Engine == "codebase-memory" {
		fmt.Fprintf(&b, "%s%s\n", mapHdr.Render("engine: "), logOK.Render("↯ codebase-memory · 158-lang · semantic"))
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
	// version) is measured as fitting but rendered wider, so the terminal wraps it and the frame
	// exceeds its row budget. A short left-aligned line cannot wrap however the glyph measures.
	var b strings.Builder
	if cbm {
		fmt.Fprintf(&b, "%s", logOK.Render("↯ codebase-memory"))
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

// taskStateIcon maps the 16-state machine to a compact glyph + style. Active states get the live
// spinner (rendered by the caller so animation stays centralized); this returns the static ones.
func taskStateIcon(state string) (glyph string, active bool) {
	switch state {
	case "queued":
		return "·", false
	case "paused":
		return "⏸", false
	case "waiting-user":
		return "⚑", false
	case "cancelled":
		return "⏹", false
	case "completed":
		return "✓", false
	case "failed", "failed-resumable":
		return "✗", false
	default:
		// starting/running/streaming/waiting-model/waiting-tool/waiting-browser/retrying/
		// recovering/cancelling — all live, all animated.
		return "", true
	}
}

func taskTerminal(state string) bool {
	switch state {
	case "cancelled", "completed", "failed", "failed-resumable":
		return true
	}
	return false
}

func fmtTaskElapsed(ms int64) string {
	s := ms / 1000
	if s < 60 {
		return fmt.Sprintf("%ds", s)
	}
	if s < 3600 {
		return fmt.Sprintf("%dm%02ds", s/60, s%60)
	}
	return fmt.Sprintf("%dh%02dm", s/3600, (s%3600)/60)
}

// taskActions returns the HONEST action hints for one task — exactly what the engine's capability
// flags and state admit, nothing more. The same set the keyboard handler accepts.
func taskActions(t TaskStrip) []string {
	var a []string
	if t.CanCancel && !taskTerminal(t.State) && t.State != "cancelling" {
		a = append(a, "c cancel")
	}
	if t.CanPause && (t.State == "running" || t.State == "streaming") {
		a = append(a, "p pause")
	}
	if t.State == "paused" && t.CanResume {
		a = append(a, "r resume")
	}
	if t.State == "failed-resumable" {
		a = append(a, "r retry")
	}
	if taskTerminal(t.State) {
		a = append(a, "d dismiss")
	}
	return a
}

// taskPanel is the pinned task-workspace strip: background shell commands, the live browser
// session, builds — each with live state from the 16-state machine and an honest action set.
// Unfocused it is a calm one-line-per-task monitor; Ctrl+E focuses it (↑/↓ select, enter inspect
// via /tasks show, c/p/r/d act). It shows while any task is live or demands attention, and
// retires once everything is dismissed — never dead chrome. On very narrow terminals it degrades
// to a one-line summary instead of overflowing the border.
func (m model) taskPanel() string {
	if len(m.fTasks) == 0 {
		return ""
	}
	live, attention := 0, 0
	for _, t := range m.fTasks {
		if !taskTerminal(t.State) {
			live++
		}
		if t.Attention {
			attention++
		}
	}
	// Terminal tasks without attention don't keep chrome alive (mirror subAgentPanel's retire rule).
	if live == 0 && attention == 0 && !m.tkFocus {
		return ""
	}
	// Narrow-terminal degradation: below ~48 cols a bordered multi-row panel wraps, and each wrapped
	// row eats another line of the height budget — collapse to one plain summary line instead.
	if m.width < 48 {
		s := fmt.Sprintf("◍ %d task", live)
		if live != 1 {
			s += "s"
		}
		if attention > 0 {
			s += fmt.Sprintf(" · %d need attention", attention)
		}
		return dimStyle.Render(clip(s+" — /tasks", m.width-2))
	}

	textW := m.width - 7
	if textW < 16 {
		textW = 16
	}
	titleText := fmt.Sprintf("Tasks (%d live/%d)", live, len(m.fTasks))
	hintText := ""
	if m.tkFocus {
		hintText = "  ↑/↓ select · enter inspect · esc release"
	} else {
		hintText = "  Ctrl+E to control"
	}
	title := todoTitle.Render(titleText)
	if hintText != "" && len(titleText)+len(hintText) <= textW {
		title += subtleStyle.Render(hintText)
	}

	const maxShow = 6
	var b strings.Builder
	b.WriteString(title + "\n")
	for i, t := range m.fTasks {
		if i >= maxShow {
			b.WriteString(dimStyle.Render(fmt.Sprintf("  … +%d more", len(m.fTasks)-maxShow)) + "\n")
			break
		}
		cursor := "  "
		if m.tkFocus && i == m.tkSel {
			cursor = userStyle.Render("❯ ")
		}
		var glyph string
		if icon, active := taskStateIcon(t.State); active {
			glyph = saSpin.Render(m.saSpinner())
		} else {
			switch t.State {
			case "completed":
				glyph = okStyle.Render(icon)
			case "failed", "failed-resumable":
				glyph = errStyle.Render(icon)
			case "waiting-user":
				glyph = saVerb.Render(icon)
			default:
				glyph = dimStyle.Render(icon)
			}
		}
		pin := ""
		if t.Pinned {
			pin = subtleStyle.Render(" ⚲")
		}
		att := ""
		if t.Attention {
			att = errStyle.Render(" !")
		}
		// <glyph> <title> — <state> · <kind> · <elapsed>. Only the title is clipped; the state/
		// elapsed suffix always survives so the row stays informative at any width.
		suffix := dimStyle.Render(fmt.Sprintf(" — %s · %s · %s", t.State, t.Kind, fmtTaskElapsed(t.ElapsedMs)))
		budget := clampInt(textW-30, 10, 60)
		row := cursor + glyph + " " + saVerb.Render(clip(t.Title, budget)) + suffix + pin + att
		b.WriteString(row + "\n")
		// The selected row (focused) reveals its last event + honest action keys; unfocused rows
		// stay one line each so the panel is a monitor, not a wall.
		if m.tkFocus && i == m.tkSel {
			if t.LastEvent != "" {
				b.WriteString("     " + dimStyle.Render(clip(t.LastEvent, textW-6)) + "\n")
			}
			if acts := taskActions(t); len(acts) > 0 {
				b.WriteString("     " + subtleStyle.Render(clip(strings.Join(acts, " · "), textW-6)) + "\n")
			}
		}
	}
	return todoPanel.Width(textW).Render(strings.TrimRight(b.String(), "\n"))
}
