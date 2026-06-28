# Bimax — Landing Site Design Brief (v2: "The Build")

**Goal:** an Awwwards-grade, motion-first landing page that *feels like the product* — a terminal
agent that turns a spoken idea into a real, running system. Inspired by **motionsites.ai**
(deep-black, high-contrast, every element animates, big italic-accent headlines, 3D showcases,
generous space, video previews on everything).

> The site is the demo. Scrolling it should feel like watching an idea become a system.

---

## 0. Creative concept — "The Build"

A single cinematic narrative, top to bottom:

> **idea → sketch → blueprint → build → a thing that runs.**

Every section advances that story. Motion is never decorative — it *constructs*. Wireframes
assemble into solids, code rains into files, a blueprint folds into a running app. The aesthetic:
**cinematic terminal** — deep space-black, liquid glass, one electric **emerald "build" accent**,
monospace truth + serif soul.

**Emotional target:** "this is the most powerful thing I could open in a terminal, and it's beautiful."

---

## 1. What we borrow from motionsites.ai

| Their move | Our version |
|---|---|
| Motion on *everything* (cards = looping video previews) | Every capability tile + domain tab carries a looping clip |
| Big headline, **italic accent words**, text-forward hero | Instrument Serif display with italic accents, minimal hero chrome |
| Deep black, high contrast, subtle electric tones | OLED black + emerald accent + cool indigo glow |
| 3D template showcases | A real R3F 3D centerpiece that reacts to scroll |
| Generous spacing, premium rhythm | 8pt system, big section padding, lots of air |
| Minimal text CTAs with `→` | `→` arrow CTAs, magnetic buttons |
| Infinite/lazy gallery, viewport-triggered playback | Scroll-reveals + hover-play, IntersectionObserver-gated video |

We go **further than them on narrative**: they're a gallery (flat grid); we're a story (pinned,
scroll-driven sequence).

---

## 2. Design system

**Color (OLED dark, single accent):**
- Background `#05070d` → `#0a0e1a` (sectional shifts), pure-black pockets `#000`
- Surfaces: liquid-glass over slate `#0f1626` / `#161f33`
- Accent (build/run): **emerald `#34d399`** (bright `#4ade80`, dim `#22c55e`)
- Secondary glow: indigo `#3b82f6` used *sparingly* in gradient meshes
- Text: `#f8fafc` primary, `rgba(255,255,255,.6)` body, `.4` muted

**Typography:**
- Display: **Instrument Serif**, italic, tight tracking (`-0.02em`), huge (clamp 3rem→7rem)
- UI/body: **Inter** (300–700)
- Code/terminal/labels: **JetBrains Mono** (kicker labels like `// the loop`, all stats, all code)

**Motion principles (the soul of this build):**
- **Smooth scroll** via Lenis (inertial, buttery) — this alone makes it feel premium
- **Scroll-pinned sequences** (GSAP ScrollTrigger or Framer `useScroll`) for the narrative sections
- **Text reveal**: headlines animate in word-by-word (blur+y+opacity), 30–50ms stagger
- **Hover-play**: video cards paused by default, play on hover/in-view; pause off-view (perf)
- **Magnetic buttons** + subtle cursor follower (accent dot)
- **Parallax** layers in hero + between sections; **counters** count up on reveal
- **Marquee** strips (tools, "built with") scrolling infinitely
- Easing: `[0.22, 1, 0.36, 1]` (expo-out) everywhere; durations 0.6–0.9s; respect `prefers-reduced-motion`

**Effects:** liquid-glass (already built), faint technical grid, radial accent glows, film grain
overlay (subtle), gradient mesh blobs behind sections.

---

## 3. Tech stack

- **Vite + React + TS + Tailwind** (current) + **Framer Motion**
- **@react-three/fiber + drei** — 3D centerpiece
- **Lenis** (`@studio-freight/lenis`) — smooth scroll
- **GSAP + ScrollTrigger** (optional, for the pinned "Loop" sequence) — or pure Framer `useScroll`
- Video: self-hosted, web-optimized (h264 + faststart, WebM/AV1 alt), poster frames, lazy + in-view play
- Perf: code-split three.js, `loading="lazy"`, reduced-motion fallbacks, ~`<150ms` interactions

