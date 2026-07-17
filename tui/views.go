package main

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/reflow/wordwrap"
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
	case m.hasRunningTool():
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
			fmt.Fprintf(&b, "%s\n", renderDiffAt(m.reqBody, m.reqScroll, diffApprovalRows, m.width-8, ""))
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

		hints := "↑/↓ navigate · enter to submit · esc to dismiss"
		if m.reqIsMulti {
			hints = "↑/↓ navigate · space select · enter to submit · esc to dismiss"
		}
		if m.reqKind == "diff" && len(parseDiffRows(m.reqBody)) > diffApprovalRows {
			hints += " · PgUp/PgDn scroll diff"
		}
		b.WriteString(dimStyle.Render(hints))
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
// osc8 wraps text in an OSC-8 terminal hyperlink; modern terminals make it clickable and
// degrade gracefully everywhere else (the escape bytes are invisible).
func osc8(url, text string) string {
	return "\x1b]8;;" + url + "\x07" + text + "\x1b]8;;\x07"
}

// menuRow renders one option row fitted to `width` printable cells: bold-ish label column,
// dim description truncated with an ellipsis (never wrapped), optional ↗ link suffix.
func menuRow(op menuOption, width int, selected bool) string {
	labelW := 24
	if width < 60 {
		labelW = 18
	}
	label := op.Label
	if len([]rune(label)) > labelW {
		label = string([]rune(label)[:labelW-1]) + "…"
	}
	descW := width - labelW - 6 // "❯ " + gap + margins
	if op.Link != "" {
		descW -= 7 // room for " ↗ docs"
	}
	desc := op.Desc
	if descW > 3 && len([]rune(desc)) > descW {
		desc = strings.TrimRight(string([]rune(desc)[:descW-1]), " ") + "…"
	}
	row := fmt.Sprintf("%-*s %s", labelW, label, desc)
	var out string
	if selected {
		out = compSel.Render("❯ " + row)
	} else {
		out = "  " + dimStyle.Render(row)
	}
	if op.Link != "" {
		out += " " + linkStyle.Render(osc8(op.Link, "↗ docs"))
	}
	return out
}

// menuView renders the interactive picker: title, optional subtitle, category tabs (when the
// options are grouped), a live search line, then the windowed option rows with section headers
// on the "All" tab. Rows are width-fitted — descriptions truncate instead of wrapping.
func (m model) menuView() string {
	opts := m.filteredMenu()
	idx := m.menuIdx
	if idx >= len(opts) {
		idx = 0
	}
	width := m.width
	if width <= 0 {
		width = 100
	}
	var b strings.Builder
	title := m.menuTitle
	if m.menuFilter != "" {
		title += fmt.Sprintf("  (%d/%d)", len(opts), len(m.menuOpts))
	}
	fmt.Fprintf(&b, "%s\n", dashTitle.Render(title))
	if m.menuSubtitle != "" {
		fmt.Fprintf(&b, "%s\n", subtleStyle.Render(linkifyURLs(m.menuSubtitle)))
	}

	// Category tab bar — only for grouped menus. The active tab is an ember block; a live
	// search overrides tabs (searches all rows), so show it dimmed while filtering.
	if len(m.menuTabs) > 0 {
		tabs := append([]string{"All"}, m.menuTabs...)
		var tb strings.Builder
		for i, t := range tabs {
			name := " " + t + " "
			if i == m.menuTab && m.menuFilter == "" {
				tb.WriteString(menuTabActive.Render(name))
			} else {
				tb.WriteString(menuTabIdle.Render(name))
			}
			if i < len(tabs)-1 {
				tb.WriteString(" ")
			}
		}
		fmt.Fprintf(&b, "%s\n", tb.String())
	}

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
		fmt.Fprintf(&b, "  %s\n", subtleStyle.Render(fmt.Sprintf("↑ %d more", start)))
	}
	// Section headers appear on the ungrouped ("All") view of a grouped menu, whenever the
	// category changes between consecutive visible rows.
	showSections := len(m.menuTabs) > 0 && m.menuTab == 0 && m.menuFilter == ""
	lastCat := ""
	if showSections && start > 0 {
		lastCat = opts[start-1].Category // don't repeat a header continued from above the window
	}
	for i := start; i < end; i++ {
		op := opts[i]
		if showSections && op.Category != "" && op.Category != lastCat {
			fmt.Fprintf(&b, "  %s\n", menuSection.Render(strings.ToUpper(op.Category)))
		}
		lastCat = op.Category
		fmt.Fprintf(&b, "%s\n", menuRow(op, width, i == idx))
	}
	if end < len(opts) {
		fmt.Fprintf(&b, "  %s\n", subtleStyle.Render(fmt.Sprintf("↓ %d more", len(opts)-end)))
	}
	hints := "↑↓ move · enter select · esc close · type to search"
	if len(m.menuTabs) > 0 {
		hints = "↑↓ move · ←→ tabs · enter select · esc close · type to search"
	}
	fmt.Fprintf(&b, "%s\n", subtleStyle.Render(hints))
	return strings.TrimRight(b.String(), "\n")
}

