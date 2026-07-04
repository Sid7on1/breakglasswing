package main

import (
	"fmt"
	"strings"
)

// The Ctrl+X mind HUD — the 🧠 chip made explainable (v2 §3.11). Instead of an opaque
// counter, the agent shows its receipts: which tool×domain cells the self-model has
// learned to distrust (with the posterior failure rate and sample count behind the
// call), which codebase drives are off their setpoints (with a measurement sparkline),
// and which procedures have compiled into deterministic habits. Low-chrome: one quiet
// bordered panel in the warm theme, data-first, no decoration for its own sake.

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

// mindHudView renders the full mind panel. Width-aware; returns "" when the terminal is
// too narrow to render anything useful.
func (m model) mindHudView() string {
	if m.width < 30 {
		return ""
	}
	inner := m.width - 10
	var b strings.Builder

	fmt.Fprintf(&b, "%s%s\n", dashTitle.Render("◇ Mind"), subtleStyle.Render("  — what the agent has learned about itself here"))

	// --- Weak spots: the self-model's posterior distrust, with the evidence. ---
	b.WriteString(dashColor("yellow").Render("Weak spots"))
	if len(m.fMind.Weak) == 0 {
		fmt.Fprintf(&b, "\n  %s\n", subtleStyle.Render("none — no tool×domain cell is failing above the decision threshold"))
	} else {
		b.WriteString("\n")
		for _, w := range m.fMind.Weak {
			cell := fmt.Sprintf("%s · %s", w.Tool, w.Domain)
			stats := fmt.Sprintf("%2.0f%% fail  (n=%d, P=%0.2f)", w.FailRate*100, w.N, w.PWeak)
			fmt.Fprintf(&b, "  %s %s %s\n", warnStyle.Render("▲"), dashVal.Render(fmt.Sprintf("%-28s", clip(cell, 28))), warnStyle.Render(stats))
			if w.Advice != "" {
				fmt.Fprintf(&b, "    %s\n", subtleStyle.Render("↳ "+clip(w.Advice, inner-6)))
			}
		}
	}

	// --- Drives: homeostasis vs. setpoints, sparkline of recent measurements. ---
	b.WriteString(dashColor("cyan").Render("Drives"))
	if len(m.fMind.Drives) == 0 {
		fmt.Fprintf(&b, "\n  %s\n", subtleStyle.Render("not measured yet — /drives check runs the sensors"))
	} else {
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
	}

	// --- Ledger: the verification posture — did the agent's edits get checked? ---
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

	// --- Habits: procedures compiled from repetition into deterministic macros. ---
	b.WriteString(dashColor("green").Render("Habits"))
	if len(m.fMind.HabitNames) == 0 {
		fmt.Fprintf(&b, "\n  %s\n", subtleStyle.Render("none compiled yet — recurring successful sequences become macros"))
	} else {
		b.WriteString("\n")
		for _, h := range m.fMind.HabitNames {
			fmt.Fprintf(&b, "  %s %s\n", okStyle.Render("⚙"), dashVal.Render(clip(h, inner-4)))
		}
	}

	b.WriteString(subtleStyle.Render("/self · /drives · /habits for full reports — Ctrl+X or Esc to close"))
	return dashPanel.Width(m.width - 6).Render(strings.TrimRight(b.String(), "\n"))
}
