#!/usr/bin/env bash
# lib-build.sh — the shared build steps for the single self-contained BiMax binary: the bun-compiled
# Node engine baked into the Go / Bubble Tea TUI via go:embed, so the result ships as ONE file (no
# Node, no Bun, no node_modules on the host). Sourced by build-release.sh (quick host dev build →
# build/bimax) and release.sh (cross-platform release matrix). Not meant to be run on its own.

# Release version string: env override → package.json → 0.0.0.
bimax_version() { echo "${BIMAX_VERSION:-$(node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)}"; }

# Sweep bun's 60MB `.<hash>.bun-build` scratch blobs, which it leaves at cwd if --compile is
# interrupted; run before and after a build so they never pile up in the repo root (gitignored too).
bimax_sweep_bunbuild() { rm -f .*.bun-build 2>/dev/null || true; }

# Build one target: compile the engine, then the Go binary with it embedded.
#   build_bimax <goos> <goarch> <outfile> <mode:dev|release> [bun-target]
# Empty goos/goarch → host-native build (no cross-compile env). Empty bun-target → host engine
# compile (no --target). release mode adds -s -w -trimpath; dev keeps symbols for local debugging.
build_bimax() {
  local goos="$1" goarch="$2" outfile="$3" mode="$4" bun_target="${5:-}"
  local version ldflags; version="$(bimax_version)"
  # Provenance stamps (§10): commit, build time, tree dirtiness, and channel land in the binary so
  # `bimax --version` reports exactly what it is. Channel is "release" only for release builds.
  local commit dirty btime chan
  commit="$(git rev-parse --short=8 HEAD 2>/dev/null || echo unknown)"
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then dirty=true; else dirty=false; fi
  btime="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ "$mode" = release ]; then chan=release; else chan=dev; fi
  ldflags="-X main.version=${version} -X main.commit=${commit} -X main.dirty=${dirty} -X main.buildTime=${btime} -X main.channel=${chan}"
  local goflags=() env_prefix=()
  if [ "$mode" = release ]; then ldflags="-s -w ${ldflags}"; goflags+=(-trimpath); fi
  if [ -n "$goos" ]; then env_prefix=(env CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch"); fi
  mkdir -p build tui/embed

  echo "[1/2] engine → standalone binary (bun --compile, CJS${bun_target:+, ${bun_target}}) …"
  # --format=cjs is required: the engine is CommonJS, and Bun's default ESM bundling mangles the
  # web-tree-sitter Emscripten glue (surfaces as 'ReferenceError: _a is not defined' at boot).
  if [ -n "$bun_target" ]; then
    bun build src/index.ts --compile --format=cjs --target="$bun_target" --outfile tui/embed/bimax-engine
  else
    bun build src/index.ts --compile --format=cjs --outfile tui/embed/bimax-engine
  fi

  echo "[2/2] Go binary with the engine embedded → ${outfile} …"
  # Guard empty-array expansion: macOS's bash 3.2 treats "${arr[@]}" as unbound under `set -u`.
  ( cd tui && ${env_prefix[@]+"${env_prefix[@]}"} go build -tags embedengine ${goflags[@]+"${goflags[@]}"} -ldflags "$ldflags" -o "../$outfile" . )
}
