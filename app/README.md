# Bimax Desktop

The Bimax agent as a native desktop app (macOS DMG, Windows installer). An Electron shell that
spawns the same headless engine (`BIMAX_HEADLESS=1`, NDJSON over stdio) the Go TUI drives — the
protocol contract lives in `../src/protocol/protocol.ts` and is mirrored in
`src/renderer/src/protocol.ts` (versioned; the app refuses a mismatched engine).

## Layout

```
src/main/      Electron main — window + Engine host (ports tui/engine.go: spawn resolution,
               NDJSON framing, stderr → <userData>/engine.log)
src/preload/   contextBridge: the renderer's only door to the engine
src/renderer/  React chat UI — transcript, streaming, tool cards, approval/diff/ask modals,
               engine menus, slash/@ completions, ui_snapshot footer
scripts/       prepare-engine.sh — bun-compiles the standalone engine binary per target
```

## Dev

```bash
cd app
npm install
npm run dev          # Vite HMR renderer + Electron; engine runs from ../dist (or npx tsx fallback)
```

Engine resolution in dev prefers `../dist/index.js` when fresh (`npm run build` at the repo root
first), else falls back to `npx tsx src/index.ts`. Override with `BIMAX_ENGINE_CMD`.

## Package

```bash
npm run dist:mac       # DMG, Apple Silicon (arm64)
npm run dist:mac:x64   # DMG, Intel
npm run dist:win       # NSIS installer, x64 (engine: bun-windows-x64)
```

Each dist script compiles the engine for the matching platform/arch into `engine/` (bundled as an
extraResource at `<Resources>/engine/bimax-engine[.exe]`), builds the renderer/main bundles, and
invokes electron-builder. Output lands in `release/`.

Builds are **unsigned** (`identity: null`) — fine for local installs; set a Developer ID +
notarization in `electron-builder.yml` before public distribution. The Windows target is wired but
untested from macOS; NSIS cross-builds generally work via electron-builder, verify on a Windows
machine before shipping.