---

## 4. Section-by-section spec

### S1 — Hero (full viewport, cinematic)
- **Background:** ambient loop video (`hero-ambient`, see assets) — abstract "intelligence forming
  structure" — at 8–12% opacity behind a radial scrim so text always wins. Faint grid on top.
- **3D centerpiece:** a wireframe form that **assembles into a glass solid** on load and slow-rotates;
  reacts to cursor (parallax) and to scroll (disassembles as you leave). Lives right-of-center.
- **Copy (verbatim):**
  - Eyebrow chip: `New ▸ Sketch Mode — design any system, level by level`
  - Headline: **"From a *sketch* to a *shipped* system."** (italic accents on *sketch*, *shipped*)
  - Sub: "Bimax is a terminal agent that doesn't just execute — it designs *with* you. Sketch an idea,
    decide it level by level, and watch it compile into real websites, agents, and trained models.
    Verified, end to end."
  - Primary CTA: `Start building →` · Secondary: `▶ Watch it build` (opens the centerpiece demo)
  - Install pill: `$ npm i -g bimax` (copy button)
- **Motion:** headline word-reveal; terminal types itself; 3D assembles; scroll cue pulses; parallax.
- **Assets:** `hero-ambient` (video), optional `hero-model` (GLB).

### S2 — Trust marquee
- Infinite-scrolling monospace strip: `Claude · MCP · Playwright · Weights & Biases · HuggingFace ·
  nanotron · Astro · Vercel ·` (loop). Two rows, opposite directions, slow. Fades at edges.
- **Assets:** none (type only) — or tiny mono logos if you want them.

### S3 — "See it build" centerpiece (the WOW)
- A large, framed **demo video** (`demo-build`, ~25–40s) in a glass browser/terminal chrome, centered,
  with an accent glow bloom behind it. Plays on scroll-in. This is the one hero asset that sells it:
  a stylized run of Bimax taking a one-line idea → blueprint → built site/model → "✓ verified".
- Header above: `// watch` → **"One line in. *A system out.*"**
- **Motion:** the frame scales/unblurs in; a scrubber/progress accent line; optional captions that
  fade in sync ("sketching…", "blueprint saved", "building…", "verified ✓").
- **Assets:** `demo-build` (video, the centerpiece).

### S4 — The Loop (pinned scroll sequence)
- **Sketch → Blueprint → Build → Verify.** A **pinned** section: as you scroll, the stage advances
  1→4; the left side holds a big step number + serif title + line of copy, the right side **crossfades
  a short looping clip per stage** (`loop-sketch`, `loop-blueprint`, `loop-build`, `loop-verify`).
  A progress rail on the left fills emerald as you pass each stage.
- Header: `// the loop` → **"One loop for *everything* you build."**
- Copy per stage (verbatim):
  - **Sketch** — "Talk it through. Bimax interviews you, searches the live web, and shapes the idea — no blank page."
  - **Blueprint** — "Every decision, level by level. Pick options, mix them, import from the web — saved as a Blueprint."
  - **Build** — "Compile the Blueprint into real artifacts — a site, a wired agent, or a training config + trainer."
  - **Verify** — "Prove it works — a screenshot loop for sites, live metrics for models, a smoke run for agents."
- **Assets:** 4 short loop clips (`loop-sketch/blueprint/build/verify`).

### S5 — Capabilities (motion bento)
- Bento grid, **each tile a hover-play looping micro-clip** behind glass (motionsites-style), with
  title + one line. Sizes vary (hero tile = Sketch Mode).
- Header: `// capabilities` → **"Not a chatbot. *A build system.*"**
- Tiles: Sketch Mode · Beast Pipeline · Blueprint Builders · MCP Self-Service · Live Monitoring · Graph Memory.
- **Assets:** 6 micro-loop clips (`cap-sketch`, `cap-beast`, `cap-blueprint`, `cap-mcp`, `cap-monitor`, `cap-graph`) — OR animated CSS/canvas if we want zero new video (fallback).

