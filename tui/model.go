package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/textarea"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Bubble Tea messages wrapping engine events so they flow through Update like any other tea.Msg.
type engineMsg Outbound
type engineClosed struct{}

// waitForEngine blocks on the engine channel and delivers the next message as a tea.Msg. Re-issued
// after every engine message so the stream is continuous — the standard Bubble Tea external-IO loop.
func waitForEngine(e *Engine) tea.Cmd {
	return func() tea.Msg {
		m, ok := <-e.Msgs
		if !ok {
			return engineClosed{}
		}
		return engineMsg(m)
	}
}

type model struct {
	engine *Engine
	vp     viewport.Model
	input  textarea.Model // multi-line: Enter submits, Ctrl+J inserts a newline (paste code blocks)
	spin   spinner.Model  // animated while a turn runs (busy); idle otherwise

	// input history — up/down recalls past submissions (a ring buffer). histIdx == len(history)
	// means "editing a fresh line"; histStash holds that in-progress line while browsing back.
	history  []string
	histIdx  int
	histStash string

	lines    []string // committed transcript
	stream   string   // in-flight assistant tokens (replaced by the final message)
	status   string
	ready    bool
	busy     bool   // a turn is executing — Ctrl+C cancels it instead of quitting
	quitting bool   // engine asked us to shut down — quit after this message
	cwd      string // working directory, updated by cwd_changed
	width    int
	height   int

	// live task list (todo_update). Rendered as a checklist panel; deduped so repeated identical
	// updates don't spam the transcript.
	todos          []TodoItem
	lastTodoRender string

	// pending approval (from a `request` message)
	reqOpen bool
	reqID   int
	reqQ    string
	reqOpts []string
	reqKind string // "prompt" | "diff"
	reqBody string // diff text for kind:"diff"

	// autocomplete (slash commands + @-mentions), served by the engine
	comps    []CompletionItem
	compIdx  int
	compOpen bool
	queryID  int

	// interactive menu (command palette, pickers) — selecting sends the option's value as input
	menuOpen  bool
	menuTitle string
	menuOpts  []menuOption
	menuIdx   int

	welcomed bool // the low-chrome welcome banner has been shown once at the top of the transcript

	// tool-call lines, indexed by call id so a tool_call_result updates its line in place (Ink
	// re-rendered the same component) instead of printing a second row.
	toolLine map[string]int

	// footer state (mirrors Ink's Footer.tsx)
	fTier   string // "lite" | "heavy"
	fPinned string // pinned tier, if any
	fMode   string // governor / agent mode
	fTokens int    // running session token estimate
	fCoding string // coding model id
	fLite   string // lite model id
	fGoals  int    // active goal count
}

