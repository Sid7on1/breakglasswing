package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// isFenceLine reports whether a line opens or closes a fenced code block (``` or ~~~).
func isFenceLine(line string) bool {
	t := strings.TrimSpace(line)
	return strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~")
}

// splitStreamBlocks partitions the open (not-yet-committed) portion of the assistant stream into
// COMPLETE leading markdown blocks plus the remaining open tail. A block is complete only when a
// blank line terminates it at fence depth 0 — text inside an unterminated ``` fence is never split,
// so a half-streamed code block stays live until its closing fence arrives. Returns the closed
// blocks (in order) and the still-open remainder.
func splitStreamBlocks(s string) (closed []string, rest string) {
	lines := strings.Split(s, "\n")
	inFence := false
	lastCut := 0 // index of the first line not yet closed into a block
	for i, line := range lines {
		if isFenceLine(line) {
			inFence = !inFence
			continue
		}
		if !inFence && strings.TrimSpace(line) == "" {
			block := strings.Join(lines[lastCut:i], "\n")
			if strings.TrimSpace(block) != "" {
				closed = append(closed, block)
			}
			lastCut = i + 1
		}
	}
	rest = strings.Join(lines[lastCut:], "\n")
	return closed, rest
}

// appendAssistantBlock commits one finished markdown block to native scrollback, formatted once via
// glamour. The turn's first block carries the accent ⏺ marker and the "Thought for Ns" line (the
// thought clock is frozen at the first stream token); later blocks get a blank-line paragraph gap.
func (m *model) appendAssistantBlock(blk string) {
	md := indentLines(renderMarkdown(blk), "  ")
	if md == "" {
		return
	}
	if !m.turnAnswerStarted {
		m.turnAnswerStarted = true
		if m.turnThoughtMs >= 500 {
			m.append(thoughtSty.Render(fmt.Sprintf("  ● Thought for %ds", m.turnThoughtMs/1000)))
		}
		md = caretStyle.Render("● ") + strings.TrimPrefix(md, "  ")
	} else {
		m.append("") // paragraph spacing between committed blocks
	}
	m.append(md)
}