### S6 — Domains (tabbed showcase, video per tab)
- Tabs **Websites / Agents / LLMs** (spring pill). Each tab: left = tagline + 3 bullets + terminal;
  right = a **cinematic preview** (`domain-websites/agents/llms` — video or hi-res image) of that
  domain being built. Crossfade on tab change.
- Header: `// three domains` → **"One engine. *Whatever you're building.*"**
- **Assets:** 3 domain previews (video preferred, image acceptable).

### S7 — Proof
- Stat grid with **count-up** animation: `604` tests · `3` domains · `14` LLM levels · `100%` open.
- Then the trust marquee echo / partner row.
- **Assets:** none.

### S8 — CTA closer (cinematic)
- Full-bleed: a calmer ambient loop (`cta-ambient`, can reuse `hero-ambient` tinted) + big glow.
- **"Sketch it. *Ship it.*"** + install pill + `Star on GitHub →`.
- **Assets:** reuse `hero-ambient` (optional dedicated `cta-ambient`).

### S9 — Footer
- Logo, nav, GitHub/Docs/links, `© 2026`, "built with Bimax" easter egg. Type only.

---

## 5. 🎬 ASSET MANIFEST — what to get me

> Format rules for all video: **MP4 (H.264) + a WebM/AV1 alt**, 1080p (hero/demo can be 1440p),
> **no audio**, seamless **loop** (except `demo-build`), 24–30fps. I'll compress + make poster frames.
> Higgsfield models: **Seedance 2.0** for video, **GPT Image 2 / Nano Banana Pro** for stills.
> All prompts below are written to paste straight into Higgsfield (or Sora/Runway/Kling).

### A. Hero ambient — `hero-ambient.mp4` ★ priority
- **Use:** S1 + S8 background. **Spec:** 1920×1080 (or 2560×1440), 8–12s seamless loop, no audio.
- **Prompt:** *"Abstract dark cinematic background, deep space-black, slow-drifting volumetric
  particles and fine wireframe lines gradually assembling into faint geometric structures, subtle
  emerald-green energy filaments, soft indigo haze, premium tech aesthetic, very dark and low-key so
  white text reads on top, slow graceful motion, seamless loop, no text, no logos."*

### B. "See it build" demo — `demo-build.mp4` ★★ the centerpiece
- **Use:** S3. **Spec:** 1920×1080 or 1440p, **~25–40s**, no loop needed (poster on a frame), no audio.
- **Content:** a stylized, cinematic "screen story": a single typed idea → a blueprint of glowing
  option-nodes assembling → files/code materializing → a finished site + a rising loss curve → a big
  `✓ verified`. Terminal + liquid-glass UI aesthetic, emerald accents, dark.
- **Prompt:** *"Cinematic UI motion sequence on a pure-black background: a glowing terminal types a
  single line of code, then an elegant node-graph of options assembles and connects with emerald light,
  then sleek glass file cards and code fly into place, then a polished dark website and a rising green
  metrics chart appear, ending on a large glowing emerald checkmark. Liquid-glass panels, fine grids,
  premium futuristic motion design, smooth easing, dark and high-contrast, no readable real text."*
- *(Alt: I can build this section as a real animated React sequence with NO video if you prefer —
  cheaper, fully on-brand, and editable. Tell me which.)*

### C. The Loop — 4 clips · `loop-sketch / loop-blueprint / loop-build / loop-verify`
- **Use:** S4. **Spec each:** 1280×960 (4:3-ish) or 1080×1080, 5–8s seamless loop, no audio.
- **Prompts:**
  - `loop-sketch`: *"Dark cinematic loop: a glowing conversation/soundwave morphing into a hand-drawn
    wireframe sketch, emerald ink lines, particles, premium, seamless loop, no text."*
  - `loop-blueprint`: *"Dark cinematic loop: a technical blueprint of connected option-nodes lighting
    up and snapping together into a tree, emerald glow on slate, schematic, seamless loop, no text."*
  - `loop-build`: *"Dark cinematic loop: streams of code and glass file cards flying in and stacking
    into a structure, compiling energy, emerald accents, seamless loop, no readable text."*
  - `loop-verify`: *"Dark cinematic loop: a screenshot frame and a rising green metrics/loss curve with
    a pulsing checkmark, verification aesthetic, emerald on black, seamless loop, no text."*

