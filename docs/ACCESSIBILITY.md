# Accessibility

BiMax's TUI is designed to stay usable without color, without motion, and with a screen reader.

## Color — `NO_COLOR`

Set `NO_COLOR` to any non-empty value ([no-color.org](https://no-color.org)) and the TUI renders
as plain text — every style degrades to no SGR at all. Verified by `TestNoColorStripsSGR`.

Meaning is never carried by color alone: tool state also has a glyph (`●` ok / running / error),
diff lines carry `+`/`-` signs, and the active mode is named in the footer, not just tinted.

## Motion — reduced motion

Set `BIMAX_REDUCED_MOTION=1` or launch `bimax --no-anim` and all animated chrome freezes: no
braille spinner, no per-frame shimmer sweep, no cycling verbs, no dot rotation. The working line
becomes a single static row whose only change is the whole-second elapsed clock — information,
not decoration. The animation tick also drops from 50 ms to 500 ms so the process stays quiet.
Verified by `TestReducedMotionFlagAndEnv`.

## Contrast (WCAG)

BiMax paints foreground only; the ground is your terminal's background. Measured against the
design's dark ground (`#0B0C0E`):

| Token | Ratio | Level |
|---|---|---|
| Primary text (Mist `#EDEFF2`) | 17.0:1 | AA (normal text) |
| Secondary (`#9AA1AC`) | 7.5:1 | AA |
| Phosphor accent (`#7EE7C4`) | 13.2:1 | AA |
| OK / Warn / Error / Info | 5.3–10.1:1 | AA |
| Tertiary hint (`#626974`) | 3.5:1 | AA (UI / large text) |
| Faint (`#444A54`) | 2.2:1 | decorative only — panel hairlines & empty meter track; never text |

All body text and state colors meet the 4.5:1 normal-text bar; de-emphasized chrome meets the
3:1 UI bar. The single sub-3:1 token is used only for decorative borders and the unfilled meter
track, never for text.

## Screen readers

The TUI runs in **inline mode**: committed output is written to the terminal's native scrollback
via `tea.Println` (not an alternate screen or a managed viewport). That means the transcript is
ordinary terminal text a screen reader reads linearly, and it stays in scrollback after the
session. Only the small live region (streaming answer, running tool cards, prompt, footer)
redraws in place. For the most screen-reader-friendly experience, combine `NO_COLOR=1` with
`--no-anim` so the live region is static plain text.

Known limitation: the live region redraws in place, so a screen reader may re-announce it while a
turn streams. Committed transcript lines are announced once and are stable.
