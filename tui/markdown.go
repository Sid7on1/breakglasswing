package main

import (
	"strings"

	"github.com/charmbracelet/glamour"
)

// Markdown rendering for assistant output (bold, lists, and syntax-highlighted code blocks),
// matching the Ink UI's warm, low-chrome look. glamour's built-in "dark" style is loud — a
// yellow-on-purple H1 bar, neon-pink inline code, and rainbow syntax over a solid grey block
// (the "static" look). We swap it for the warm BiMax palette: terracotta headings, muted code,
// and NO code-block background fill. The renderer is width-dependent, so we cache it and rebuild
// only when the viewport width changes. Falls back to raw text if glamour ever errors.

// warmStyle is a glamour StyleConfig JSON tuned to the Ink "dark" theme (src/cli/themes.ts):
// terracotta accent for headings/emphasis, bright-grey body text, flush-left margins, and a
// background-less code block with desaturated syntax colors so output reads as content, not chrome.
var warmStyle = []byte(`{
  "document": { "block_prefix": "", "block_suffix": "", "color": "#E6E6E6", "margin": 0 },
  "block_quote": { "color": "#A0A0A0", "indent": 1, "indent_token": "│ " },
  "paragraph": {},
  "list": { "level_indent": 2 },
  "heading": { "block_suffix": "\n", "color": "#D77757", "bold": true },
  "h1": { "prefix": "", "suffix": "", "color": "#F59575", "bold": true },
  "h2": { "prefix": "## ", "color": "#D77757", "bold": true },
  "h3": { "prefix": "### ", "color": "#D77757", "bold": true },
  "h4": { "prefix": "#### ", "color": "#D77757", "bold": true },
  "h5": { "prefix": "##### ", "color": "#D77757", "bold": true },
  "h6": { "prefix": "###### ", "color": "#D77757", "bold": true },
  "text": {},
  "strong": { "color": "#E6E6E6", "bold": true },
  "emph": { "italic": true },
  "hr": { "color": "#5A5A5A", "format": "\n────────\n" },
  "item": { "block_prefix": "• " },
  "enumeration": { "block_prefix": ". " },
  "task": { "ticked": "[✓] ", "unticked": "[ ] " },
  "link": { "color": "#57C7C7", "underline": true },
  "link_text": { "color": "#57C7C7", "bold": true },
  "image": { "color": "#57C7C7", "underline": true },
  "image_text": { "color": "#787878", "format": "Image: {{.text}}" },
  "code": { "prefix": " ", "suffix": " ", "color": "#E6C07B" },
  "code_block": {
    "color": "#C4C4C4",
    "margin": 2,
    "chroma": {
      "text": { "color": "#C4C4C4" },
      "error": { "color": "#DC3246" },
      "comment": { "color": "#6B6B6B", "italic": true },
      "comment_preproc": { "color": "#C69669" },
      "keyword": { "color": "#7AA2D6" },
      "keyword_reserved": { "color": "#7AA2D6" },
      "keyword_namespace": { "color": "#7AA2D6" },
      "keyword_type": { "color": "#8AB4C8" },
      "operator": { "color": "#C4C4C4" },
      "punctuation": { "color": "#A8A8A8" },
      "name": { "color": "#C4C4C4" },
      "name_builtin": { "color": "#E6C07B" },
      "name_tag": { "color": "#D77757" },
      "name_attribute": { "color": "#7AA2D6" },
      "name_class": { "color": "#E6C07B", "bold": true },
      "name_constant": { "color": "#E6C07B" },
      "name_decorator": { "color": "#C69669" },
      "name_function": { "color": "#69DB7C" },
      "literal": { "color": "#C69669" },
      "literal_number": { "color": "#C69669" },
      "literal_string": { "color": "#C69669" },
      "literal_string_escape": { "color": "#AFFFD7" },
      "generic_deleted": { "color": "#FFA8B4" },
      "generic_inserted": { "color": "#69DB7C" },
      "generic_emph": { "italic": true },
      "generic_strong": { "bold": true },
      "generic_subheading": { "color": "#787878" },
      "background": {}
    }
  },
  "table": {},
  "definition_list": {},
  "definition_term": {},
  "definition_description": { "block_prefix": "\n🠶 " }
}`)

var (
	mdRenderer *glamour.TermRenderer
	mdWidth    int
)

func renderMarkdown(src string, width int) string {
	if width < 20 {
		width = 80
	}
	if mdRenderer == nil || mdWidth != width {
		r, err := glamour.NewTermRenderer(
			glamour.WithStylesFromJSONBytes(warmStyle),
			glamour.WithWordWrap(width-2), // leave a small gutter
		)
		if err != nil {
			return src
		}
		mdRenderer, mdWidth = r, width
	}
	out, err := mdRenderer.Render(src)
	if err != nil {
		return src
	}
	// glamour pads with blank lines; trim so it sits flush in the transcript.
	return strings.Trim(out, "\n")
}
