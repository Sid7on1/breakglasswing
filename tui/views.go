package main

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
)

// midView is the live region between the transcript and the prompt: an interactive menu, the
// completion dropdown, the input-request question, or the working/thinking indicator.
func (m model) midView() string {
	switch {
	case m.reqOpen && m.reqKind == "input":
		return footerTier.Render("? " + m.reqQ)
	case m.menuOpen:
		return m.menuView()
	case m.compOpen && len(m.comps) > 0:
		return m.completionView()
	case len(m.runningTools) > 0:
		return m.toolingView()
	case m.busy && strings.TrimSpace(m.stream) == "":
		return m.thinkingView()
	case m.busy:
		return m.workingView()
	}
	return " "
}

// promptView renders the bottom input region: an option/diff approval box, a masked prompt, or the
// rounded input box with its stash / paste / multi-line hints (SimpleInput.tsx layout).
func (m model) promptView() string {
	if m.reqOpen && m.reqKind != "input" {
		var b strings.Builder
		fmt.Fprintf(&b, "%s\n", userStyle.Render("⚠ "+m.reqQ))
		if m.reqKind == "diff" && m.reqBody != "" {
			fmt.Fprintf(&b, "%s\n", renderDiff(m.reqBody, 16, m.width-8, ""))
		}
		for i, op := range m.reqOpts {
			cursor := "  "
			if i == m.reqIdx {
				cursor = userStyle.Render("❯ ")
			}
			
			box := ""
			if m.reqIsMulti {
				box = "[ ] "
				if m.reqSelected[i] {
					box = userStyle.Render("[x] ")
				}
				fmt.Fprintf(&b, "%s%s%d) %s\n", cursor, box, i+1, op)
			} else {
				// For single-select, just use the number and option text, highlighting the number if selected
				numStr := fmt.Sprintf("%d) ", i+1)
				if i == m.reqIdx {
					numStr = userStyle.Render(numStr)
				}
				fmt.Fprintf(&b, "%s%s%s\n", cursor, numStr, op)
			}
		}
		
		// The extra custom type-in option
		cursor := "  "
		if m.reqIdx == len(m.reqOpts) {
			cursor = userStyle.Render("❯ ")
		}
		
		fmt.Fprintf(&b, "%s%d) Explain your answer:\n", cursor, len(m.reqOpts)+1)
		if m.reqIdx == len(m.reqOpts) {
			// Render the textarea directly inline!
			fmt.Fprintf(&b, "    %s\n", m.input.View())
		} else {
			val := m.input.Value()
			if val == "" {
				val = "Type your own answer..."
			}
			fmt.Fprintf(&b, "    %s\n", dimStyle.Render(val))
		}
		
		if m.reqIsMulti {
			b.WriteString(dimStyle.Render("↑/↓ navigate · space select · enter to submit · esc to dismiss"))
		} else {
			b.WriteString(dimStyle.Render("↑/↓ navigate · enter to submit · esc to dismiss"))
		}
		return requestBox.Width(m.width - 6).Render(b.String())
	}

	var b strings.Builder
	// Masked free-form prompt (API keys): render the typed value as bullets instead of the textarea,
	// so a secret never shows on screen even though it still flows through the input field.
	if m.reqOpen && m.reqKind == "input" && m.reqMasked {
		fmt.Fprintf(&b, "%s%s", caretStyle.Render("❯ "), asstStyle.Render(strings.Repeat("•", len([]rune(m.input.Value())))))
		return promptBox.Width(m.width - 6).Render(b.String())
	}

	if m.stash != "" {
		fmt.Fprintf(&b, "%s\n", subtleStyle.Render("[Stashed] Press Ctrl+R to resume"))
	}
	if n := len(m.queued); n > 0 {
		next := clip(m.queued[0], 48)
		more := ""
		if n > 1 {
			more = fmt.Sprintf(" (+%d more)", n-1)
		}
		fmt.Fprintf(&b, "%s\n", subtleStyle.Render(fmt.Sprintf("⧖ %d queued · next: %s%s", n, next, more)))
	}
	if n := len(m.pastes); n > 0 && !m.searchMode {
		plural := ""
		if n > 1 {
			plural = "s"
		}
		fmt.Fprintf(&b, "%s\n", subtleStyle.Render(fmt.Sprintf("⎘ %d pasted block%s · Ctrl+P to preview · expands on send", n, plural)))
	}
	if m.searchMode {
		fmt.Fprintf(&b, "%s%s%s", caretStyle.Render("❯ "), asstStyle.Render(m.searchQuery), caretStyle.Render("▏"))
	} else {
		b.WriteString(m.input.View())
		if strings.Contains(m.input.Value(), "\n") {
			lines := strings.Count(m.input.Value(), "\n") + 1
			fmt.Fprintf(&b, "\n%s", subtleStyle.Render(fmt.Sprintf("  ↵ send · Ctrl+J newline · %d lines", lines)))
		}
	}
	return promptBox.Width(m.width - 6).Render(b.String())
}