func initialModel(e *Engine) model {
	ta := textarea.New()
	ta.Placeholder = "Ask BiMax…"
	ta.Prompt = "❯ "
	ta.CharLimit = 0
	ta.ShowLineNumbers = false
	ta.SetHeight(1) // grows up to inputMaxRows as the user adds lines
	// The bubbles default focused style paints CursorLine with a solid black background and fills the
	// end-of-buffer — which renders as a "black box" inside the input and a stray box at the right.
	// Strip all of that so the field is just the accent caret + bright text on the terminal bg.
	clean := func(s textarea.Style) textarea.Style {
		s.Base = lipgloss.NewStyle()
		s.CursorLine = lipgloss.NewStyle()
		s.CursorLineNumber = lipgloss.NewStyle()
		s.EndOfBuffer = lipgloss.NewStyle()
		s.Prompt = caretStyle
		s.Text = asstStyle
		s.Placeholder = subtleStyle
		return s
	}
	ta.FocusedStyle = clean(ta.FocusedStyle)
	ta.BlurredStyle = clean(ta.BlurredStyle)
	// Enter submits (handled in Update before the textarea sees it); Ctrl+J inserts a newline so
	// a pasted code block stays one input.
	ta.KeyMap.InsertNewline = key.NewBinding(key.WithKeys("ctrl+j"))
	ta.Focus()

	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(colAccent)

	return model{
		engine:   e,
		input:    ta,
		spin:     sp,
		histIdx:  0,
		vp:       viewport.New(80, 20),
		status:   "starting engine…",
		toolLine: map[string]int{},
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(waitForEngine(m.engine), textarea.Blink, m.spin.Tick)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		// The input sits inside promptBox (rounded border + 1-col padding each side) whose total
		// width is m.width-2, so its content area — and thus the input — is m.width-6. Matching this
		// exactly stops the textarea from overrunning the right border into a stray box.
		m.input.SetWidth(msg.Width - 6)
		m.relayout()
		return m, nil

	case spinner.TickMsg:
		// Keep the frame animating; it's only painted while busy (see View).
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd

	case tea.KeyMsg:
		// Request overlay captures input until answered.
		if m.reqOpen {
			if m.reqKind == "input" {
				// Free-form text prompt — the input box becomes the answer field.
				switch msg.String() {
				case "ctrl+c":
					m.engine.Close()
					return m, tea.Quit
				case "esc":
					m.input.SetValue("")
					m.answer("")
					return m, nil
				case "enter":
					val := m.input.Value()
					m.input.SetValue("")
					m.answer(val)
					return m, nil
				}
				var cmd tea.Cmd
				m.input, cmd = m.input.Update(msg)
				return m, cmd
			}
			// Option / diff approval — number keys + esc.
			switch msg.String() {
			case "ctrl+c":
				m.engine.Close()
				return m, tea.Quit
			case "esc":
				m.answer(firstOr(m.reqOpts, ""))
				return m, nil
			default:
				if n := digit(msg.String()); n >= 1 && n <= len(m.reqOpts) {
					m.answer(m.reqOpts[n-1])
				}
				return m, nil
			}
		}

		// Interactive menu (command palette / picker) captures navigation + selection.
		if m.menuOpen {
			switch msg.String() {
			case "ctrl+c":
				m.engine.Close()
				return m, tea.Quit
			case "esc":
				m.menuOpen = false
				m.relayout()
				return m, nil
			case "up", "ctrl+p":
				m.menuIdx = (m.menuIdx - 1 + len(m.menuOpts)) % len(m.menuOpts)
				return m, nil
			case "down", "ctrl+n":
				m.menuIdx = (m.menuIdx + 1) % len(m.menuOpts)
				return m, nil
			case "enter":
				val := m.menuOpts[m.menuIdx].Value
				m.menuOpen = false
				m.relayout()
				if val != "" {
					m.engine.Send(encodeInput(val)) // selecting runs the option (e.g. a /command)
				}
				return m, nil
			}
			return m, nil // swallow other keys while the menu is open
		}

		// Completion-dropdown navigation takes priority while it's open.
		if m.compOpen {
			switch msg.String() {
			case "esc":
				m.compOpen = false
				m.relayout()
				return m, nil
			case "up", "ctrl+p":
				m.compIdx = (m.compIdx - 1 + len(m.comps)) % len(m.comps)
				return m, nil
			case "down", "ctrl+n":
				m.compIdx = (m.compIdx + 1) % len(m.comps)
				return m, nil
			}
		}

		// Input history: up/down at the first/last line recalls past submissions. Mid-text they move
		// the cursor between lines (textarea), so only intercept at the boundaries.
		switch msg.String() {
		case "up":
			if m.input.Line() == 0 && len(m.history) > 0 {
				m.histPrev()
				m.syncInputHeight()
				m.relayout()
				return m, nil
			}
		case "down":
			if m.input.Line() == m.input.LineCount()-1 && m.histIdx < len(m.history) {
				m.histNext()
				m.syncInputHeight()
				m.relayout()
				return m, nil
			}
		}

		switch msg.String() {
		case "ctrl+c":
			// While a turn runs, Ctrl+C cancels it (cooperatively, engine-side) and keeps the
			// session alive. When idle, it quits. So mid-turn it takes two presses to exit:
			// first cancels, second (now idle) quits.
			if m.busy {
				m.engine.Send(encodeInterrupt())
				return m, nil
			}
			m.engine.Close()
			return m, tea.Quit
		case "pgup", "pgdown", "ctrl+u", "ctrl+d", "shift+up", "shift+down":
			var cmd tea.Cmd
			m.vp, cmd = m.vp.Update(msg) // scroll the transcript without touching the input
			return m, cmd
		case "ctrl+g":
			// Command palette: prefill "/" and surface the slash-command dropdown (type to filter).
			m.input.SetValue("/")
			m.input.CursorEnd()
			m.requestCompletions()
			return m, nil
		case "tab":
			if m.compOpen {
				m.acceptCompletion()
			}
			m.requestCompletions() // open, or refine after accept (e.g. descend a dir)
			return m, nil
		case "enter":
			text := strings.TrimSpace(m.input.Value())
			if text != "" {
				m.engine.Send(encodeInput(text)) // engine echoes the user message back
				m.pushHistory(text)
				m.input.SetValue("")
				m.input.SetHeight(1)
			}
			m.compOpen = false
			m.relayout()
			return m, nil
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		m.syncInputHeight()    // grow/shrink the box as lines are added (Ctrl+J) or removed
		m.requestCompletions() // refresh candidates for the new input
		m.relayout()
		return m, cmd

	case engineMsg:
		m.handleEngine(Outbound(msg))
		if m.quitting { // engine emitted `shutdown` — exit cleanly
			m.engine.Close()
			return m, tea.Quit
		}
		return m, waitForEngine(m.engine) // keep listening

	case engineClosed:
		m.status = "engine exited"
		m.append(errStyle.Render("— engine process exited —"))
		return m, nil
	}

	var cmd tea.Cmd
	m.vp, cmd = m.vp.Update(msg)
	return m, cmd
}

func (m *model) handleEngine(o Outbound) {
	switch o.T {
	case "ready":
		m.ready = true
		m.status = "Ready"
		m.showWelcome()

	case "request":
		m.reqOpen = true
		m.reqID = o.ID
		m.reqQ = o.Question
		m.reqOpts = o.Options
		m.reqKind = o.Kind
		m.reqBody = o.Body

	case "queryResult":
		if o.ID == m.queryID { // ignore stale results from earlier keystrokes
			m.comps = o.Items
			m.compIdx = 0
			m.compOpen = len(o.Items) > 0
			m.relayout()
		}

	case "event":
		m.handleEvent(o)
	}
}

// requestCompletions asks the engine for candidates for the current input. Empty input closes the
// dropdown without a round-trip. Each query carries a fresh id so stale results are dropped.
func (m *model) requestCompletions() {
	v := m.input.Value()
	if v == "" {
		if m.compOpen {
			m.compOpen = false
			m.relayout()
		}
		return
	}
	m.queryID++
	m.engine.Send(encodeQuery(m.queryID, v))
}

var trailingAt = regexp.MustCompile(`@[A-Za-z0-9_./~-]*$`)

// acceptCompletion inserts the highlighted candidate: a command replaces the whole line; an
// @symbol/@path replaces just the trailing @token.
func (m *model) acceptCompletion() {
	if !m.compOpen || len(m.comps) == 0 {
		return
	}
	item := m.comps[m.compIdx]
	if item.Kind == "command" {
		m.input.SetValue(item.Value + " ")
	} else {
		repl := item.Value
		if !strings.HasSuffix(repl, "/") { // a dir keeps the cursor on it to descend; else add a space
			repl += " "
		}
		m.input.SetValue(trailingAt.ReplaceAllString(m.input.Value(), repl))
	}
	m.input.CursorEnd()
	m.compOpen = false
	m.relayout()
}

// relayout re-sizes + re-renders the viewport. Kept as a named entry point for the many call sites
// that change chrome (open/close a dropdown or menu, grow the input); it just delegates to refresh,
// which now owns the height calculation so it stays correct as engine events stream content in too.
func (m *model) relayout() { m.refresh() }

// chromeReserve is the number of rows the dropdown / menu steals from the transcript while open.
func (m *model) chromeReserve() int {
	if m.compOpen {
		return len(m.comps)
	}
	if m.menuOpen {
		n := len(m.menuOpts)
		if n > menuMaxVisible {
			n = menuMaxVisible
		}
		return n + 1 // +1 for the title
	}
	return 0
}

const inputMaxRows = 6 // the multi-line input grows up to this many rows, then scrolls internally

// syncInputHeight grows or shrinks the input box to fit its content, capped at inputMaxRows.
func (m *model) syncInputHeight() {
	n := m.input.LineCount()
	if n < 1 {
		n = 1
	}
	if n > inputMaxRows {
		n = inputMaxRows
	}
	if n != m.input.Height() {
		m.input.SetHeight(n)
	}
}

// pushHistory records a submitted line for up/down recall, skipping a consecutive duplicate, and
// resets the browse cursor to the fresh-line position.
func (m *model) pushHistory(text string) {
	if n := len(m.history); n == 0 || m.history[n-1] != text {
		m.history = append(m.history, text)
	}
	m.histIdx = len(m.history)
	m.histStash = ""
}

// histPrev recalls an older submission (up). The in-progress line is stashed on first step back.
func (m *model) histPrev() {
	if len(m.history) == 0 {
		return
	}
	if m.histIdx == len(m.history) {
		m.histStash = m.input.Value()
	}
	if m.histIdx > 0 {
		m.histIdx--
	}
	m.input.SetValue(m.history[m.histIdx])
	m.input.CursorEnd()
}

// histNext recalls a newer submission (down), restoring the stashed in-progress line at the end.
func (m *model) histNext() {
	if m.histIdx >= len(m.history) {
		return
	}
	m.histIdx++
	if m.histIdx == len(m.history) {
		m.input.SetValue(m.histStash)
	} else {
		m.input.SetValue(m.history[m.histIdx])
	}
	m.input.CursorEnd()
}

func (m *model) handleEvent(o Outbound) {
	switch o.Name {
	case "stream_token":
		m.stream += argString(o.Args, 0)
		m.refresh()

	case "message":
		var me MessageEntry
		if len(o.Args) > 0 {
			_ = json.Unmarshal(o.Args[0], &me)
		}
		m.renderMessage(me)

	case "status":
		m.status = argString(o.Args, 0)

	case "spinner_state":
		// args[0] is the state ("thinking"/"idle"), args[1] the label. Track busy so Ctrl+C knows
		// whether to cancel the turn or quit.
		m.busy = argString(o.Args, 0) == "thinking"
		if s := argString(o.Args, 1); s != "" {
			m.status = s
		}

	case "thinking":
		if t := argString(o.Args, 0); t != "" {
			t = strings.ReplaceAll(t, "\n", " ")
			if len(t) > 100 {
				t = t[:100] + "…"
			}
			m.status = "💭 " + t
		}

	case "thinking_clear":
		// reasoning finished; spinner_state/status will set the next line

	case "mode_change":
		m.fMode = argString(o.Args, 0)

	case "model_tier":
		var t struct {
			Tier   string `json:"tier"`
			Pinned string `json:"pinned"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &t) == nil {
			m.fTier, m.fPinned = t.Tier, t.Pinned
		}

	case "cost_update":
		var chars float64
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &chars) == nil {
			m.fTokens += int(chars / 4) // rough token estimate, same as Footer.tsx
		}

	case "ui_snapshot":
		var s struct {
			Models    struct{ Coding, Lite string } `json:"models"`
			GoalCount int                           `json:"goalCount"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &s) == nil {
			m.fCoding, m.fLite, m.fGoals = s.Models.Coding, s.Models.Lite, s.GoalCount
		}

	case "tool_call", "tool_call_result":
		var tc ToolCall
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &tc) == nil && tc.ToolName != "" {
			line := renderToolCall(tc)
			// Update the existing line in place when the result for a known call arrives, so a tool
			// shows as one entry that resolves — not a "running" row followed by a "done" row.
			if idx, ok := m.toolLine[tc.ID]; ok && tc.ID != "" {
				m.lines[idx] = line
				m.refresh()
			} else {
				if tc.ID != "" {
					m.toolLine[tc.ID] = len(m.lines)
				}
				m.append(line)
			}
		}

	case "log":
		var le struct {
			Level string `json:"level"`
			Text  string `json:"text"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &le) == nil && le.Text != "" {
			m.append(dimStyle.Render("  " + le.Text))
		}

	case "todo_update":
		// Full task list (the compact "Tasks: x/y" summary already arrives as a `status` event).
		// Re-render the checklist into the transcript only when it actually changed.
		var todos []TodoItem
		if len(o.Args) > 0 {
			_ = json.Unmarshal(o.Args[0], &todos)
		}
		m.todos = todos
		if r := renderTodos(todos); r != "" && r != m.lastTodoRender {
			m.lastTodoRender = r
			m.append(r)
		}

	case "cwd_changed":
		if p := argString(o.Args, 0); p != "" {
			m.cwd = p
			m.append(dimStyle.Render("  ⌁ cwd → " + p))
		}

	case "mcp_changed":
		m.append(dimStyle.Render("  ⌁ MCP servers changed"))

	case "graph_changed":
		m.append(dimStyle.Render("  ⌁ code graph updated"))

	case "loop_detected":
		var sig struct {
			Type     string `json:"type"`
			Tool     string `json:"tool"`
			Count    int    `json:"count"`
			Severity string `json:"severity"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &sig) == nil {
			detail := sig.Tool
			if detail == "" {
				detail = sig.Type
			}
			m.append(errStyle.Render(fmt.Sprintf("  ↻ loop detected: %s ×%d (%s)", detail, sig.Count, sig.Severity)))
		}

	case "rerun_onboarding":
		m.append(dimStyle.Render("  ⌁ onboarding is only available in the Ink UI; skipped"))

	case "shutdown":
		m.status = "shutting down…"
		m.quitting = true // engineMsg handler turns this into tea.Quit

	// config_changed / goals_changed / set_tier are footer-refresh signals. The footer is driven by
	// the ui_snapshot (config/goals) and model_tier (set_tier) events the engine emits alongside
	// them, so there's nothing to render here — handled explicitly so they're not silently dropped.
	case "config_changed", "goals_changed", "set_tier":
	}
}

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

