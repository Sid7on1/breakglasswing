package main

import (
	"fmt"
	"strings"
)

// The Ctrl+X mind HUD — the ◇ chip made explainable (v2 §3.11). Instead of an opaque
// counter, the agent shows its receipts: which tool×domain cells the self-model has
// learned to distrust (with the posterior failure rate and sample count behind the
// call), which codebase drives are off their setpoints (with a measurement sparkline),
// and which procedures have compiled into deterministic habits. Low-chrome: one quiet
// bordered panel in the graphite theme, data-first, no decoration for its own sake.
//
// Tabbed: overview shows every section at a glance; Tab/Shift+Tab page through the
// individual sections when one deserves the full panel.

// mindTabCount / names: 0 = overview renders all sections; the rest render one each.
const mindTabCount = 5

var mindTabNames = [mindTabCount]string{"overview", "weak spots", "drives", "ledger", "habits"}

// sparkline renders a 0/1 history (oldest → newest) as a block-wave: ▁ for a deviating
// measurement, ▇ for one at setpoint. Deviations are tinted red so the eye finds the
// dip without reading the row.
func sparkline(history []int) string {
	if len(history) == 0 {
		return subtleStyle.Render("—")
	}
	var b strings.Builder
	for _, v := range history {
		if v > 0 {
			b.WriteString(okStyle.Render("▇"))
		} else {
			b.WriteString(errStyle.Render("▁"))
		}
	}
	return b.String()
}

// mindTabBar renders the section names with the active one in bright silver.
func (m model) mindTabBar() string {
	parts := make([]string, 0, mindTabCount)
	for i, name := range mindTabNames {
		if i == m.mindTab {
			parts = append(parts, compSel.Render(name))
		} else {
			parts = append(parts, subtleStyle.Render(name))
		}
	}
	return strings.Join(parts, subtleStyle.Render(" · "))
}

// --- Weak spots: the self-model's posterior distrust, with the evidence. ---
func (m model) mindWeakSection(inner int) string {
	var b strings.Builder
	b.WriteString(dashColor("yellow").Render("Weak spots"))
	if len(m.fMind.Weak) == 0 {
		fmt.Fprintf(&b, "\n  %s\n", subtleStyle.Render("none — no tool×domain cell is failing above the decision threshold"))
		return b.String()
	}
	b.WriteString("\n")
	for _, w := range m.fMind.Weak {
		cell := fmt.Sprintf("%s · %s", w.Tool, w.Domain)
		stats := fmt.Sprintf("%2.0f%% fail  (n=%d, P=%0.2f)", w.FailRate*100, w.N, w.PWeak)
		fmt.Fprintf(&b, "  %s %s %s\n", warnStyle.Render("▲"), dashVal.Render(fmt.Sprintf("%-28s", clip(cell, 28))), warnStyle.Render(stats))
		if w.Advice != "" {
			fmt.Fprintf(&b, "    %s\n", subtleStyle.Render("↳ "+clip(w.Advice, inner-6)))
		}
	}
	return b.String()
}

// --- Drives: homeostasis vs. setpoints, sparkline of recent measurements. ---
func (m model) mindDrivesSection(inner int) string {
	var b strings.Builder
	b.WriteString(dashColor("cyan").Render("Drives"))
	if len(m.fMind.Drives) == 0 {
		fmt.Fprintf(&b, "\n  %s\n", subtleStyle.Render("not measured yet — /drives check runs the sensors"))
		return b.String()
	}
	b.WriteString("\n")
	for _, d := range m.fMind.Drives {
		dot := okStyle.Render("●")
		if !d.Ok {
			dot = errStyle.Render("●")
		}
		fmt.Fprintf(&b, "  %s %s %s %s\n",
			dot,
			dashVal.Render(fmt.Sprintf("%-22s", clip(d.Label, 22))),
			sparkline(d.Spark),
			dimStyle.Render(clip(d.Value, inner-44)))
	}
	return b.String()
}

// --- Ledger: the verification posture — did the agent's edits get checked? ---
func (m model) mindLedgerSection() string {
	var b strings.Builder
	b.WriteString(dashColor("blue").Render("Ledger"))
	if L := m.fMind.Ledger; L == nil || (L.Resolved == 0 && L.Open == 0 && L.Expired == 0) {
		fmt.Fprintf(&b, "\n  %s\n", subtleStyle.Render("no claims yet — edits open a claim; a build/test that names the file resolves it"))
	} else {
		covDot := okStyle.Render("●")
		if L.CoveragePct < 40 { // verify-coverage setpoint
			covDot = warnStyle.Render("●")
		}
		fmt.Fprintf(&b, "\n  %s %s %s\n",
			covDot,
			dashVal.Render(fmt.Sprintf("%-22s", fmt.Sprintf("%d%% verified", L.CoveragePct))),
			dimStyle.Render(fmt.Sprintf("resolved %d · open %d · expired %d", L.Resolved, L.Open, L.Expired)))
		if L.Overconfident > 0 {
			plural := ""
			if L.Overconfident > 1 {
				plural = "s"
			}
			fmt.Fprintf(&b, "  %s %s\n", warnStyle.Render("▲"), warnStyle.Render(fmt.Sprintf("%d domain%s overconfident — escalate verification", L.Overconfident, plural)))
		} else {
			fmt.Fprintf(&b, "  %s\n", subtleStyle.Render("↳ calibration healthy — no domain shows an overconfidence gap"))
		}
	}
	return b.String()
}

// --- Habits: procedures compiled from repetition into deterministic macros. ---
func (m model) mindHabitsSection(inner int) string {
	var b strings.Builder
	b.WriteString(dashColor("green").Render("Habits"))
	if len(m.fMind.HabitNames) == 0 {
		fmt.Fprintf(&b, "\n  %s\n", subtleStyle.Render("none compiled yet — recurring successful sequences become macros"))
		return b.String()
	}
	b.WriteString("\n")
	for _, h := range m.fMind.HabitNames {
		fmt.Fprintf(&b, "  %s %s\n", okStyle.Render("▚"), dashVal.Render(clip(h, inner-4)))
	}
	return b.String()
}

// mindHudView renders the mind panel for the active tab. Width-aware; returns "" when
// the terminal is too narrow to render anything useful.
func (m model) mindHudView() string {
	if m.width < 30 {
		return ""
	}
	inner := m.width - 10
	var b strings.Builder

	fmt.Fprintf(&b, "%s  %s\n", dashTitle.Render("◇ Mind"), m.mindTabBar())

	switch m.mindTab {
	case 1:
		b.WriteString(m.mindWeakSection(inner))
	case 2:
		b.WriteString(m.mindDrivesSection(inner))
	case 3:
		b.WriteString(m.mindLedgerSection())
	case 4:
		b.WriteString(m.mindHabitsSection(inner))
	default: // overview — every section at a glance
		b.WriteString(m.mindWeakSection(inner))
		b.WriteString(m.mindDrivesSection(inner))
		b.WriteString(m.mindLedgerSection())
		b.WriteString(m.mindHabitsSection(inner))
	}

	b.WriteString(subtleStyle.Render("tab/shift+tab sections · /self /drives /habits full reports · Ctrl+X or Esc close"))
	return dashPanel.Width(m.width - 6).Render(strings.TrimRight(b.String(), "\n"))
}