const menuMaxVisible = 8

// menuView renders the interactive menu (Ink InteractiveMenu): a title + search box, fuzzy-filtered
// options windowed to menuMaxVisible rows with ↑/↓ "...more..." scroll indicators.
func (m model) menuView() string {
	opts := m.filteredMenu()
	idx := m.menuIdx
	if idx >= len(opts) {
		idx = 0
	}
	var b strings.Builder
	title := m.menuTitle
	if m.menuFilter != "" {
		title += fmt.Sprintf("  (%d/%d)", len(opts), len(m.menuOpts))
	}
	fmt.Fprintf(&b, "%s%s\n", dashTitle.Render(title), subtleStyle.Render("  [↑/↓ navigate, Enter select, Esc cancel]"))
	b.WriteString(searchHdr.Render("🔍 "))
	if m.menuFilter == "" {
		fmt.Fprintf(&b, "%s\n", subtleStyle.Render("Type to search…"))
	} else {
		fmt.Fprintf(&b, "%s\n", searchCur.Render(m.menuFilter))
	}

	if len(opts) == 0 {
		fmt.Fprintf(&b, "  %s", subtleStyle.Render("No matches found"))
		return strings.TrimRight(b.String(), "\n")
	}

	start := 0
	if len(opts) > menuMaxVisible {
		switch {
		case idx < menuMaxVisible/2:
			start = 0
		case idx >= len(opts)-menuMaxVisible/2:
			start = len(opts) - menuMaxVisible
		default:
			start = idx - menuMaxVisible/2
		}
	}
	end := start + menuMaxVisible
	if end > len(opts) {
		end = len(opts)
	}
	if start > 0 {
		fmt.Fprintf(&b, "  %s\n", subtleStyle.Render("↑ ...more options..."))
	}
	for i := start; i < end; i++ {
		op := opts[i]
		row := fmt.Sprintf("%-25s %s", op.Label, op.Desc)
		if i == idx {
			fmt.Fprintf(&b, "%s\n", compSel.Render("❯ "+row))
		} else {
			fmt.Fprintf(&b, "  %s\n", dimStyle.Render(row))
		}
	}
	if end < len(opts) {
		fmt.Fprintf(&b, "  %s\n", subtleStyle.Render("↓ ...more options..."))
	}
	return strings.TrimRight(b.String(), "\n")
}

// completionView renders the autocomplete dropdown, highlighting the selected row. The list is
// windowed to menuMaxVisible rows (with ↑/↓ "...more..." markers) so a long slash-command palette
// scrolls instead of being silently truncated to the first handful.
func (m model) completionView() string {
	idx := m.compIdx
	if idx < 0 || idx >= len(m.comps) {
		idx = 0
	}
	start := 0
	if len(m.comps) > menuMaxVisible {
		switch {
		case idx < menuMaxVisible/2:
			start = 0
		case idx >= len(m.comps)-menuMaxVisible/2:
			start = len(m.comps) - menuMaxVisible
		default:
			start = idx - menuMaxVisible/2
		}
	}
	end := start + menuMaxVisible
	if end > len(m.comps) {
		end = len(m.comps)
	}
	var b strings.Builder
	if start > 0 {
		fmt.Fprintf(&b, "  %s\n", subtleStyle.Render(fmt.Sprintf("↑ %d more", start)))
	}
	for i := start; i < end; i++ {
		it := m.comps[i]
		if it.Disabled {
			row := fmt.Sprintf("%-18s %s", it.Label, "(run /index first)")
			if i == idx {
				fmt.Fprintf(&b, "%s\n", subtleStyle.Render("▸ "+row))
			} else {
				fmt.Fprintf(&b, "  %s\n", subtleStyle.Render(row))
			}
		} else {
			row := fmt.Sprintf("%-18s %s", it.Label, it.Desc)
			if i == idx {
				fmt.Fprintf(&b, "%s\n", compSel.Render("▸ "+row))
			} else {
				fmt.Fprintf(&b, "  %s\n", dimStyle.Render(row))
			}
		}
	}
	if end < len(m.comps) {
		fmt.Fprintf(&b, "  %s\n", subtleStyle.Render(fmt.Sprintf("↓ %d more", len(m.comps)-end)))
	}
	return strings.TrimRight(b.String(), "\n")
}