// renderToolCall draws one tool entry the Ink way: a status dot, the bold label, dim (args), and an
// indented ⎿ summary line. Running calls show no summary yet; errors show the summary in red.
func renderToolCall(tc ToolCall) string {
	dot := toolDot
	switch tc.Status {
	case "error":
		dot = toolDotE
	case "running", "":
		dot = toolDotW
	}
	header := dot.Render("⏺ ") + toolLabel.Render(toolLabelFor(tc.ToolName))
	if in := summarizeToolInput(tc.Input); in != "" {
		header += toolArgs.Render("(" + in + ")")
	}
	if tc.Status == "running" || tc.Status == "" {
		return "  " + header
	}
	summary := summarizeToolOutput(tc)
	if summary == "" {
		return "  " + header
	}
	sumStyle := dimStyle
	if tc.Status == "error" {
		sumStyle = errStyle
	}
	return "  " + header + "\n    " + toolGut.Render("⎿ ") + sumStyle.Render(summary)
}

// clip truncates s to n runes with an ellipsis.
func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

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
	b.WriteByte('\n')
	for i, ln := range logoLines {
		st := logoStyle
		if i == 1 {
			st = logoMid
		}
		b.WriteString("  " + st.Render(ln) + "\n")
	}
	b.WriteString("\n  " + brandStyle.Render("BiMax ") + tipStyle.Render("v1.0.0 · autonomous agent for your terminal") + "\n\n")

	cwd := m.cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	b.WriteString("  " + metaKey.Render("cwd    ") + metaVal.Render(shortPath(cwd)) + "\n\n")
	b.WriteString("  " + tipStyle.Render("Ask anything, or describe a task to run it with tools.") + "\n")
	b.WriteString("  " + tipStyle.Render("/help for commands · Ctrl+G palette · Ctrl+C to stop · Esc to dismiss"))

	m.append(b.String())
}

