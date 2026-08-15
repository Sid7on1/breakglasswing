# Bimax Desktop

The Bimax agent as a native macOS desktop app. An Electron shell that
spawns a pinned Bimax Terminal headless-engine release (`BIMAX_HEADLESS=1`, NDJSON over stdio).
The versioned contract is represented by `engine.lock.json` and the generated compatibility module
in `src/shared/protocol.compat.gen.ts`; the app refuses an incompatible or incorrectly hashed engine.

## Layout

```
src/main/      Electron main — window + Engine host (ports tui/engine.go: spawn resolution,
               NDJSON framing, stderr → <userData>/engine.log)
src/preload/   contextBridge: the renderer's only door to the engine
src/renderer/  React chat UI — transcript, streaming, tool cards, approval/diff/ask modals,
               engine menus, slash/@ completions, ui_snapshot footer
scripts/       prepare-engine.sh — verifies/stages the pinned per-architecture engine artifact
               prepare-native.sh — builds Desktop-owned XPC/bridge/helper components
```

## Dev

```bash
npm install
npm run prepare:engine # verify/stage the pinned host-architecture engine
npm run dev          # Vite HMR renderer + Electron; engine runs from the staged artifact
```

Engine resolution uses `app/engine/bimax-engine`, verified against `engine.lock.json`. CI/offline
builds set `BIMAX_ENGINE_ARTIFACT_DIR`; normal preparation downloads the pinned release asset.
Contributors can deliberately override the launch command with `BIMAX_ENGINE_CMD`, but release
builds refuse the preparation-time `BIMAX_ENGINE_LOCAL_OVERRIDE`. There is no implicit Terminal
source fallback.

## Package

```bash
npm run dist:mac       # DMG, Apple Silicon (arm64)
npm run dist:mac:x64   # DMG, Intel
```

Each dist script verifies the matching pinned engine artifact into `engine/` (bundled as an
extraResource at `<Resources>/engine/bimax-engine`), stages the Desktop-owned native components,
builds the renderer/main bundles, and invokes electron-builder. Output lands in `release/`.

Local builds are unsigned unless Developer ID credentials are available. They are suitable only for
the explicitly labeled manual-install alpha flow; a stable public release must pass the signing,
notarization, stapling, update, and fresh-Mac gates in `docs/product-reset/08_ACCEPTANCE_GATES.md`.