// footerLine renders the status line + hints + model/tier bar, mirroring Ink's Footer.tsx: a left
// status glyph + text, then right-aligned goals · stream meta · hint chord · model/tier.
func (m model) footerLine() string {
	icon, txt := footerIdle.Render("✻ "), footerIdle.Render(m.status)
	if strings.Contains(m.status, "Requires AST Index") || strings.Contains(m.status, "run /index first") {
		icon, txt = warnStyle.Render("✻ "), warnStyle.Render(m.status)
	} else if m.busy {
		icon, txt = footerIcon.Render("✶ "), dimStyle.Render(m.status)
	}
	left := icon + txt

	// Right-aligned cluster: goals · stream meta · [hints] · model/tier. The hint chord is dropped
	// first when the line won't fit, then the status is clipped — so the model name always survives
	// (and the bar never wraps onto a second row).
	var core []string
	if m.fGoals > 0 {
		unit := "goals"
		if m.fGoals == 1 {
			unit = "goal"
		}
		core = append(core, footerHint.Render(fmt.Sprintf("◉ %d %s", m.fGoals, unit)))
	}
	if m.busy {
		chars := len([]rune(m.stream))
		meta := fmt.Sprintf("%d chars", chars)
		if m.elapsed > 0 {
			meta += fmt.Sprintf(" · %d tok/s · %ds", chars/4/m.elapsed, m.elapsed)
		}
		core = append(core, footerHint.Render(meta))
	}

	// model / tier pointer (Ink: ⇧ heavy / ▸ lite). The Ctrl+T state is made explicit: "auto" when
	// routing is automatic (lite answers, escalates as needed), "📌" when a tier is pinned (no switch).
	modelID := m.fLite
	arrow := "▸ "
	if m.fTier == "heavy" {
		modelID, arrow = m.fCoding, "⇧ "
	}
	if modelID == "" {
		modelID = "default"
	}
	mstr := ""
	if m.fMode != "" {
		mstr = m.fMode + " · "
	}
	if m.fPinned != "" {
		mstr += "📌 " // pinned → this model handles every turn, no auto-switch
	} else {
		mstr += "auto " // automatic routing → lite answers, escalates to the coding model when needed
	}
	mstr += arrow + shortModel(modelID)
	mstr += fmt.Sprintf(" · %s tok", humanCount(m.fTokens))
	modelStyle := footerIdle
	if m.fTier == "heavy" {
		modelStyle = footerTier
	}
	modelRendered := modelStyle.Render(mstr)
	hints := footerHint.Render("Ctrl+G palette · Ctrl+F search · Ctrl+O logs · Esc stash")

	// Build to m.width-5, NOT the full width. A line that fills the last column trips the terminal's
	// auto-wrap, which slides the cursor to the next row and desyncs Bubble Tea's inline clear — the
	// whole live region then stacks/multiplies on every update (the doubled footer + repeated meters).
	// The -5 (vs -1) leaves a 5-cell margin so ambiguous-width glyphs (✻/⇧/📌/▸) rendered wider than
	// measured still can't push the line into the last column.
	w := m.width - 5
	withHints := strings.Join(append(append([]string{}, core...), hints, modelRendered), footerSep)
	rightStr := withHints
	if lipgloss.Width(left)+lipgloss.Width(withHints)+1 > w {
		rightStr = strings.Join(append(append([]string{}, core...), modelRendered), footerSep)
	}

	leftW, rightW := lipgloss.Width(left), lipgloss.Width(rightStr)
	gap := w - leftW - rightW
	if gap < 1 {
		if avail := w - rightW - 1; avail >= 0 {
			left = lipgloss.NewStyle().MaxWidth(avail).Render(left)
		}
		gap = 1
	}
	return footerBar.Render(left + strings.Repeat(" ", gap) + rightStr)
}