// commitAssistantStream commits any complete markdown blocks at the head of the open stream to
// scrollback, advancing streamCommitted past them so View only ever renders the trailing open block.
// When final is set (turn ending), the remaining open tail is force-committed as the last block.
func (m *model) commitAssistantStream(final bool) {
	if m.streamCommitted > len(m.stream) {
		m.streamCommitted = len(m.stream) // defensive clamp (should never trip)
	}
	open := m.stream[m.streamCommitted:]
	if open == "" {
		return
	}
	closed, rest := splitStreamBlocks(open)
	if final && strings.TrimSpace(rest) != "" {
		closed = append(closed, rest)
		rest = ""
	}
	for _, blk := range closed {
		m.appendAssistantBlock(blk)
	}
	if final {
		m.streamCommitted = len(m.stream)
	} else {
		m.streamCommitted += len(open) - len(rest) // consumed = everything before the open remainder
	}
}

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
		// A new turn begins — clear any tool stragglers so this turn's tools start from a clean slate.
		m.turnTools = nil
		// Reset the per-turn reasoning clock so "Thought for Ns" measures THIS turn, and drop any
		// leftover streamed partial so a prior turn's text can't bleed into this one.
		m.turnThinkStart = time.Time{}
		m.turnThoughtMs = 0
		m.thinkSnip = ""
		m.stream = ""
		m.streamCommitted = 0
		m.turnAnswerStarted = false
		m.histTokens += len([]rune(me.Content)) / 4
		if m.started {
			m.append("") // a blank line between turns so the transcript reads as distinct exchanges
		}
		m.append(caretStyle.Render("❯ ") + userStyle.Render(me.Content))
	case "assistant":
		m.histTokens += len([]rune(me.Content)) / 4
		if m.stream != "" {
			// Streamed turn: the closed blocks are already in scrollback (committed progressively as
			// they closed). Force-commit the trailing open block so finalization is a visual no-op —
			// no snap from raw to formatted, because the user has been watching formatted blocks land.
			// The final message is authoritative and may EXTEND past what streamed, so adopt me.Content
			// as long as it agrees with the prefix already committed to scrollback (which can't be
			// un-printed); otherwise commit exactly what the user watched stream.
			committedPrefix := m.stream[:m.streamCommitted]
			finalText := me.Content
			if finalText == "" || !strings.HasPrefix(finalText, committedPrefix) {
				finalText = m.stream
			}
			m.stream = finalText
			m.commitAssistantStream(true)
			m.stream = ""
			m.streamCommitted = 0
			m.turnAnswerStarted = false
			return
		}
		// Non-streamed message (some paths deliver a complete assistant message with no token stream):
		// render it fresh. First line gets the accent ⏺ marker so the reply is anchored; the
		// "✻ Thought for Ns" line prefers the engine's thoughtMs, else the Go-side clock, ≥500ms only.
		thought := me.ThoughtMs
		if thought == 0 {
			thought = m.turnThoughtMs
		}
		var b strings.Builder
		if thought >= 500 {
			fmt.Fprintf(&b, "%s\n", thoughtSty.Render(fmt.Sprintf("  ● Thought for %ds", thought/1000)))
		}
		md := indentLines(renderMarkdown(me.Content), "  ")
		if md != "" {
			md = caretStyle.Render("● ") + strings.TrimPrefix(md, "  ")
		}
		b.WriteString(md)
		m.append(b.String())
	default: // system
		// A finished sub-agent posts its ENTIRE report (hundreds of lines) as a success message.
		// Committing that wall to scrollback buries the parent's synthesized answer, so collapse it to
		// a single marker line — the full output stays live in the sub-agent panel (Ctrl+A), and the
		// parent folds it into its own reply. This is the single biggest source of transcript noise.
		if strings.HasPrefix(me.ID, "subagent-result-") {
			m.append(m.subAgentResultBlock(me))
			return
		}
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

// subAgentResultBlock renders a finished sub-agent's report into the transcript: a colored header
// (with the noisy "(subagent-uuid)" id stripped) followed by the report body as clean markdown. It's
// capped so a runaway report can't flood scrollback again — but generous enough that the output is
// actually THERE to read (the earlier one-line collapse read as "no output"). Full text stays live in
// the panel too (Ctrl+A). Errors render as a single red line.
func (m *model) subAgentResultBlock(me MessageEntry) string {
	head, body := me.Content, ""
	if i := strings.Index(me.Content, "\n"); i >= 0 {
		body = strings.TrimSpace(me.Content[i:])
		head = strings.TrimSpace(me.Content[:i])
	}
	// Drop the " (subagent-…)" id chunk and any trailing ": " so the header reads like a clean status.
	if a := strings.Index(head, " ("); a >= 0 {
		if b := strings.Index(head[a:], ")"); b >= 0 {
			head = head[:a] + head[a+b+1:]
		}
	}
	head = strings.TrimRight(head, ": ")
	if me.Level == "error" {
		return errStyle.Render(head)
	}

	var b strings.Builder
	b.WriteString(okStyle.Render("⏺ " + head))
	if body == "" {
		return b.String()
	}
	// Cap the body so four parallel agents can't dump 1200 lines; keep enough that it reads as a report.
	const maxLines = 60
	lines := strings.Split(body, "\n")
	truncated := 0
	if len(lines) > maxLines {
		truncated = len(lines) - maxLines
		lines = lines[:maxLines]
	}
	if md := indentLines(renderMarkdown(strings.Join(lines, "\n")), "  "); strings.TrimSpace(md) != "" {
		b.WriteString("\n" + md)
	}
	if truncated > 0 {
		b.WriteString("\n" + subtleStyle.Render(fmt.Sprintf("  … +%d more lines — Ctrl+A to open this agent's card", truncated)))
	}
	return b.String()
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
