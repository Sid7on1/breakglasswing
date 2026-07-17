# Bimax Site — Build Report

**Outcome:** the Bimax website is rebuilt as a cinematic, vibe-coder-first product story and is
**Vercel-ready**. The build is green, there are no console errors or failed requests, the layout holds
from 390px mobile through 1440px desktop with no horizontal overflow, and accessibility basics pass.
**Deployment was not performed** — the final deploy is left to you (see §7).

---

## 1. What the final experience is

A single-page, top-to-bottom guided story that shows what a person can *make* with Bimax and how it
*feels* — never engine/protocol/MCP/architecture language. The signature idea is the **two minds made
structural**: warm light "idea" canvas vs. dark "build" theater, and *you* (left) vs. *Bimax* (right).

Section flow:
1. **Hero** — "Say it. Watch it build." with a live 3D moment: an ember **intent** core inside ink
   orbit-rings (echoing the Bimax mark) with a teal **build** crystal resolving inward on scroll. One
   CTA: *Download for Mac*. Static gradient fallback when WebGL/motion is unavailable.
2. **The turn** — a diptych: your one-line prompt (light card) → what Bimax did + a plain **What
   changed** list (dark card). Built from the real product, nothing invented.
3. **Product theater** — the real desktop app in a floating window, lit like a product shot.
4. **Open it · Say it · Ship it** — the whole loop in three plain beats, each with a real screen.
5. **What you can make** — four outcome cards (build a feature, understand a codebase, fix what's
   broken, keep projects moving), each with a real screen crop.
6. **You're in control** — approvals, see every change, it checks its own work, your code/your machine.
7. **Honest proof** — only locally verifiable facts (native app · your project · your machine).
8. **Download** — macOS (Apple Silicon) now; Windows/Linux noted honestly; a terminal one-liner.
9. **The honest FAQ** — do I need to code, where does my code go, which AI, cost, platforms, control.
10. **Final CTA + oversized wordmark footer.**

**Design language:** warm bone/paper canvas (`#F4EEE4`) with ink text, dark warm-black theater bands
(`#17130F`); two-mind accents ember `#DC5A34` + teal `#1F6E62`; Instrument Serif display, Inter body,
JetBrains Mono kickers; film grain, editorial pacing, single-CTA discipline. Deliberately *not* the
dark graphite/coral desktop theme, and not a generic neon-on-black AI page.

## 2. Files created / changed

**Docs (new):**
- `docs/SITE_END_USER_PLAN.md` — Phase 1: audience, positioning, IA, per-section copy, hidden tech,
  sources, mobile/a11y.
- `docs/SITE_MEDIA_RUNBOOK.md` — how media is made/optimized + exact commands to record a real demo.
- `docs/SITE_BUILD_REPORT.md` — this file.

**Site — new components:**
- `site/src/components/three/TwoMinds3D.tsx` — the signature 3D moment (visibility-gated, reduced-motion
  aware).
- `site/src/components/ProductWindow.tsx` — reusable app-window frame for real screenshots.
- `site/src/components/Marquee.tsx`, `site/src/components/Faq.tsx` — plain-language marquee + accordion.

**Site — rewritten:**
- `site/src/App.tsx` — the whole homepage (all sections), code-splits three.js, wraps `MotionConfig
  reducedMotion="user"`.
- `site/src/lib/content.tsx` — single source of truth, rewritten to plain vibe-coder copy.
- `site/src/components/Navbar.tsx` — minimal nav, one primary CTA, Bimax mark.
- `site/src/components/three/WebGLCanvas.tsx` — now pauses the render loop offscreen + honors reduced
  motion.
- `site/src/components/motion/SmoothScroll.tsx` — added a `?static` QA escape hatch.
- `site/src/index.css`, `site/tailwind.config.js` — new light/dark design system + tokens.
- `site/index.html` — new title/description/OG tags + inline SVG favicon (the Bimax mark).

**Media (new):** `site/public/media/ui-*.png` — eight real desktop screenshots, downscaled to 1800px.

**Removed:** the old "Nothin/Monolog studio clone" components that had replaced the Bimax content
(`NothWorksPortfolio`, `NothProteanSculpture3D`, `LiquidGlassCard`, `BuildLoopSection`,
`FeatureParallaxGrid`, `MindHudTerminal`, `OsDownloadMatrix`, `ShowcaseVideoPlayer`, `NeuralCore3D`,
`ScrollDrivenLattice3D`, `CinematicBackground`, `ui/Terminal`). No files outside `site/**` and
`docs/SITE_*` were touched.

## 3. Research sources

- **Monolog** — https://bymonolog.com (principles: editorial pacing, big statement lines, numbered
  story, one-metric proof, plain FAQ, 3-step process, minimal nav, oversized wordmark, film grain). We
  extracted principles and inverted the palette; we did not copy it.
- **Hermes Agent** — https://hermes-agent.nousresearch.com/ and
  https://github.com/NousResearch/hermes-agent (noted its weakness: static, no motion/demo/proof — we
  beat it with real motion, a live idea→result moment, and outcome copy).
- **Reference product pages** — Claude Code, Cursor, Lovable/Bolt/Replit, Zed (outcome-led hero;
  describe→build→ship; plain control/safety language; honest platform CTAs).
