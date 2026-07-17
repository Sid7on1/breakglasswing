package main

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// firstLine returns the first line of s, trimmed — so a multi-line prompt renders as a single row.
func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// clampInt bounds v to [lo, hi].
func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// clip truncates s to n runes with an ellipsis. Callers frequently pass a
// width computed from the terminal size (e.g. inner-44, budget-len(verb)-1),
// which can go <= 0 on a narrow terminal; guard against a negative slice bound
// so a small window never panics the whole TUI.
func clip(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n == 1 {
		return "…"
	}
	return string(r[:n-1]) + "…"
}

// indentLines prefixes every line of s with the given gutter, so a rendered block (markdown,
// streamed tokens) lines up under the rest of the transcript instead of sitting flush at column 0.
func indentLines(s, gutter string) string {
	if s == "" {
		return ""
	}
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		lines[i] = gutter + ln
	}
	return strings.Join(lines, "\n")
}

// digit returns the numeric value of a single-digit key press ('1'–'9'), or -1.
func digit(s string) int {
	if len(s) == 1 && s[0] >= '1' && s[0] <= '9' {
		return int(s[0] - '0')
	}
	return -1
}

// firstOr returns the first element of s, or def if s is empty.
func firstOr(s []string, def string) string {
	if len(s) > 0 {
		return s[0]
	}
	return def
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

// fmtElapsed renders seconds as "12s" or "3m 24s" so long waits read clearly (900s → "15m 00s")
// instead of a giant raw second count.
func fmtElapsed(secs int) string {
	if secs < 60 {
		return fmt.Sprintf("%ds", secs)
	}
	return fmt.Sprintf("%dm %02ds", secs/60, secs%60)
}

// sgrRE strips SGR color/style escapes so content assertions don't depend on theming.
var sgrRE = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func stripAnsi(s string) string { return sgrRE.ReplaceAllString(s, "") }

// urlHost extracts the display host from a URL ("https://app.example.com/x?y" → "app.example.com")
// for the live-browser footer chip. Falls back to a clipped raw string on unparseable input.
func urlHost(raw string) string {
	if u, err := url.Parse(raw); err == nil && u.Host != "" {
		return u.Host
	}
	if len(raw) > 24 {
		return raw[:24] + "…"
	}
	return raw
}
