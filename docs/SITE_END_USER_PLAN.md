# Bimax — End-User Site Plan

*Phase 1 deliverable. Written before any UI code. This is the contract the homepage is built against:
what a real person sees, in what order, in plain language — no engine/protocol/MCP/architecture talk.*

---

## 1. Who it's for

**Vibe coders.** People who can *describe* what they want and *read* whether the result is right, but
don't want to hand-wrestle the mechanics. Concretely:

- Indie makers and founders shipping their own product.
- Designers and PMs who can code a little and want to code a lot more.
- Working developers who'd rather say the change than type all of it, and who care about reviewing
  what an agent did before it lands.

They are comfortable in an app window, not a config file. They judge a tool by *what they can make with
it* and *how in-control they feel*, not by its internals.

### Their top jobs-to-be-done
1. **Say what I want in plain words and get real, working code** — not a chat transcript, actual edits.
2. **Trust that it understands my actual project** before it touches anything.
3. **See exactly what changed** so I can accept or reject with confidence.
4. **Stay in control** — approve, pause, or redo; nothing irreversible happens behind my back.
5. **Ship without fear** — checks run, and I can commit when it's green.
6. **Pick up where I left off** — my tasks and history are still here tomorrow.

---

## 2. Positioning — one sentence

> **Bimax is the desktop coding partner that turns what you say into working software — and shows you
> exactly what it changed before anything ships.**

Supporting line (the "two minds" idea, kept human): *You bring the intent. Bimax does the work — out
loud, in your project, where you can see and approve every step.*

---

## 3. Information architecture (page order)

Single-page, top-to-bottom guided story. Each section advances **idea → understanding → change →
control → ship.**