// --- working / thinking indicators ---------------------------------------------------------

func (m model) thinkingView() string {
	stalledIntensity := 0.0
	if !m.lastTokenAt.IsZero() {
		stallSecs := time.Since(m.lastTokenAt).Seconds()
		if stallSecs > 10.0 {
			stalledIntensity = (stallSecs - 10.0) / 5.0
			if stalledIntensity > 1.0 {
				stalledIntensity = 1.0
			}
		}
	}

	isToolPulse := len(m.runningTools) > 0
	verb := "Executing tool"
	if !isToolPulse {
		// Cycle verbs every 4.0 seconds (80 ticks at 50ms/tick) so the shimmer animation has time to finish
		verbIdx := (m.thinkTick / 80) % len(spinnerVerbs)
		verb = spinnerVerbs[verbIdx]
	}

	shimmerText := renderShimmerVerb(verb, m.thinkTick, stalledIntensity, isToolPulse)
	dots := strings.Repeat(".", m.thinkDots)
	
	s := m.spin.View() + " " + workLabel.Render("✻ ") + shimmerText + workLabel.Render(dots+" "+fmtElapsed(m.elapsed)) + statusStyle.Render(" · esc to stop")
	if m.thinkSnip != "" {
		s += thinkSnip.Render(" " + m.thinkSnip)
	}
	return s
}

// --- shimmer / pulse animation math --------------------------------------------------------

type rgb struct{ r, g, b float64 }

func (c rgb) hex() string {
	return fmt.Sprintf("#%02X%02X%02X", int(c.r), int(c.g), int(c.b))
}

func lerpRGB(a, b rgb, t float64) rgb {
	if t < 0 { t = 0 }
	if t > 1 { t = 1 }
	return rgb{
		r: a.r + (b.r-a.r)*t,
		g: a.g + (b.g-a.g)*t,
		b: a.b + (b.b-a.b)*t,
	}
}

var (
	baseRGB    = rgb{215, 119, 87}  // colAccent (#D77757) - terracotta/orange
	shimmerRGB = rgb{255, 255, 255} // pure bright white for maximum shine
	errorRGB   = rgb{220, 50, 70}   // colErr (#DC3246) - red
)

func renderShimmerVerb(verb string, tickIdx int, stalledIntensity float64, isToolPulse bool) string {
	curBase := lerpRGB(baseRGB, errorRGB, stalledIntensity)
	curShimmer := lerpRGB(shimmerRGB, errorRGB, stalledIntensity)

	if isToolPulse {
		// Pulse breathing: sine wave over time (40 ticks = 2 seconds full cycle)
		phase := float64(tickIdx%40) / 40.0
		intensity := math.Sin(phase * math.Pi)
		curColor := lerpRGB(curBase, curShimmer, intensity)
		return lipgloss.NewStyle().Foreground(lipgloss.Color(curColor.hex())).Render(verb)
	}

	// Shimmer sweep: cycle length = verb length + 20 padding
	runes := []rune(verb)
	cycleLength := len(runes) + 20
	glimmerIdx := (tickIdx / 2) % cycleLength
	glimmerIdx -= 10 // offset so the glimmer sweeps in from outside the word

	var b strings.Builder
	for i, r := range runes {
		dist := math.Abs(float64(i - glimmerIdx))
		var c rgb
		if dist < 0.5 {
			c = curShimmer
		} else if dist < 1.5 {
			c = lerpRGB(curBase, curShimmer, 0.4) // halo
		} else if dist < 2.5 {
			c = lerpRGB(curBase, curShimmer, 0.1) // faint halo
		} else {
			c = curBase
		}
		b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color(c.hex())).Render(string(r)))
	}
	return b.String()
}

// workingView: braille spinner + a bold "⏺ Generating… Ns" clock + cancel hint while the answer streams.
func (m model) workingView() string {
	return m.spin.View() + " " + workLabel.Render("⏺ Generating… "+fmtElapsed(m.elapsed)) + statusStyle.Render(" · esc to stop")
}

