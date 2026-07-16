# Vendored dependency patches

The `vendor/` tree is committed and is the source of truth for TUI builds (`go build -mod=vendor`
is the default when vendor/ exists). Patches applied on top of the upstream modules:

## github.com/charmbracelet/bubbletea v1.3.10 — `tea_init.go`

Upstream runs `lipgloss.HasDarkBackground()` in package `init()` ("workaround" removed in v2).
On terminals that don't answer the OSC-11 background query this blocks startup for the full
termenv OSC timeout (measured ~6.8s before the first frame) and the response reader consumes
any bytes the user typed while frozen — i.e. a frozen launch that eats your first prompt.

Bimax pins the background itself in `initAccessibility()` (`lipgloss.SetHasDarkBackground`,
`BIMAX_LIGHT_BG=1` to flip), before any style renders, so the terminal is never queried.
The vendored `tea_init.go` is therefore reduced to a comment.

Re-vendoring: `go mod vendor` will RESTORE the upstream file — reapply this patch afterwards
(the PTY lifecycle test `TestStartupNoOSCQuery` fails if the query comes back).
