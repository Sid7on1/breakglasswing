# Bimax Site — Media Runbook

How the site's product media is made, optimized, and (optionally) recorded into a demo video.
The site ships **without a required video** — it uses real, optimized screenshots and a live 3D moment —
so nothing here blocks a deploy. This is the recipe for refreshing assets or adding a demo clip later.

---

## 1. Where media lives

- **Source screenshots (real app):** `app/release/ui-*.png` (2880×1720, captured from the desktop app).
- **Web-optimized, served by the site:** `site/public/media/ui-*.png` (downscaled to 1800px wide).
- **3D signature moment:** rendered live in the browser — `site/src/components/three/TwoMinds3D.tsx`
  (no asset file; falls back to a CSS gradient scrim when WebGL is unavailable or motion is reduced).

The site references `/media/ui-*.png`. Vite serves `public/` at the web root, so `public/media/x.png`
→ `/media/x.png`.

## 2. Regenerating the optimized screenshots

The source screenshots are 2880px wide (~300–600 KB each). We downscale to 1800px for the web:

```sh
cd /Users/vishsiddharth/Desktop/Bimax
mkdir -p site/public/media
for n in home composer diff review welcome gallery transcript editor; do
  sips -Z 1800 "app/release/ui-$n.png" --out "site/public/media/ui-$n.png"
done
```

`sips` is built into macOS. To squeeze further (optional), export high-quality JPEG instead:

```sh
sips -Z 1800 -s format jpeg -s formatOptions 82 "app/release/ui-home.png" \
  --out "site/public/media/ui-home.jpg"
```

(If you switch a file to `.jpg`, update its path in `site/src/lib/content.tsx` / the section that
references it.)

## 3. Capturing fresh app screenshots

The repo already has a screenshot script for the desktop app:

```sh
cd app
node scripts/screenshot-ui.mjs      # writes ui-*.png into app/release/
```

Then re-run the downscale step (§2). Keep the same filenames so nothing in the site needs editing.

## 4. Optional: recording a real product demo video

We deliberately did **not** fake a demo. If you want a `demo-build.webm/.mp4` for a future "watch it
build" section, record the **real app** deterministically:

### Option A — screen-record the desktop app
1. Open the Bimax app on a project.
2. macOS screen recording: `⇧⌘5` → record the app window (or `1440×900` region) → run one clean task
   (e.g. "Add retry with backoff to the fetch client") end to end: prompt → work → **what changed** →
   approve.
3. Trim, then compress:

```sh
# MP4 (H.264, faststart, no audio) + WebM (VP9) — both muted, web-optimized
ffmpeg -i raw.mov -vf "scale=1600:-2" -an -movflags +faststart -crf 23 -pix_fmt yuv420p \
  site/public/media/demo-build.mp4
ffmpeg -i raw.mov -vf "scale=1600:-2" -an -c:v libvpx-vp9 -b:v 0 -crf 34 \
  site/public/media/demo-build.webm

# Poster frame (first clean frame)
ffmpeg -i site/public/media/demo-build.mp4 -vframes 1 site/public/media/demo-build-poster.jpg
```

4. Add a `<video muted loop playsInline poster=…>` gated by an IntersectionObserver (play in view,
   pause off-screen) and by `prefers-reduced-motion` (show poster only). Keep total video < ~6 MB.

### Option B — deterministic site demo (no app recording)
If app recording isn't available, record the **site itself** driving the real screenshots (the
idea→result diptych + product theater already read as a demo). Use a headless capture:

```sh
cd site && npm run build && npm run preview   # serves the built site on :4173
# then record :4173 with your tool of choice (Playwright video, or ⇧⌘5 on the browser)
```

Document which was used in `docs/SITE_BUILD_REPORT.md`.

## 5. Optimization rules (all media)

- Screenshots: ≤ 1800px wide, lazy-loaded (`loading="lazy"`), `decoding="async"`; only the hero/theater
  image is eager.
- Video (if added): muted, `playsInline`, poster always, in-view play only, MP4 + WebM, < ~6 MB total.
- No external hosts — everything self-hosted under `site/public/` (Vercel serves it from the same
  origin).
- Provide static fallbacks for reduced-motion and WebGL failure (already handled for the 3D moment).

## 6. OG / social image (optional)

`index.html` references `/media/og-image.png` (1200×630). It's optional — if absent, social cards just
fall back to text. To make one, screenshot the hero at 1200×630 or compose one in any tool and drop it
at `site/public/media/og-image.png`.
