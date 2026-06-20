package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
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
	input  textinput.Model

	lines  []string // committed transcript
	stream string   // in-flight assistant tokens (replaced by the final message)
	status string
	ready  bool
	width  int
	height int

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
	ti := textinput.New()
	ti.Placeholder = "Ask BiMax…"
	ti.Prompt = "❯ "
	ti.Focus()
	ti.CharLimit = 0
	return model{
		engine: e,
		input:  ti,
		vp:     viewport.New(80, 20),
		status: "starting engine…",
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(waitForEngine(m.engine), textinput.Blink)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {

	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		m.input.Width = msg.Width - 4
		m.relayout()
		return m, nil

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

		switch msg.String() {
		case "ctrl+c":
			m.engine.Close()
			return m, tea.Quit
		case "pgup", "pgdown", "ctrl+u", "ctrl+d", "shift+up", "shift+down":
			var cmd tea.Cmd
			m.vp, cmd = m.vp.Update(msg) // scroll the transcript without touching the input
			return m, cmd
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
				m.input.SetValue("")
			}
			m.compOpen = false
			m.relayout()
			return m, nil
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
		m.requestCompletions() // refresh candidates for the new input
		return m, cmd

	case engineMsg:
		m.handleEngine(Outbound(msg))
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
		m.status = fmt.Sprintf("ready · protocol v%d", o.Protocol)

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

// relayout recomputes the viewport height to make room for the dropdown, and re-renders.
func (m *model) relayout() {
	reserve := 0
	if m.compOpen {
		reserve = len(m.comps)
	}
	if m.menuOpen {
		n := len(m.menuOpts)
		if n > menuMaxVisible {
			n = menuMaxVisible
		}
		reserve = n + 1 // +1 for the title
	}
	h := m.height - 5 - reserve
	if h < 3 {
		h = 3
	}
	m.vp.Width = m.width
	m.vp.Height = h
	m.refresh()
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
			GoalCount int                            `json:"goalCount"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &s) == nil {
			m.fCoding, m.fLite, m.fGoals = s.Models.Coding, s.Models.Lite, s.GoalCount
		}

	case "tool_call", "tool_call_result":
		var tc ToolCall
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &tc) == nil && tc.ToolName != "" {
			icon := "•"
			if tc.Status == "success" {
				icon = "✓"
			} else if tc.Status == "error" {
				icon = "✗"
			}
			m.append(toolStyle.Render(fmt.Sprintf("  %s %s", icon, tc.ToolName)))
		}

	case "log":
		var le struct {
			Level string `json:"level"`
			Text  string `json:"text"`
		}
		if len(o.Args) > 0 && json.Unmarshal(o.Args[0], &le) == nil && le.Text != "" {
			m.append(dimStyle.Render("  " + le.Text))
		}
	}
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
		m.append(userStyle.Render("❯ " + me.Content))
	case "assistant":
		m.stream = "" // the final message supersedes the streamed partial
		m.append(asstStyle.Render(me.Content))
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

// refresh rebuilds the viewport content (transcript + any in-flight stream) and pins to bottom.
func (m *model) refresh() {
	body := strings.Join(m.lines, "\n")
	if m.stream != "" {
		if body != "" {
			body += "\n"
		}
		body += streamStyle.Render(m.stream)
	}
	m.vp.SetContent(body)
	m.vp.GotoBottom()
}

func (m model) View() string {
	header := headerStyle.Render(" BiMax · Bubble Tea ")
	status := statusStyle.Render(m.status)

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
	return lipgloss.JoinVertical(lipgloss.Left, header, m.vp.View(), m.footerLine(), mid, bottom)
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
