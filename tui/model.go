package main

import (
	"encoding/json"
	"fmt"
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
		m.vp.Width = msg.Width
		m.vp.Height = msg.Height - 5 // header + status + footer + input + breathing room
		m.input.Width = msg.Width - 4
		m.refresh()
		return m, nil

	case tea.KeyMsg:
		// Approval overlay captures number keys + esc.
		if m.reqOpen {
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

		switch msg.String() {
		case "ctrl+c":
			m.engine.Close()
			return m, tea.Quit
		case "enter":
			text := strings.TrimSpace(m.input.Value())
			if text != "" {
				m.engine.Send(encodeInput(text)) // engine echoes the user message back
				m.input.SetValue("")
			}
			return m, nil
		}
		var cmd tea.Cmd
		m.input, cmd = m.input.Update(msg)
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

	case "event":
		m.handleEvent(o)
	}
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
		if json.Unmarshal(me.Payload, &menu) == nil {
			m.append(asstStyle.Render(menu.Title))
			for _, op := range menu.Options {
				m.append(fmt.Sprintf("  %s  %s", userStyle.Render(op.Label), dimStyle.Render(op.Desc)))
			}
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
	m.append(dimStyle.Render(fmt.Sprintf("  → %s", value)))
	m.reqOpen = false
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

	var bottom string
	if m.reqOpen {
		var b strings.Builder
		b.WriteString(errStyle.Render("⚠ "+m.reqQ) + "\n")
		for i, op := range m.reqOpts {
			b.WriteString(fmt.Sprintf("  %d) %s\n", i+1, op))
		}
		b.WriteString(dimStyle.Render("press 1–" + fmt.Sprint(len(m.reqOpts)) + " · esc to dismiss"))
		bottom = requestBox.Width(m.width - 2).Render(b.String())
	} else {
		bottom = promptBox.Width(m.width - 2).Render(m.input.View())
	}

	return lipgloss.JoinVertical(lipgloss.Left, header, m.vp.View(), m.footerLine(), status, bottom)
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