// renderTodos draws the task list as a checklist. Empty list → empty string (nothing to show).
func renderTodos(todos []TodoItem) string {
	if len(todos) == 0 {
		return ""
	}
	var b strings.Builder
	done := 0
	for _, t := range todos {
		icon := "☐"
		st := dimStyle
		switch t.Status {
		case "completed":
			icon, st, done = "☑", toolStyle, done+1
		case "in_progress":
			icon, st = "◐", asstStyle
		}
		b.WriteString(st.Render(fmt.Sprintf("  %s %s", icon, t.Content)) + "\n")
	}
	header := asstStyle.Render(fmt.Sprintf("  Tasks (%d/%d)", done, len(todos)))
	return header + "\n" + strings.TrimRight(b.String(), "\n")
}

func (m *model) renderMessage(me MessageEntry) {
	if me.UIComponent == "menu" {
		var menu Menu
		if json.Unmarshal(me.Payload, &menu) == nil && len(menu.Options) > 0 {
			m.menuOpen = true
			m.menuTitle = menu.Title
			m.menuOpts = menu.Options
			m.menuIdx = 0
			m.relayout()
		}
		return
	}
	switch me.Role {
	case "user":
		// A new turn begins — scope tool-call dedupe to this turn so a later turn's tool ids can't
		// collide with an earlier turn's line indices (and the map doesn't grow without bound).
		m.toolLine = map[string]int{}
		m.append(caretStyle.Render("❯ ") + userStyle.Render(me.Content))
	case "assistant":
		m.stream = "" // the final message supersedes the streamed partial
		m.append(renderMarkdown(me.Content, m.vp.Width))
	default: // system
		st := dimStyle
		if me.Level == "error" {
			st = errStyle
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
}

// append commits a transcript line and re-renders the viewport.
func (m *model) append(line string) {
	m.lines = append(m.lines, line)
	m.refresh()
}

// transcriptBody joins the committed transcript with any in-flight streamed tokens.
func (m *model) transcriptBody() string {
	body := strings.Join(m.lines, "\n")
	if m.stream != "" {
		if body != "" {
			body += "\n"
		}
		body += streamStyle.Render(m.stream)
	}
	return body
}

// refresh rebuilds the viewport content and sizes the viewport to HUG that content: when the
// conversation is short the transcript only takes the rows it needs, so the input + footer sit right
// under the last line instead of being pushed to the bottom of the screen (the giant gap the Ink UI
// never had). Once the content outgrows the available rows the viewport caps and scrolls, pinned to
// the bottom. Called from both key handling (relayout) and engine events (append), so the height
// tracks streamed output too.
func (m *model) refresh() {
	body := m.transcriptBody()

	// Rows consumed by the non-transcript chrome: footer (1) + mid/status (1) + the prompt box's two
	// border rows + the (variable) input height, plus any open dropdown/menu reservation.
	avail := m.height - (4 + m.input.Height()) - m.chromeReserve()
	if avail < 3 {
		avail = 3
	}
	h := lipgloss.Height(body)
	if h > avail {
		h = avail
	}
	if h < 1 {
		h = 1
	}
	m.vp.Width = m.width
	m.vp.Height = h
	m.vp.SetContent(body)
	m.vp.GotoBottom()
}

func (m model) View() string {
	status := statusStyle.Render(m.status)
	if m.busy {
		status = m.spin.View() + " " + status // animated spinner while a turn runs
	}

	// An option/diff approval takes over the input slot; a free-form prompt keeps the input box
	// (the user types the answer there) and shows its question in the mid slot.
	var bottom string
	if m.reqOpen && m.reqKind != "input" {
		var b strings.Builder
		b.WriteString(errStyle.Render("⚠ "+m.reqQ) + "\n")
		if m.reqKind == "diff" && m.reqBody != "" {
			b.WriteString(renderDiff(m.reqBody, 16) + "\n")
		}
		for i, op := range m.reqOpts {
			b.WriteString(fmt.Sprintf("  %d) %s\n", i+1, op))
		}
		b.WriteString(dimStyle.Render("press 1–" + fmt.Sprint(len(m.reqOpts)) + " · esc to dismiss"))
		bottom = requestBox.Width(m.width - 2).Render(b.String())
	} else {
		bottom = promptBox.Width(m.width - 2).Render(m.input.View())
	}

	mid := status
	switch {
	case m.reqOpen && m.reqKind == "input":
		mid = footerTier.Render("? " + m.reqQ)
	case m.menuOpen && len(m.menuOpts) > 0:
		mid = m.menuView()
	case m.compOpen && len(m.comps) > 0:
		mid = m.completionView()
	}
	// Layout order mirrors Ink's FullScreen: transcript, then the live working/status + any
	// dropdown/menu, then the input box, and the footer pinned at the very bottom.
	return lipgloss.JoinVertical(lipgloss.Left, m.vp.View(), mid, bottom, m.footerLine())
}

const menuMaxVisible = 10

// menuView renders the interactive menu, windowed to menuMaxVisible rows scrolled to keep the
// selection visible (the command palette has 60+ entries).
func (m model) menuView() string {
	var b strings.Builder
	start := 0
	if len(m.menuOpts) > menuMaxVisible {
		start = m.menuIdx - menuMaxVisible/2
		if start < 0 {
			start = 0
		}
		if start > len(m.menuOpts)-menuMaxVisible {
			start = len(m.menuOpts) - menuMaxVisible
		}
	}
	end := start + menuMaxVisible
	if end > len(m.menuOpts) {
		end = len(m.menuOpts)
	}

	title := m.menuTitle
	if len(m.menuOpts) > menuMaxVisible {
		title += fmt.Sprintf("  (%d/%d)", m.menuIdx+1, len(m.menuOpts))
	}
	b.WriteString(asstStyle.Render(title) + "\n")
	for i := start; i < end; i++ {
		op := m.menuOpts[i]
		row := fmt.Sprintf("%-18s %s", op.Label, op.Desc)
		if i == m.menuIdx {
			b.WriteString(compSel.Render("▸ "+row) + "\n")
		} else {
			b.WriteString("  " + dimStyle.Render(row) + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// completionView renders the autocomplete dropdown, highlighting the selected row.
func (m model) completionView() string {
	var b strings.Builder
	for i, it := range m.comps {
		row := fmt.Sprintf("%-18s %s", it.Label, it.Desc)
		if i == m.compIdx {
			b.WriteString(compSel.Render("▸ "+row) + "\n")
		} else {
			b.WriteString("  " + dimStyle.Render(row) + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

// footerLine renders the model/tier · tokens · goals · mode bar, mirroring Ink's Footer.tsx.
func (m model) footerLine() string {
	modelID := m.fLite
	if m.fTier == "heavy" {
		modelID = m.fCoding
	}
	if modelID == "" {
		modelID = "—"
	}
	tier := m.fTier
	if tier == "" {
		tier = "lite"
	}
	if m.fPinned != "" {
		tier += "📌"
	}

	parts := []string{footerTier.Render("◆ "+tier) + footerVal.Render(":"+shortModel(modelID))}
	parts = append(parts, footerVal.Render(fmt.Sprintf("⛁ %s tok", humanCount(m.fTokens))))
	if m.fGoals > 0 {
		parts = append(parts, footerVal.Render(fmt.Sprintf("◎ %d goals", m.fGoals)))
	}
	if m.fMode != "" {
		parts = append(parts, footerMode.Render("["+m.fMode+"]"))
	}
	return footerBar.Width(m.width).Render(strings.Join(parts, footerSep))
}

// renderDiff colorizes a unified diff (green adds, red deletes, cyan hunks), capped to maxLines.
func renderDiff(diff string, maxLines int) string {
	lines := strings.Split(strings.TrimRight(diff, "\n"), "\n")
	truncated := false
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		truncated = true
	}
	var b strings.Builder
	for _, ln := range lines {
		switch {
		case strings.HasPrefix(ln, "+"):
			b.WriteString(diffAdd.Render(ln))
		case strings.HasPrefix(ln, "-"):
			b.WriteString(diffDel.Render(ln))
		case strings.HasPrefix(ln, "@@"):
			b.WriteString(diffHunk.Render(ln))
		default:
			b.WriteString(dimStyle.Render(ln))
		}
		b.WriteString("\n")
	}
	if truncated {
		b.WriteString(dimStyle.Render("  …(diff truncated)"))
	}
	return strings.TrimRight(b.String(), "\n")
}

// shortModel strips the provider prefix: "minimaxai/minimax-m3" → "minimax-m3".
func shortModel(id string) string {
	if i := strings.LastIndex(id, "/"); i >= 0 {
		return id[i+1:]
	}
	return id
}

// humanCount renders a token count compactly: 1234 → "1.2k".
func humanCount(n int) string {
	if n < 1000 {
		return fmt.Sprint(n)
	}
	return fmt.Sprintf("%.1fk", float64(n)/1000)
}

// --- small helpers -------------------------------------------------------------------------

func digit(s string) int {
	if len(s) == 1 && s[0] >= '1' && s[0] <= '9' {
		return int(s[0] - '0')
	}
	return -1
}

func firstOr(s []string, def string) string {
	if len(s) > 0 {
		return s[0]
	}
	return def
}