// toolingView: the same persistent indicator while the model is running tools, so "still working,
// Ns elapsed, esc to stop" stays visible through the tool-call phase (not just text generation).
func (m model) toolingView() string {
	n := len(m.runningTools)
	label := "⚙ Running tool… "
	if n > 1 {
		label = fmt.Sprintf("⚙ Running %d tools… ", n)
	}
	return m.spin.View() + " " + workLabel.Render(label+fmtElapsed(m.elapsed)) + statusStyle.Render(" · esc to stop")
}

// --- structured log view (Ctrl+O) ----------------------------------------------------------

// logView renders the last 12 logs as a TIME | LEVEL | MESSAGE table (Ink LogView.tsx).
func (m model) logView() string {
	logs := m.logs
	if len(logs) > 12 {
		logs = logs[len(logs)-12:]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n", logHdr.Render(fmt.Sprintf("%-10s %-7s %s", "TIME", "LEVEL", "MESSAGE")))
	if len(logs) == 0 {
		b.WriteString(subtleStyle.Render("No logs available yet."))
		return logPanel.Width(m.width - 6).Render(b.String())
	}
	for _, lg := range logs {
		st := logInfo
		switch lg.Level {
		case "error":
			st = logErr
		case "warn":
			st = logWarn
		case "success":
			st = logOK
		case "debug":
			st = logDim
		}
		fmt.Fprintf(&b, "%s %s %s\n", logTime.Render(fmt.Sprintf("%-10s", logTimeStr(lg.Timestamp))), st.Render(fmt.Sprintf("%-7s", strings.ToUpper(lg.Level))), st.Render(clip(lg.Text, m.width-24)))
	}
	return logPanel.Width(m.width - 6).Render(strings.TrimRight(b.String(), "\n"))
}

// logTimeStr formats an ISO timestamp to HH:MM:SS (best-effort).
func logTimeStr(iso string) string {
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.Format("15:04:05")
	}
	return ""
}

// --- token meter ---------------------------------------------------------------------------

// filledCells is ProgressBar.tsx's geometry: how many of width cells are filled for a [0,1] fraction.
func filledCells(fraction float64, width int) int {
	if width <= 0 || math.IsNaN(fraction) {
		return 0
	}
	if fraction < 0 {
		fraction = 0
	}
	if fraction > 1 {
		fraction = 1
	}
	return int(math.Round(fraction * float64(width)))
}

// tokenMeterView renders the right-aligned model + context-usage bar + token estimate (Ink token
// meter line). Empty until the engine has reported a model via ui_snapshot.
func (m model) tokenMeterView() string {
	// Show the model that will actually handle the turn — lite by default, coding when the tier is
	// heavy — so the meter matches the footer pointer (it used to always show the coding model, which
	// made it look like minimax was answering even while step-fun was).
	model := m.fLite
	if m.fTier == "heavy" {
		model = m.fCoding
	}
	if model == "" {
		model = m.fCoding
	}
	if model == "" {
		model = m.fLite
	}
	if model == "" {
		return ""
	}
	// "Tokens that will be sent" = fixed baseline (system prompt + tool schemas) + the live
	// conversation, matching Ink's meter — not just the streamed reply (which read as ~0%). The
	// in-flight stream is added too so the meter visibly grows while a reply generates.
	tokens := m.ctxBaseline + m.histTokens + len([]rune(m.stream))/4
	var b strings.Builder
	if m.ctxWindow > 0 {
		const w = 12
		frac := float64(tokens) / float64(m.ctxWindow)
		filled := filledCells(frac, w)
		pct := int(math.Round(frac * 100))
		if pct > 100 {
			pct = 100
		}
		fmt.Fprintf(&b, "%s%s%s", meterFill.Render(strings.Repeat("█", filled)), meterEmpty.Render(strings.Repeat("░", w-filled)), meterText.Render(fmt.Sprintf(" %d%%  ", pct)))
	}
	fmt.Fprintf(&b, "%s", meterText.Render(fmt.Sprintf("%s · ~%s tok", shortModel(model), humanCount(tokens))))
	// Headroom compression: show cumulative tokens saved so the user sees it paying off.
	if m.ctxSaved > 0 {
		fmt.Fprintf(&b, "%s", logOK.Render(fmt.Sprintf(" · ⚡ -%s", humanCount(m.ctxSaved))))
	}
	// m.width-1, not full width — a line that fills the terminal auto-wraps and ghosts on resize.
	return lipgloss.PlaceHorizontal(m.width-1, lipgloss.Right, b.String())
}
