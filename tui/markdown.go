package main

import (
	"strings"

	"github.com/charmbracelet/glamour"
)

// Markdown rendering for assistant output (bold, lists, and syntax-highlighted code blocks),
// in the low-chrome Graphite & Phosphor look. glamour's built-in "dark" style is loud — a
// yellow-on-purple H1 bar, neon-pink inline code, and rainbow syntax over a solid grey block
// (the "static" look). We swap it for the BiMax palette: phosphor headings, muted code,
// and NO code-block background fill. The renderer is width-dependent, so we cache it and rebuild
// only when the viewport width changes. Falls back to raw text if glamour ever errors.

// mdStyle is a glamour StyleConfig JSON tuned to the "Graphite & Phosphor" system: phosphor accent
// on top-level headings, Mist body text, flush-left margins, and a graphite-ground code block with
// readable syntax colors so output reads as content, not chrome.
//
// WS3-B note — two palettes live here on purpose:
//   1. CHROME colours (document/heading/quote/hr/link) mirror the styles.go tokens — keep them in
//      sync: #EDEFF2=colText, #9AA1AC=colInactive, #7EE7C4=colAccent, #444A54=colDim, #57C7C7=colHunk.
//   2. The code-block SYNTAX colours (one-dark family: #C678DD, #E06C75, #98C379, …) are a distinct
//      chroma theme for highlighting, intentionally NOT part of the chrome token set.
// glamour requires literal hex inside this JSON blob (no Go-value interpolation), so these can't
// reference the tokens directly; the mapping above is the contract.
var warmStyle = []byte(`{
  "document": { "block_prefix": "", "block_suffix": "", "color": "#EDEFF2", "margin": 0 },
  "block_quote": { "color": "#9AA1AC", "indent": 1, "indent_token": "│ " },
  "paragraph": {},
  "list": { "level_indent": 2 },
  "heading": { "block_suffix": "\n", "color": "#7EE7C4", "bold": true },
  "h1": { "prefix": "", "suffix": "", "color": "#7EE7C4", "bold": true },
  "h2": { "prefix": "## ", "color": "#7EE7C4", "bold": true },
  "h3": { "prefix": "### ", "color": "#9AA1AC", "bold": true },
  "h4": { "prefix": "#### ", "color": "#9AA1AC", "bold": true },
  "h5": { "prefix": "##### ", "color": "#9AA1AC", "bold": true },
  "h6": { "prefix": "###### ", "color": "#9AA1AC", "bold": true },
  "text": {},
  "strong": { "color": "#EDEFF2", "bold": true },
  "emph": { "italic": true },
  "hr": { "color": "#444A54", "format": "\n────────\n" },
  "item": { "block_prefix": "• " },
  "enumeration": { "block_prefix": ". " },
  "task": { "ticked": "[✓] ", "unticked": "[ ] " },
  "link": { "color": "#57C7C7", "underline": true },
  "link_text": { "color": "#57C7C7", "bold": true },
  "image": { "color": "#57C7C7", "underline": true },
  "image_text": { "color": "#787878", "format": "Image: {{.text}}" },
  "code": { "prefix": " ", "suffix": " ", "color": "#EDEFF2", "background_color": "#23272E" },
  "code_block": {
    "color": "#ABB2BF",
    "background_color": "#16181C",
    "margin": 2,
    "chroma": {
      "text": { "color": "#ABB2BF", "background_color": "#16181C" },
      "error": { "color": "#E06C75" },
      "comment": { "color": "#7F848E", "italic": true },
      "comment_preproc": { "color": "#C678DD" },
      "keyword": { "color": "#C678DD" },
      "keyword_reserved": { "color": "#C678DD" },
      "keyword_namespace": { "color": "#C678DD" },
      "keyword_type": { "color": "#E5C07B" },
      "operator": { "color": "#56B6C2" },
      "punctuation": { "color": "#ABB2BF" },
      "name": { "color": "#ABB2BF" },
      "name_variable": { "color": "#E06C75" },
      "name_builtin": { "color": "#E5C07B" },
      "name_tag": { "color": "#E06C75" },
      "name_attribute": { "color": "#D19A66" },
      "name_class": { "color": "#E5C07B", "bold": true },
      "name_constant": { "color": "#D19A66" },
      "name_decorator": { "color": "#61AFEF" },
      "name_function": { "color": "#61AFEF" },
      "literal": { "color": "#D19A66" },
      "literal_number": { "color": "#D19A66" },
      "literal_string": { "color": "#98C379" },
      "literal_string_escape": { "color": "#56B6C2" },
      "generic_deleted": { "color": "#E06C75" },
      "generic_inserted": { "color": "#98C379" },
      "generic_emph": { "italic": true },
      "generic_strong": { "bold": true },
      "generic_subheading": { "color": "#7F848E" },
      "background": { "background_color": "#16181C" }
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
			glamour.WithStylesFromJSONBytes(warmStyle),
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
