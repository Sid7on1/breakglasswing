package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// §9: the design language (docs/DESIGN_LANGUAGE.md) is enforced STRUCTURALLY, not by review
// vigilance. Three gates:
//   1. Drift sweep — no raw colour literal may exist outside styles.go (markdown.go's chroma
//      syntax theme is the one documented exception).
//   2. Contract — every token styles.go defines must carry exactly the hex the design-language
//      doc publishes for it. Editing one without the other fails CI.
//   3. Parity — the shared Moonlight tokens must match the Electron app's styles.css, so
//      the two frontends can't quietly diverge.
// Plus semantic-binding checks: the ok/err/warn styles must be bound to the token their name
// says (the stall-tint bug of 9eefbda5 — a style mirroring the WRONG token — stays fixed).

var hexRE = regexp.MustCompile(`#[0-9A-Fa-f]{6}`)

func TestNoColourLiteralsOutsideStyles(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if f == "styles.go" || f == "markdown.go" || strings.HasSuffix(f, "_test.go") {
			continue // styles.go is the token source; markdown.go holds the chroma syntax theme
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(src), "\n") {
			if strings.Contains(line, `lipgloss.Color("`) {
				t.Errorf("%s:%d defines a raw lipgloss.Color — add a token to styles.go instead", f, i+1)
			}
			if m := hexRE.FindString(line); m != "" && strings.Contains(line, `"`+m+`"`) {
				t.Errorf("%s:%d carries raw hex %s — use a styles.go token", f, i+1, m)
			}
		}
	}
}

func TestTokensMatchDesignLanguageDoc(t *testing.T) {
	doc, err := os.ReadFile("../docs/DESIGN_LANGUAGE.md")
	if err != nil {
		t.Fatalf("design-language contract missing: %v", err)
	}
	// Parse the token table: | `colName` … | `#HEX` | …
	rowRE := regexp.MustCompile("\\|\\s*`(col\\w+)`[^|]*\\|\\s*`(#[0-9A-Fa-f]{6})`")
	documented := map[string]string{}
	for _, m := range rowRE.FindAllStringSubmatch(string(doc), -1) {
		documented[m[1]] = strings.ToUpper(m[2])
	}
	if len(documented) < 8 {
		t.Fatalf("token table not found in DESIGN_LANGUAGE.md (parsed %d rows)", len(documented))
	}
	actual := map[string]string{
		"colAccent": string(colAccent), "colShimmer": string(colShimmer), "colText": string(colText),
		"colInactive": string(colInactive), "colSubtle": string(colSubtle), "colDim": string(colDim),
		"colOK": string(colOK), "colErr": string(colErr), "colWarn": string(colWarn),
		"colInfo": string(colInfo), "colInk": string(colInk),
	}
	for name, wantHex := range documented {
		got, ok := actual[name]
		if !ok {
			continue // doc may describe tokens other surfaces own
		}
		if strings.ToUpper(got) != wantHex {
			t.Errorf("%s: styles.go has %s but DESIGN_LANGUAGE.md publishes %s — update BOTH or neither", name, got, wantHex)
		}
	}
	for name := range actual {
		if _, ok := documented[name]; !ok {
			t.Errorf("%s exists in styles.go but is undocumented in DESIGN_LANGUAGE.md's token table", name)
		}
	}
}

func TestTokenParityWithElectronApp(t *testing.T) {
	css, err := os.ReadFile("../app/src/renderer/src/styles.css")
	if err != nil {
		t.Skipf("app styles.css not present: %v", err)
	}
	varRE := regexp.MustCompile(`--color-([\w-]+):\s*(#[0-9A-Fa-f]{6})`)
	appTokens := map[string]string{}
	// First match wins: the leading @theme block is the default Moonlight palette the contract
	// covers; later Starlight/Moonlight blocks are explicit user themes with their own hexes.
	for _, m := range varRE.FindAllStringSubmatch(string(css), -1) {
		if _, seen := appTokens[m[1]]; !seen {
			appTokens[m[1]] = strings.ToUpper(m[2])
		}
	}
	// The shared Moonlight vocabulary — TUI token ↔ app custom property.
	shared := map[string]string{
		"ember": string(colAccent), "ember-bright": string(colShimmer),
		"ink": string(colText), "dim": string(colInactive), "faint": string(colSubtle),
		"line": string(colDim), "moss": string(colOK), "amber": string(colWarn), "rust": string(colErr),
	}
	for cssName, tuiHex := range shared {
		appHex, ok := appTokens[cssName]
		if !ok {
			t.Errorf("--color-%s missing from app styles.css", cssName)
			continue
		}
		if appHex != strings.ToUpper(tuiHex) {
			t.Errorf("--color-%s: app has %s, TUI has %s — the frontends diverged", cssName, appHex, tuiHex)
		}
	}
}

func TestSemanticStylesBoundToTheirTokens(t *testing.T) {
	// Compare the style's bound foreground against the token directly (rendering is profile-
	// dependent in a headless test env). Guards the 9eefbda5 class of bug: a style whose name
	// promises one token silently carrying another.
	cases := []struct {
		name string
		got  interface{}
		want interface{}
	}{
		{"errStyle", errStyle.GetForeground(), colErr},
		{"okStyle", okStyle.GetForeground(), colOK},
		{"warnStyle", warnStyle.GetForeground(), colWarn},
		{"userStyle", userStyle.GetForeground(), colAccent},
		{"subtleStyle", subtleStyle.GetForeground(), colSubtle},
		{"dimStyle", dimStyle.GetForeground(), colInactive},
		{"toolStyle", toolStyle.GetForeground(), colTool},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s is bound to %v, expected its token %v", c.name, c.got, c.want)
		}
	}
}
