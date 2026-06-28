# Bimax — landing site

A single-page, cinematic landing site for Bimax. Two full-height sections (Hero + Capabilities) with
looping background videos (custom rAF crossfade), a liquid-glass design system, Framer Motion
entrance animations, and a React Three Fiber glass orb in the hero.

## Stack
- **Vite + React + TypeScript**
- **Tailwind CSS** — pill border-radius default, Instrument Serif (headings) + Barlow (body)
- **Framer Motion** — blur/opacity/y entrances + the word-by-word `BlurText` headline
- **React Three Fiber + drei** — the hero glass orb (`HeroOrb`), with a WebGL capability guard
- Self-hosted, web-optimized videos in `public/videos/` (h264, faststart, + poster frames)

## Develop
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
npm run preview  # serve the build
```

## Design system
- `.liquid-glass` / `.liquid-glass-strong` live in `src/index.css` (the exact spec).
- `FadingVideo` does the manual loop + crossfade (no CSS transitions); `loop` is off by design.
- `prefers-reduced-motion` hides the videos (posters remain) and the orb is skipped without WebGL.

## Deploy
Any static host. `vercel.json` is set for Vercel (build → `dist`). For Netlify/Cloudflare Pages:
build command `npm run build`, output dir `dist`.

## Notes
- Copy/stats reflect Bimax (terminal agent · Sketch Mode · Blueprint builders · Beast pipeline).
- Videos were sourced from the original template and re-encoded for the web; swap them in
  `public/videos/` (keep the same filenames) to rebrand the footage.