- **Real product** — `README.md`, `docs/FEATURES.md`, and the desktop screenshots in
  `app/release/ui-*.png` (the app's own copy — "What do you want to make?", "show you exactly what
  changed", the Review panel's approvals/verification — is already the vibe-coder language we used).

## 4. Verification — exact gates and results

Run from `site/`:

| Gate | Command | Result |
|---|---|---|
| Typecheck + production build | `npm run build` | ✅ Pass (`tsc --noEmit` clean, vite built in ~1.5s) |
| Bundle split (three.js deferred) | (build output) | ✅ main `304 KB` (97 KB gz); `TwoMinds3D` split to `822 KB` (221 KB gz), lazy-loaded after paint |
| Console errors (production path, 3D + smooth scroll on) | browser console | ✅ None |
| Network | browser network log | ✅ All requests 200/304; no 404s; media + lazy 3D chunk load |
| Horizontal overflow | `scrollWidth === clientWidth` at 390 / 768 / 1440 | ✅ No overflow at any width |
| Accessibility structure | DOM audit | ✅ exactly 1 `h1`; logical `h1→h2→h3`; **0** images without `alt`; **0** buttons without an accessible name; all nav/CTA links have valid hrefs |
| Responsive layout | full-page capture at 390 / 768 / 1440 | ✅ Clean stacking; nav collapses to CTA on mobile; dark/light bands hold |
| Contrast | visual + fix | ✅ Fixed the dark "build" cards (turn result + terminal) to a solid ink surface so light text reads on the light sections |
| Reduced motion | code paths | ✅ Lenis disabled; 3D renders a single static frame; `MotionConfig reducedMotion="user"` disables transform/scroll animations; CSS media query zeroes transitions |
| Offscreen animation | frameloop gating | ✅ 3D render loop pauses when the hero scrolls out of view (IntersectionObserver) |
| WebGL failure | guarded canvas | ✅ Canvas renders nothing and a CSS gradient stands in; copy never blanks |

### Visual QA method
The in-app browser was driven at 1440×900 (desktop), 768×1024 (tablet), and 390×844 (mobile). Because
the R3F render loop and the CSS marquee keep the compositor continuously busy, a `?static` QA flag and a
runtime animation-freeze were used to capture crisp full-page states; the **production path** (no flag)
was separately confirmed to load with no console errors and no failed requests.

## 5. Fixes made during the loop
- **Contrast:** the terminal/turn "build" cards used a translucent-white surface that vanished on the
  light sections → changed `.card-dark` to a solid ink background. Verified on mobile.
- **Performance:** three.js was in the main bundle → lazy-loaded into its own chunk; the render loop now
  pauses offscreen; DPR capped at 1.75.
- **Reduced motion:** added `MotionConfig reducedMotion="user"` so framer-motion (JS animations) honors
  the setting, not just CSS.
- **Hero readability:** strengthened the left/bottom scrims so the headline and subhead always win over
  the 3D.

## 6. Honest remaining limitations
- **Download link needs a real target.** All *Download for Mac* CTAs point to
  `/download/Bimax-1.0.0-arm64.dmg`, which does **not** exist in the site yet (the real `.dmg` is ~137 MB
  in `app/release/` — too large to commit). **Before/after deploy, host the DMG** (e.g. a GitHub Release
  or object storage) and update `DOWNLOAD_MAC` in `site/src/lib/content.tsx`, or drop the file at
  `site/public/download/Bimax-1.0.0-arm64.dmg`. Until then the button 404s. The terminal install URL
  (`bimax.app/install.sh`) is likewise a placeholder to confirm.
- **No demo video** was recorded (no reliable app-capture in this environment). The site reads as a demo
  via the real screenshots + the live 3D; `docs/SITE_MEDIA_RUNBOOK.md` has the exact record/encode
  commands to add one later (drop-in under `site/public/media/`).
- **`og-image.png`** is referenced but not generated (optional; social cards fall back to text). Runbook
  §6 covers it.
- **`?static` QA flag** remains in the source as an intentional, harmless escape hatch (only active when
  `?static` is in the URL). It disables the 3D, smooth scroll, and animations for screenshotting; real
  visitors never hit it.
- **Bundle note:** the three.js chunk is 822 KB (221 KB gz) but is lazy-loaded after first paint, so it
  never blocks the initial, fully-readable page.
- **Environment note (this machine):** the local APFS is flaky under disk pressure and truncated
  `node_modules` mid-build twice; a clean `npm ci` restored it. Deploying on Vercel's clean builders
  avoids this entirely.

## 7. Vercel-ready steps (deployment left to you)

**Preview locally**
```sh
cd site
npm ci
npm run build      # tsc + vite → dist/
npm run preview    # serves the built site at http://localhost:4173
```

**Deploy (you run this — not done here)**
- `site/vercel.json` is already set (`framework: vite`, `buildCommand: npm run build`,
  `outputDirectory: dist`). In Vercel, import the repo and set the **Root Directory to `site/`**; the
  build command and output dir come from `vercel.json`.
- Or from the `site/` directory: `vercel` (preview) / `vercel --prod` (production) — **left for you.**
- **Before shipping the download:** host `Bimax-1.0.0-arm64.dmg` and point `DOWNLOAD_MAC`
  (`site/src/lib/content.tsx`) at it; confirm the terminal install URL.

**Shortest path to see it now:** `cd site && npm run build && npm run preview` → open the printed URL.