### D. Capabilities — 6 micro-loops · `cap-sketch / cap-beast / cap-blueprint / cap-mcp / cap-monitor / cap-graph`
- **Use:** S5 tile backgrounds. **Spec each:** 800×600, 4–6s seamless loop, dark, *subtle* (sits under
  text). **Optional** — I can do these as canvas/CSS animations for free if you'd rather not generate 6.
- **Prompts (keep them abstract + dark):**
  - `cap-sketch`: pencil/ink wireframe lines drawing themselves, emerald.
  - `cap-beast`: many small agent-dots swarming, healing, converging — particle swarm, emerald.
  - `cap-blueprint`: layered schematic sheets stacking, blue-print grid.
  - `cap-mcp`: a hub with plugs/connectors snapping in (tools connecting), nodes + links.
  - `cap-monitor`: live line charts ticking, gentle waveform, emerald on black.
  - `cap-graph`: a 3D node-graph slowly rotating, glowing edges.

### E. Domains — 3 previews · `domain-websites / domain-agents / domain-llms`
- **Use:** S6 tab panels. **Spec each:** 1280×800, 6–10s loop **or** a crisp 1600×1000 still.
- **Prompts:**
  - `domain-websites`: *"A beautiful dark premium website materializing/scrolling on a floating glass
    browser frame, cinematic, emerald accents, no readable text."*
  - `domain-agents`: *"A glowing agent/robot node orchestrating connected tools and tasks on a dark
    schematic, autonomous workflow, emerald, no text."*
  - `domain-llms`: *"A neural network / transformer architecture forming, GPU-cluster glow, a rising
    training loss curve, dark cinematic, emerald + indigo, no text."*

### F. Stills / brand
- `og-image.png` — 1200×630 social card (dark, headline + b mark + emerald). *(I can generate this in
  HTML→screenshot for free, or you generate it.)*
- `favicon` — the `b` mark, emerald on black (I'll make this in code).
- Optional `grain.png` — subtle film-grain tile (I'll generate procedurally, no need).

### Priority order (if budget-limited)
1. **`hero-ambient`** (sets the whole tone) →
2. **`demo-build`** centerpiece (or let me build it in code) →
3. **3× domain previews** →
4. **4× loop clips** →
5. **6× capability micro-loops** (or I do these free in canvas).

**Minimum to look incredible:** just **#1 + #2**. Everything else I can fake convincingly in
code/canvas and you swap real clips in later (same filenames, drop-in).

---

## 6. Build sequence

1. **Foundation:** add Lenis smooth scroll, GSAP/ScrollTrigger (or Framer scroll), magnetic-button +
   cursor + word-reveal + counter + marquee + hover-video primitives, film-grain + mesh-glow layers.
2. **Hero** with the assembling 3D + ambient video + typed terminal.
3. **Loop** pinned sequence (works with placeholders, swap clips in).
4. **Capabilities** motion bento + **Domains** tabbed video panels.
5. **Demo centerpiece** (video frame or coded sequence) + Proof counters + CTA + footer.
6. Asset pass: drop in real videos, compress, posters, AV1/WebM, lazy + in-view play.
7. Polish: reduced-motion, mobile, perf (code-split three), headless-Chrome verify each section.

---

## 7. Guardrails (so "crazy" still ships)
- Every animation respects `prefers-reduced-motion` (videos → posters, big motion → fades).
- Videos: in-view play only, paused off-screen, posters always; total hero+demo < ~6MB after compress.
- Text contrast ≥ 4.5:1 over all video (scrims mandatory). 44px tap targets. Keyboard nav + focus rings.
- Code-split three.js; lazy-load below-fold video; target Lighthouse perf ≥ 85 on desktop.

---

*Decision needed from you: (1) generate `demo-build` as video, or let me code it? (2) capability tiles —
6 real clips or free canvas? (3) confirm the emerald accent (vs. a different signature color).
Then: send assets as they're ready (drop into `site/public/media/<name>.mp4`), and I build — the shell
works with placeholders so nothing blocks.*
