package main

import (
	"strings"

	"github.com/charmbracelet/glamour"
)

// Markdown rendering for assistant output (bold, lists, and syntax-highlighted code blocks),
// in the low-chrome Moonlight look. glamour's built-in "dark" style is loud — a
// yellow-on-purple H1 bar, neon-pink inline code, and rainbow syntax over a solid grey block
// (the "static" look). We swap it for the BiMAX palette: silver headings, muted code,
// and NO code-block background fill. The renderer is width-dependent, so we cache it and rebuild
// only when the viewport width changes. Falls back to raw text if glamour ever errors.

// mdStyle is a glamour StyleConfig JSON tuned to Moonlight: silver hierarchy,
// flush-left margins, and a black code block with
// readable syntax colors so output reads as content, not chrome.
//
// WS3-B note — two palettes live here on purpose:
//  1. CHROME colours mirror the styles.go tokens; keep them in sync.
//  2. Code syntax uses a restrained silver scale, preserving structure without introducing hue.
//
// glamour requires literal hex inside this JSON blob (no Go-value interpolation), so these can't
// reference the tokens directly; the mapping above is the contract.
var moonlightStyle = []byte(`{
  "document": { "block_prefix": "", "block_suffix": "", "color": "#F5F5F4", "margin": 0 },
  "block_quote": { "color": "#B8B8B5", "indent": 1, "indent_token": "│ " },
  "paragraph": {},
  "list": { "level_indent": 2 },
  "heading": { "block_suffix": "\n", "color": "#EDEDEB", "bold": true },
  "h1": { "prefix": "", "suffix": "", "color": "#FFFFFF", "bold": true },
  "h2": { "prefix": "## ", "color": "#EDEDEB", "bold": true },
  "h3": { "prefix": "### ", "color": "#B8B8B5", "bold": true },
  "h4": { "prefix": "#### ", "color": "#B8B8B5", "bold": true },
  "h5": { "prefix": "##### ", "color": "#B8B8B5", "bold": true },
  "h6": { "prefix": "###### ", "color": "#B8B8B5", "bold": true },
  "text": {},
  "strong": { "color": "#F5F5F4", "bold": true },
  "emph": { "italic": true },
  "hr": { "color": "#303030", "format": "\n────────\n" },
  "item": { "block_prefix": "• " },
  "enumeration": { "block_prefix": ". " },
  "task": { "ticked": "[✓] ", "unticked": "[ ] " },
  "link": { "color": "#C4C4C1", "underline": true },
  "link_text": { "color": "#EDEDEB", "bold": true },
  "image": { "color": "#C4C4C1", "underline": true },
  "image_text": { "color": "#7C7C78", "format": "Image: {{.text}}" },
  "code": { "prefix": " ", "suffix": " ", "color": "#F5F5F4", "background_color": "#222222" },
  "code_block": {
    "color": "#D3D3CF",
    "background_color": "#111111",
    "margin": 2,
    "chroma": {
      "text": { "color": "#D3D3CF", "background_color": "#111111" },
      "error": { "color": "#FFFFFF" },
      "comment": { "color": "#7C7C78", "italic": true },
      "comment_preproc": { "color": "#B8B8B5" },
      "keyword": { "color": "#EDEDEB" },
      "keyword_reserved": { "color": "#EDEDEB" },
      "keyword_namespace": { "color": "#D3D3CF" },
      "keyword_type": { "color": "#FFFFFF" },
      "operator": { "color": "#B8B8B5" },
      "punctuation": { "color": "#B8B8B5" },
      "name": { "color": "#D3D3CF" },
      "name_variable": { "color": "#E2E2DF" },
      "name_builtin": { "color": "#EDEDEB" },
      "name_tag": { "color": "#E2E2DF" },
      "name_attribute": { "color": "#B9B9B4" },
      "name_class": { "color": "#FFFFFF", "bold": true },
      "name_constant": { "color": "#C4C4C1" },
      "name_decorator": { "color": "#D3D3CF" },
      "name_function": { "color": "#EDEDEB" },
      "literal": { "color": "#C4C4C1" },
      "literal_number": { "color": "#B9B9B4" },
      "literal_string": { "color": "#D3D3CF" },
      "literal_string_escape": { "color": "#B8B8B5" },
      "generic_deleted": { "color": "#E2E2DF" },
      "generic_inserted": { "color": "#D3D3CF" },
      "generic_emph": { "italic": true },
      "generic_strong": { "bold": true },
      "generic_subheading": { "color": "#7C7C78" },
      "background": { "background_color": "#111111" }
    }
  },
  "table": {},
  "definition_list": {},
  "definition_term": {},
  "definition_description": { "block_prefix": "\n🠶 " }
}`)

var (
	mdRenderer *glamour.TermRenderer
)

func renderMarkdown(src string) string {
	if mdRenderer == nil {
		r, err := glamour.NewTermRenderer(
			glamour.WithStylesFromJSONBytes(moonlightStyle),
			glamour.WithWordWrap(0), // Disable hard wrapping; we reflow dynamically on print
		)
		if err != nil {
			return src
		}
		mdRenderer = r
	}
	out, err := mdRenderer.Render(src)
	if err != nil {
		return src
	}
	// glamour pads with blank lines; trim so it sits flush in the transcript.
	return strings.Trim(out, "\n")
}