// linkifyURLs turns bare https:// URLs inside a line into OSC-8 hyperlinks (visible text unchanged).
func linkifyURLs(s string) string {
	if !strings.Contains(s, "https://") {
		return s
	}
	var out strings.Builder
	for {
		i := strings.Index(s, "https://")
		if i < 0 {
			out.WriteString(s)
			break
		}
		out.WriteString(s[:i])
		rest := s[i:]
		end := strings.IndexAny(rest, " )>,\t")
		if end < 0 {
			end = len(rest)
		}
		url := rest[:end]
		out.WriteString(osc8(url, url))
		s = rest[end:]
	}
	return out.String()
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

// modeChip renders the active agent mode as a bold, uppercase, per-mode colored block. general is
// yellow (the base); explore/sketch/code/beast each get a distinct hue so cycling with Shift+Tab is
// obvious. Empty → general (a fresh session starts there).
func modeChip(mode string) string {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		mode = "general"
	}
	c, ok := modeChipColor[mode]
	if !ok {
		c = colWarn
	}
	return modeChipBase.Background(c).Render(strings.ToUpper(mode))
}

// footerLine renders the status line + hints + model/tier bar, mirroring Ink's Footer.tsx: a left
// status glyph + text, then right-aligned goals · stream meta · hint chord · model/tier.
func (m model) footerLine() string {
	icon, txt := footerIdle.Render("● "), footerIdle.Render(m.status)
	if strings.Contains(m.status, "Requires AST Index") || strings.Contains(m.status, "run /index first") {
		icon, txt = warnStyle.Render("● "), warnStyle.Render(m.status)
	} else if m.busy {
		icon, txt = footerIcon.Render("● "), dimStyle.Render(m.status)
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
	// Mind strip: what the agent knows about itself right now. Warn-tinted when it's actively
	// routing around weak spots or the codebase is off its setpoints; quiet otherwise (/self).
	// Ctrl+X opens the HUD that explains these counters with the evidence behind them.
	if m.fMind.WeakSpots > 0 || m.fMind.DriveDeviations > 0 {
		var parts []string
		if m.fMind.WeakSpots > 0 {
			parts = append(parts, fmt.Sprintf("%d weak", m.fMind.WeakSpots))
		}
		if m.fMind.DriveDeviations > 0 {
			parts = append(parts, fmt.Sprintf("%d drive", m.fMind.DriveDeviations))
		}
		core = append(core, warnStyle.Render("◇ "+strings.Join(parts, " · ")+" ⌃X"))
	} else if m.fMind.Habits > 0 {
		core = append(core, footerHint.Render(fmt.Sprintf("◇ %d habits ⌃X", m.fMind.Habits)))
	}
	// Multi-repo workspace chip: visible whenever the session spans more than one repo, so the
	// user always knows the working set. Short names inline while they fit; count otherwise.
	if m.fWorkspace.Count > 1 {
		label := fmt.Sprintf("⌂ %d repos", m.fWorkspace.Count)
		if joined := strings.Join(m.fWorkspace.Names, "+"); len(joined) <= 24 && joined != "" {
			label = "⌂ " + joined
		}
		core = append(core, footerHint.Render(label))
	}
	if m.busy {
		// Only numbers that are TRUE go on screen: streamed characters (counted) and elapsed time
		// (measured). The old "tok/s" was chars/4/elapsed — an estimate dressed up as telemetry.
		meta := fmt.Sprintf("%s chars", humanCount(len([]rune(m.stream))))
		if m.elapsed > 0 {
			meta += fmt.Sprintf(" · %ds", m.elapsed)
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
	// Mode is no longer buried in the gray model string — it's a bold, per-mode colored CHIP so the
	// active mode (and how it changes as you Shift+Tab) is unmissable. The connected-MCP count rides
	// alongside it in the same loud family.
	modeRendered := modeChip(m.fMode)
	if m.fMcp > 0 {
		modeRendered += " " + mcpChipStyle.Render(fmt.Sprintf("▸ %d mcp", m.fMcp))
	}

	mstr := ""
	if m.fPinned != "" {
		mstr += "◈ " // pinned → this model handles every turn, no auto-switch
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
	hints := footerHint.Render("Ctrl+G actions · Ctrl+F search · Ctrl+O activity · Esc stash")

	// Build to m.width-5, NOT the full width. A line that fills the last column trips the terminal's
	// auto-wrap, which slides the cursor to the next row and desyncs Bubble Tea's inline clear — the
	// whole live region then stacks/multiplies on every update (the doubled footer + repeated meters).
	// The -5 (vs -1) leaves a 5-cell margin so ambiguous-width glyphs (✻/⇧/📌/▸) rendered wider than
	// measured still can't push the line into the last column.
	w := m.width - 5
	// The mode chip + MCP segment always survive (most important state); hints drop first when tight.
	withHints := strings.Join(append(append([]string{}, core...), hints, modeRendered, modelRendered), footerSep)
	rightStr := withHints
	if lipgloss.Width(left)+lipgloss.Width(withHints)+1 > w {
		rightStr = strings.Join(append(append([]string{}, core...), modeRendered, modelRendered), footerSep)
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

// stoppingView is the single truthful indicator once an interrupt has been sent: the old verb kept
// animating ("Thinking…") for the second or two the engine needed to unwind, which read as "my esc
// was ignored". One calm line, no "esc to stop" hint (it already happened), until the turn ends.
func (m model) stoppingView() string {
	if reducedMotion {
		return workLabel.Render("● Stopping… " + fmtElapsed(m.elapsed))
	}
	return m.spin.View() + " " + workLabel.Render("● Stopping… "+fmtElapsed(m.elapsed))
}

func (m model) thinkingView() string {
	if m.interrupting {
		return m.stoppingView()
	}
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

	isToolPulse := m.hasRunningTool()
	verb := "Executing tool"
	if !isToolPulse {
		// Cycle verbs every 4.0 seconds (80 ticks at 50ms/tick) so the shimmer animation has time to finish
		verbIdx := (m.thinkTick / 80) % len(spinnerVerbs)
		verb = spinnerVerbs[verbIdx]
	}

	// Reduced motion: one static row. No braille spinner, no per-frame shimmer sweep, no dot
	// rotation — only the whole-second elapsed clock changes. Same information, zero animation.
	if reducedMotion {
		return workLabel.Render("● "+verb+" · "+fmtElapsed(m.elapsed)) + m.tierTag() + statusStyle.Render(" · esc to stop")
	}

	shimmerText := renderShimmerVerb(verb, m.thinkTick, stalledIntensity, isToolPulse)
	dots := strings.Repeat(".", m.thinkDots)

	s := m.spin.View() + " " + workLabel.Render("● ") + shimmerText + workLabel.Render(dots+" "+fmtElapsed(m.elapsed)) + m.tierTag() + statusStyle.Render(" · esc to stop")
	if blk := m.thinkBlock(); blk != "" {
		s = blk + "\n" + s
	} else if m.thinkSnip != "" {
		s += thinkSnip.Render(" " + m.thinkSnip)
	}
	return s
}

// thinkBlock renders the live reasoning stream: the last few wrapped lines of thinkBuf in the same
// dim italic as committed "Thought" lines. Long silent reasoning phases (20s+ on step-3.7/QwQ) used
// to render as a bare spinner — indistinguishable from a hang; this shows the model actually working.
// Capped at 5 rows so the live region never grows unbounded (the View top-clip protects the frame).
func (m model) thinkBlock() string {
	if strings.TrimSpace(m.thinkBuf) == "" {
		return ""
	}
	width := m.width - 4
	if width < 20 {
		width = 20
	}
	text := strings.TrimSpace(strings.Join(strings.Fields(m.thinkBuf), " "))
	wrapped := strings.Split(wordwrap.String(text, width), "\n")
	const rows = 5
	if len(wrapped) > rows {
		wrapped = wrapped[len(wrapped)-rows:]
	}
	for i, l := range wrapped {
		wrapped[i] = thinkSnip.Render("  " + l)
	}
	return strings.Join(wrapped, "\n")
}

// tierTag names which slot is handling this turn, in the product's one vocabulary (Work · Quick ·
// Vision). Rides the live working indicator so the routing decision is visible as it happens.
func (m model) tierTag() string {
	if m.fTier == "heavy" {
		return footerTier.Render(" · work")
	}
	return subtleStyle.Render(" · quick")
}

// --- shimmer / pulse animation math --------------------------------------------------------

type rgb struct{ r, g, b float64 }

func (c rgb) hex() string {
	return fmt.Sprintf("#%02X%02X%02X", int(c.r), int(c.g), int(c.b))
}

func lerpRGB(a, b rgb, t float64) rgb {
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	return rgb{
		r: a.r + (b.r-a.r)*t,
		g: a.g + (b.g-a.g)*t,
		b: a.b + (b.b-a.b)*t,
	}
}

var (
	baseRGB    = rgb{215, 133, 98}  // colAccent (#D78562) — ember
	shimmerRGB = rgb{232, 255, 248} // near-white with a cool phosphor cast for the highlight
	errorRGB   = rgb{223, 118, 111} // colErr (#DF766F) — the stall tint mirrors the real error token
)

// renderShimmerVerb renders the working verb as a single CALM whole-word breath — one phosphor pulse
// on a slow sine, not a per-character glimmer sweep. It reads as "alive and focused" without the
// frenetic recolor-every-glyph churn (the old sweep was the "busy, not calm" tell). A stall tints the
// whole word toward red; the tool phase breathes a touch faster than the thinking phase.
func renderShimmerVerb(verb string, tickIdx int, stalledIntensity float64, isToolPulse bool) string {
	curBase := lerpRGB(baseRGB, errorRGB, stalledIntensity)
	curShimmer := lerpRGB(shimmerRGB, errorRGB, stalledIntensity)

	period := 60 // ticks per full breath — ~3s at 50ms/tick (calm); tool phase a little quicker
	if isToolPulse {
		period = 44
	}
	phase := float64(tickIdx%period) / float64(period)
	intensity := math.Sin(phase * math.Pi) // 0 → 1 → 0 across the breath
	c := lerpRGB(curBase, curShimmer, intensity)
	return lipgloss.NewStyle().Foreground(lipgloss.Color(c.hex())).Render(verb)
}

// workingView: braille spinner + a bold "⏺ Generating… Ns" clock + cancel hint while the answer streams.
func (m model) workingView() string {
	if m.interrupting {
		return m.stoppingView()
	}
	if reducedMotion {
		return workLabel.Render("● Generating… "+fmtElapsed(m.elapsed)) + m.tierTag() + statusStyle.Render(" · esc to stop")
	}
	return m.spin.View() + " " + workLabel.Render("● Generating… "+fmtElapsed(m.elapsed)) + m.tierTag() + statusStyle.Render(" · esc to stop")
}

// toolingView: the same persistent indicator while the model is running tools, so "still working,
// Ns elapsed, esc to stop" stays visible through the tool-call phase (not just text generation).
func (m model) toolingView() string {
	if m.interrupting {
		return m.stoppingView()
	}
	n := m.runningToolCount()
	label := "▚ Running tool… "
	if n > 1 {
		label = fmt.Sprintf("▚ Running %d tools… ", n)
	}
	return m.spin.View() + " " + workLabel.Render(label+fmtElapsed(m.elapsed)) + m.tierTag() + statusStyle.Render(" · esc to stop")
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

// --- ambient repo-health line ---------------------------------------------------------------

// miniSpark renders a drive's ok/deviating history (1 = at setpoint, 0 = off) as a tiny two-level
// sparkline — ▇ healthy, ▁ deviating — capped to the most recent points. Both glyphs are one cell.
func miniSpark(spark []int) string {
	if len(spark) == 0 {
		return ""
	}
	s := spark
	if len(s) > 10 {
		s = s[len(s)-10:]
	}
	var b strings.Builder
	for _, v := range s {
		if v == 1 {
			b.WriteString("▇")
		} else {
			b.WriteString("▁")
		}
	}
	return b.String()
}

// healthLineView is the ambient "instrument watching the workshop": a single compact line pinned
// above the prompt that surfaces ONLY the drives currently off their setpoint (build red, type
// errors, TODO debt, tree hygiene…), each with its measurement and a mini sparkline. When every
// drive is at setpoint it renders nothing — calm by default, it speaks only when something slips.
// Data is already on the wire (ui_snapshot.mind.drives); this just reads it. Ctrl+X for the full HUD.
func (m model) healthLineView() string {
	var dev []MindDrive
	for _, d := range m.fMind.Drives {
		if !d.Ok {
			dev = append(dev, d)
		}
	}
	if len(dev) == 0 {
		return ""
	}
	if len(dev) > 3 { // one line, top offenders only (deviating drives sort first upstream)
		dev = dev[:3]
	}
	parts := make([]string, 0, len(dev))
	for _, d := range dev {
		seg := warnStyle.Render(clip(d.Value, 34))
		if sp := miniSpark(d.Spark); sp != "" {
			seg += " " + subtleStyle.Render(sp)
		}
		parts = append(parts, seg)
	}
	line := warnStyle.Render("◇ ") + strings.Join(parts, footerSep) + subtleStyle.Render("  ⌃X")
	// Never reach the last column — a full-width line ghosts on resize (same rule as the map/meter).
	return lipgloss.NewStyle().MaxWidth(m.width - 2).Render(line)
}

// outcomeStripView is the single compact, truthful task strip from MASTER_CLI.md. Counts come from
// the engine's completion gate—not model prose—so "4/6 passed" always means attributed evidence.
func (m model) outcomeStripView() string {
	o := m.fOutcome
	if o == nil || strings.TrimSpace(o.Objective) == "" {
		return ""
	}
	phase := strings.ToUpper(strings.ReplaceAll(o.Phase, "_", " "))
	parts := []string{fmt.Sprintf("LOOP %d", max(1, o.Iteration)), phase}
	if o.Required > 0 {
		parts = append(parts, fmt.Sprintf("%d/%d PASSED", o.Passed, o.Required))
	}
	if o.OpenGaps > 0 {
		parts = append(parts, fmt.Sprintf("%d GAPS", o.OpenGaps))
	}
	if o.OpenTasks > 0 {
		parts = append(parts, fmt.Sprintf("%d TASKS", o.OpenTasks))
	}
	if o.Schedule.ParallelTasks > 0 {
		parts = append(parts, fmt.Sprintf("%d∥", o.Schedule.ParallelTasks))
	}
	if o.Schedule.ActiveAgents > 0 {
		parts = append(parts, fmt.Sprintf("RUN %d", o.Schedule.ActiveAgents))
	}
	if o.RecoveringTasks > 0 {
		parts = append(parts, fmt.Sprintf("RECOVER %d", o.RecoveringTasks))
	}
	if o.ContinuationState == "running" || o.ContinuationState == "pending" {
		parts = append(parts, fmt.Sprintf("AUTO %d", o.ContinuationWakeups))
	} else if o.ContinuationState == "halted" {
		parts = append(parts, "AUTO PAUSED")
	}
	if o.Schedule.ReadyTasks > 0 {
		parts = append(parts, fmt.Sprintf("READY %d", o.Schedule.ReadyTasks))
	}
	if o.Schedule.WaitingTasks > 0 {
		parts = append(parts, fmt.Sprintf("WAIT %d", o.Schedule.WaitingTasks))
	}
	if o.Schedule.BlockedTasks > 0 {
		parts = append(parts, fmt.Sprintf("BLOCK %d", o.Schedule.BlockedTasks))
	}
	if o.Schedule.CriticalTaskTitle != "" {
		parts = append(parts, "CRIT "+clip(o.Schedule.CriticalTaskTitle, 24))
	}
	if o.ElapsedMs >= 60_000 {
		parts = append(parts, fmt.Sprintf("%dm", o.ElapsedMs/60_000))
	}
	style := footerTier
	if o.Phase == "blocked" || o.Phase == "failed" {
		style = warnStyle
	} else if o.CanComplete || o.Phase == "verified" {
		style = logOK
	}
	line := style.Render("◆ "+strings.Join(parts, " · ")) + subtleStyle.Render("  "+clip(o.Objective, 52))
	return lipgloss.NewStyle().MaxWidth(m.width - 2).Render(line)
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
		fmt.Fprintf(&b, "%s", logOK.Render(fmt.Sprintf(" · ↯ -%s", humanCount(m.ctxSaved))))
	}
	// m.width-1, not full width — a line that fills the terminal auto-wraps and ghosts on resize.
	return lipgloss.PlaceHorizontal(m.width-1, lipgloss.Right, b.String())
}
