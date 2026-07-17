# The BiMax Design Language — Graphite & Ember

This document describes the design system **as implemented** in `tui/styles.go`,
`app/src/renderer/src/styles.css`, and the copy conventions across the engine.
It is a contract, not a mood board: if a change violates a rule here, the change
is wrong or this document must be amended in the same commit.

BiMax's identity: **a quiet instrument that is visibly alive.** Warm graphite
neutrals carry all chrome; a single ember accent marks what is live or focused;
colour is otherwise reserved strictly for state. The product speaks briefly when
things are routine and precisely when evidence matters.

---

## 1. Principles

1. **Foreground only.** BiMax paints text; the ground is the user's own
   terminal. No full-background repaints, no wall-to-wall fills.
2. **One accent.** Ember (`#D78562`) means *live / focused / active* — the
   user's own words, the running spinner, the selected row, the active tab.
   Nothing decorative may use it.
3. **Colour is state.** Green = succeeded, red = failed, amber = caution,
   blue = information. A colour never appears for variety.
4. **Hierarchy through ink, not boxes.** Four text tones (primary → secondary →
   tertiary → decorative) do the layout work. Borders are hairline, dim, and
   rounded — they group, they do not decorate.
5. **The best status message is none.** Confirmations are short footer
   one-liners that self-clear (~10 s). Only turn-relevant content enters the
   transcript.
6. **Degrade gracefully.** Truecolor hex degrades automatically (lipgloss) for
   256/16-colour terminals; layout must survive 60-column SSH sessions; every
   animation respects `--no-anim` / `BIMAX_REDUCED_MOTION=1`.

## 2. Colour tokens (single source of truth: `tui/styles.go`)

| Token | Hex | Meaning |
|---|---|---|
| `colAccent` (Ember) | `#D78562` | live, focused, active, "yours" |
| `colShimmer` | `#E59A77` | animated live shimmer only |
| `colText` | `#F1EFE9` | primary ink |
| `colInactive` | `#B0ADA5` | secondary text, summaries |
| `colSubtle` | `#77746E` | tertiary — gutters, hints |
| `colDim` | `#383734` | decorative only (hairlines, empty meter track) — **never text** |
| `colOK` | `#82AD89` | success, additions, tool completion |
| `colErr` | `#DF766F` | failure, deletions |
| `colWarn` | `#D4A35F` | caution, degraded, needs attention |
| `colInfo` | `#78A9D4` | neutral information, links, hunks |
| `colInk` | `#1A1A1A` | dark text ON a coloured block (chips, search hit) |

Rules:
- No raw hex outside the token block (the chroma syntax theme in `markdown.go`
  is a separate, deliberate exception; gradient math in `views.go`/`welcome.go`
  decomposes these same tokens and says so inline).
- `colDim` fails WCAG on purpose and is therefore banned for text.
- Mode chips are the one place a solid colour block is allowed (dark ink on
  colour), because the active mode must be unmissable.

## 3. Symbols

| Symbol | Use |
|---|---|
| `⏺` | a tool call (green done · amber running · red failed) |
| `⎿` | the tool's one-line result, indented under its call |
| `●` | "current" marker in pickers |
| `◉` | slot rows in the model hub |
| `⌕` `✎` `⊘` `↩` | browse · custom entry · none/off · inherit |
| `⌂` | workspace / repo chip |
| `🤖` | live sub-agent |
| `🧠` | mind layer chip |
| braille spinner | the only spinner; ember-tinted; frozen under reduced motion |

No decorative ASCII, no box-drawing walls, no emoji outside this table.

## 4. Layout & density

- **Transcript is immutable scrollback.** Live state pins to the bottom region
  (task panel, sub-agent panel, token meter, footer) — never injected inline.
- **Footer is one line**: mode chip · model pointer · routing chip (`· work` /
  `· quick`) · workspace chip · hints. Ephemeral confirmations ride here and
  self-clear; they do not enter the transcript.
- **Panels** (todos, sub-agents, map, logs) are rounded hairline boxes,
  `Padding(0,1)`, pinned above the prompt.
- **Narrow terminals**: chips collapse to counts (`⌂ 4 repos`), panels clip
  before the transcript does, nothing wraps into corruption.
- Diffs: whole-line tinted backgrounds (deep green/red, not neon) with a bold
  bright line-number gutter; word-level tints inside edit previews.

## 5. Vocabulary

**One vocabulary everywhere: Work · Quick · Vision.**

- *Work* — the model that does the real coding/agentic work.
- *Quick* — the plain, non-reasoning model for instant small replies.
- *Vision* — where screenshots/images go; never displaces Work.

`coding` / `lite` / `heavy` are wire keys and accepted command aliases only —
they must never appear in rendered UI text. The live routing chip says
`· work` / `· quick`. New surfaces must reuse these three words or none.

## 6. Voice

BiMax is direct without being robotic, confident without pretending certainty,
calm during failures, brief during routine.

**Rules:**
1. Lead with what happened, then what happens next. Never blame without
   evidence — latency attribution comes from measurement (`/perf`), and a stall
   is "no response within Ns", not "provider is slow".
2. Failures state the reset honestly and hand the user (or the model) the next
   move: *"Browser disconnected mid-action. The runtime was reset — your next
   action relaunches with the same profile."*
3. Unconfigured ≠ default: *"model not chosen yet — run /setup"* — never
   pretend a choice was made.
4. Repetition gets called out: *"This exact action has now failed 3 times in a
   row — take a fresh snapshot and try a different route."*
5. Waiting is a single neutral gerund on the shimmer line ("Thinking",
   "Connecting", "Measuring" — see `tui/model.go`) plus elapsed time — never
   a claim about *why* it is slow. Attribution lives in `/perf`, backed by
   the DNS→TCP→TLS probe evidence, and nowhere else.
6. No exclamation marks in status copy. No apologies. No "please wait".
7. Permission prompts state the action, the blast radius, and the escape:
   what runs, what it touches, how to decline.

## 7. Motion

- One braille spinner, ember-tinted, for "working"; a shimmer phrase for
  "thinking". Nothing else animates.
- `--no-anim` / `BIMAX_REDUCED_MOTION=1` freezes both; state is still legible
  because colour and text carry the meaning, not the motion.

## 8. Anti-patterns (rejected deliberately)

Gradients beyond the wordmark · neon/cyberpunk hues · glowing borders ·
badge/pill proliferation · decorative separators · spinners for instant
operations · loud success banners · provider jargon in primary surfaces ·
copying Claude Code / Codex / Gemini CLI surface language.
