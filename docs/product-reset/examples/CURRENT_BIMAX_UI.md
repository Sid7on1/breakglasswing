# Current Bimax UI audit

Local screenshot set:

- `site/public/media/ui-home.png`
- `site/public/media/ui-transcript.png`
- `site/public/media/ui-review.png`
- `site/public/media/ui-terminal.png`
- `site/public/media/ui-editor.png`
- `site/public/media/ui-diff.png`
- `site/public/media/ui-gallery.png`
- `site/public/media/ui-welcome.png`

## Keep

- restrained graphite palette and warm accent;
- readable transcript width and code blocks;
- persistent composer while a task runs;
- visible verification failure instead of a false success state;
- integrated file diff, terminal, branch and task history;
- resizable evidence area and standard Mac traffic-light placement.

## Recompose

- The left sidebar mixes project identity, creation, search, six implementation tools, sessions,
  support and settings. Make it projects/tasks only.
- The right side uses both a thin icon rail and a full panel. Replace both with one contextual
  evidence inspector.
- Model, autonomy, mode, token/context, graph, subagent and verification states all compete near the
  composer/footer. Keep the one control that changes the current task and move the rest to details.
- The home page repeats recent tasks already shown in the sidebar and leads with generic feature
  cards. Lead with the composer and two recent, outcome-based examples.
- A failed verification badge is far from the failing command evidence. Put the failure card in the
  task stream and open the relevant evidence tab.

## Missing for app-owned computer use

- exact target app/window identity;
- live observation age and source;
- foreground/background transition;
- action timeline with postconditions;
- Pause / Take Control / Resume;
- contextual permission/trust center;
- clear distinction between a safe retry, fallback, and a blocked action.

The frontend reset should first add this missing task evidence and simplify hierarchy. A new logo,
gradient, animation library, or SwiftUI rewrite would not address these gaps.