| # | Section | Job it does |
|---|---------|-------------|
| 0 | **Nav** (minimal) | Get out of the way; one primary CTA (*Download for Mac*). |
| 1 | **Hero** | In one screen: what Bimax is *for you*, the signature two-minds moment, one CTA. |
| 2 | **The turn** (idea → result) | The core promise, shown: your sentence on the left, what Bimax did + *what changed* on the right. |
| 3 | **Product theater** | The real app, in a floating window, lit like a product shot. Proof it's real and beautiful. |
| 4 | **Three beats** | *Open it → Say it → Ship it.* The whole loop in plain language. |
| 5 | **What you can make** | 3–4 outcome-led cards (build a feature, understand a codebase, fix what's broken, keep projects moving). |
| 6 | **You're in control** | Safety/review in human words: approvals, see every change, verify before ship, stays in your folder, runs on your machine. |
| 7 | **Honest proof** | Only verifiable facts: cross-platform desktop app, works on your existing project, your code stays on your machine. No invented metrics. |
| 8 | **Download / get it** | Real targets only: macOS (Apple Silicon) now; Windows & Linux noted honestly; terminal one-liner for the CLI crowd. |
| 9 | **FAQ** | Kills the real objections: do I need to know how to code, where does my code go, which AI, what's it cost, which platforms. |
| 10 | **Final CTA + wordmark footer** | One last invitation; oversized Bimax wordmark; quiet links. |

---

## 4. What the user sees in every section (final copy + media intent)

Copy below is the **shipping copy** unless a better line emerges in build. Kickers are the small
mono labels. Media intent notes what image/3D sits with it.

### 1 — Hero
- **Kicker:** `A desktop coding partner`
- **Headline:** *Say it.* **Watch it build.** *(italic accent on "Say it.")*
- **Sub:** "Bimax is a desktop app for people who'd rather describe what they want than wire it up by
  hand. Tell it the outcome — it explores your project, makes the change, runs the checks, and shows
  you exactly what it did."
- **Primary CTA:** `Download for Mac →` · **Secondary:** `See how it works` (scrolls to §2).
- **Under-CTA microcopy:** "Free while in preview · Apple Silicon"
- **Media:** the signature **two-minds 3D moment** (intent form + build form resolving into one),
  right/behind the headline. Static gradient fallback under reduced-motion / no-WebGL.

### 2 — The turn (idea → result)
- **Kicker:** `// the turn`
- **Headline:** One sentence in. *A working change out.*
- **Left (you):** a real prompt — "Add retry with backoff to the fetch client."
- **Right (Bimax):** a compact, real recreation of the app's answer — *found the call sites*, *edited
  3 files*, and a **What changed** list (`api/retry.ts — new helper`, `api/client.ts — wraps fetch`,
  …). Pulled straight from the real product so nothing is invented.
- **Line under it:** "You never wonder what it touched. Every run ends with a plain list of what
  changed — and the diff is one click away."
- **Media:** real screenshot `ui-composer` / `ui-diff` framed in a glass window; the diptych animates
  left→right on scroll.

### 3 — Product theater
- **Kicker:** `// the app`
- **Headline:** This is the whole thing. *No terminal required.*
- **Body:** "A calm, native window. Your threads on the left, the work in the middle, and a review
  panel that always answers one question: *is this safe to keep?*"
- **Media:** hero screenshot `ui-review` (or `ui-home`) in a large floating browser/app chrome with a
  soft glow, slight parallax/tilt on scroll. Dark "theater" band so the real UI glows.

### 4 — Three beats (the loop)
- **Kicker:** `// how it goes`
- **Headline:** Open it. Say it. *Ship it.*
- **01 Open it** — "Point Bimax at a project folder. It reads the code, remembers your tasks, and keeps
  every change inside that folder." *(from real 'Where are we working?' screen)*
- **02 Say it** — "Describe the outcome in plain words. Bimax explores, makes the change, and runs the
  checks — narrating as it goes so you're never guessing."
- **03 Ship it** — "Review what changed, approve it, and commit when it's green. Come back tomorrow and
  your threads are right where you left them."
- **Media:** `ui-welcome`, `ui-composer`, `ui-review` — one per beat, cross-faded.

### 5 — What you can make (outcomes)
- **Kicker:** `// what you can make`
- **Headline:** Not a chatbot. *Something that actually does the work.*
- **Cards (outcome-led, no jargon):**
  1. **Build a feature** — "Describe it once. Bimax finds where it goes, writes it, and wires it in."
  2. **Understand any codebase** — "Drop into a repo you've never seen and ask how it works. Get real
     answers with the files to back them up."
  3. **Fix what's broken** — "Paste the error or point at the failing test. Bimax traces it, fixes it,
     and proves the fix with a passing run."
  4. **Keep every project moving** — "Threads, tasks, and history per project — so you can juggle a few
     things and never lose the thread."
- **Media:** each card carries a real screen crop (`ui-home`, `ui-gallery`, `ui-diff`, `ui-transcript`).

### 6 — You're in control
- **Kicker:** `// you're in control`
- **Headline:** It works out loud. *You have the last word.*
- **Four plain points (from the real Review panel):**
  - **Approve before it acts** — "Big moves ask first: *Apply these changes? Allow edits here?* You say
    yes or no."
  - **See every change** — "A running list of what changed, with the exact diff a click away. Nothing
    is hidden."
  - **It checks its own work** — "Bimax runs your tests and tells you plainly when something didn't
    pass — before you keep it."
  - **Your code, your machine** — "Everything happens in the folder you opened, on your computer. Undo
    points are made as it goes."
- **Media:** `ui-review` panel crops (approvals / verification / history).

### 7 — Honest proof
- **Kicker:** `// the honest part`
- **Headline:** Real app. Real project. *Your machine.*
- **Three honest stat-ish cards (all locally verifiable):**
  - **Native desktop app** — "A real macOS app you install, not a browser tab."
  - **Works on your project** — "Open your existing repo; changes stay inside that folder."
  - **Runs on your computer** — "Your code stays on your machine; you bring your own model key."
- *No customer counts, testimonials, benchmarks, or logos we can't stand behind.*

### 8 — Download
- **Kicker:** `// get bimax`
- **Headline:** Start with a sentence.
- **Primary:** `Download for macOS` (Apple Silicon `.dmg`). Sub: "Apple Silicon · ~140 MB · free
  preview."
- **Secondary, honest:** "Windows & Linux are in the works." + for the terminal crowd: a copyable
  one-line install for the CLI (`curl … | bash`).
- **Media:** none / the app icon.

### 9 — FAQ
- **Do I need to know how to code?** "Helps, isn't required. If you can describe what you want and read
  whether it looks right, you can drive Bimax. It shows its work so you learn as you go."
- **Where does my code go?** "Nowhere you didn't send it. Bimax works in the folder you open, on your
  machine. It talks to an AI model using a key you provide — that's the only thing that leaves."
- **Which AI does it use?** "Your choice. Bimax works with the major models; you bring a key and pick
  one in the app."
- **What does it cost?** "The app is free while it's in preview. You pay your model provider for what
  you use, at their rates."
- **Which platforms?** "macOS (Apple Silicon) today. Windows and Linux are on the way. There's also a
  terminal version if you live in the command line."
- **What if it does something I don't want?** "It asks before big moves, keeps a running list of every
  change, and makes undo points as it works. You can stop it at any time."

### 10 — Final CTA + footer
- **Headline:** Your next idea is one sentence away.
- **CTA:** `Download for Mac →`
- **Footer:** oversized `Bimax` wordmark; quiet links (How it works · What you can make · Download);
  `© 2026 Bimax`; a small "built with Bimax" note.

---

## 5. What we deliberately hide

Never surfaced to end users (present in the real product, but not marketing copy):

- engine, supervisor, protocol, runtime, MCP, sub-agents, orchestration
- "epistemic ledger", confidence margins, self-model, drives, Mind HUD, dream/self-play
- seatbelt/sandbox internals, AST SymbolEdit, graph store, headroom/compression, provider-agnostic
  OpenAI-compatible wording, Go/Bubble Tea single-binary talk, two-tier cognitive routing

These become plain outcomes instead: *it checks its work*, *you approve changes*, *it understands your
project*, *it runs on your machine*. Real UI screenshots may still contain product labels (e.g. a model
name, a "GraphQuery" chip) — that's authentic and fine; the **copy layer** stays plain.

---

## 6. Inspiration vs. originality

**Studied:**
- **Monolog** — bymonolog.com. Principles borrowed (not pixels): editorial pacing with generous
  negative space; big statement lines as dividers; a numbered, sequential story; one bold metric per
  case; plainspoken FAQ that answers objections; a 3-step process; minimal nav + a single CTA; an
  oversized wordmark close; film-grain texture. *We diverge:* Monolog is a monochrome studio portfolio;
  Bimax is a product. We keep the pacing and rhythm but invert the palette (warm light editorial canvas
  with dark product "theater" bands) and make the media the *product itself*, not mood imagery.
- **Hermes Agent** — hermes-agent.nousresearch.com. Note its weakness: static screenshots, no motion,
  no demo, no emotional or outcome copy, cold. *We beat it* with real motion, a live idea→result
  moment, real product theater, and outcome-led human copy.
- **Reference product pages** — Claude Code, Cursor, Lovable/Bolt/Replit, Zed. Shared best practice we
  adopt: outcome-led hero, "describe → build → ship", a real product demo, plainspoken control/safety
  language, honest platform CTAs.

**Original to Bimax:** the **two-minds duality made structural** — light (your idea) vs. dark (the
build); left (you) vs. right (Bimax); a signature 3D moment where an *intent* form and a *build* form
resolve into a single object that echoes the Bimax mark. This is the memorable risk, and it's tied to
the product, not decoration.

**Sources:**
- https://bymonolog.com
- https://hermes-agent.nousresearch.com/ · https://github.com/NousResearch/hermes-agent
- Real product: this repo's `README.md`, `docs/FEATURES.md`, and desktop screenshots in
  `app/release/ui-*.png`.

---

## 7. Mobile narrative & accessibility

**Mobile (360–430px):** the same story, stacked. Hero headline scales down but stays two lines; the
two-minds 3D becomes a lighter static/low-motion version (or gradient fallback). The idea→result
diptych stacks vertically (you → result). Product theater screenshots scroll horizontally inside their
own container (never the page). Three beats stack. Outcome cards become a single column. FAQ is a plain
accordion. One sticky-ish primary CTA reachable without hunting. No horizontal page scroll at any width.

**Accessibility (hard requirements):**
- `prefers-reduced-motion`: no smooth-scroll hijack, no autoplay, big motion → simple fades, 3D →
  static poster/gradient.
- WebGL failure → the guarded canvas renders nothing and a CSS gradient stands in; copy never blanks.
- Text contrast ≥ 4.5:1 everywhere, including over imagery (scrims mandatory on any text-over-media).
- Semantic HTML, correct heading order (one `h1`), visible focus rings, keyboard-operable nav/FAQ/CTAs,
  44px min tap targets, real `alt` text on every product image.
- Offscreen animation paused; nothing runs an unbounded loop when not visible.

---

*Next: creative direction (Phase 2) is captured inline in the design-system commit; media handling in
`docs/SITE_MEDIA_RUNBOOK.md`; final verification in `docs/SITE_BUILD_REPORT.md`.*
