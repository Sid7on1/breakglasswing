package tea

// PATCHED for Bimax (see tui/VENDOR_PATCHES.md): upstream v1.3.10 queried the terminal's
// background color here, in package init — before main() can run a single line. On terminals
// that never answer the OSC-11 query (some SSH clients, IDE-embedded terminals, test PTYs),
// termenv blocks for its 5s OSC timeout (~7s total with the follow-up cursor-position read)
// and, worse, the query reader CONSUMES whatever the user typed during the freeze. Bimax pins
// the background explicitly (initAccessibility → lipgloss.SetHasDarkBackground) before any
// style renders, so the query carries no information for us — the init is removed outright.
// Upstream removes it in bubbletea v2 as well.
