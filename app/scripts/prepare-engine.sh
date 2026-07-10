#!/usr/bin/env bash
# prepare-engine.sh — bun-compile the headless engine into app/engine/ for the platform+arch
# the desktop build targets. electron-builder then bundles app/engine/* as an extraResource.
#
#   ./scripts/prepare-engine.sh                # host platform (darwin-arm64 on Apple Silicon)
#   ./scripts/prepare-engine.sh darwin-x64
#   ./scripts/prepare-engine.sh windows-x64    # engine for the Windows installer
#
# Mirrors release.sh at the repo root: --format=cjs is required (Bun's ESM bundling mangles the
# web-tree-sitter Emscripten glue), and the output is a standalone binary — no Node on the host.
set -euo pipefail
cd "$(dirname "$0")/.."   # app/
REPO="$(cd .. && pwd)"

command -v bun >/dev/null || { echo "error: bun is required (https://bun.sh)"; exit 1; }

host_target() {
  local os arch
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) os=windows ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; *) arch=x64 ;; esac
  echo "${os}-${arch}"
}

TARGET="${1:-$(host_target)}"
OS="${TARGET%%-*}"
OUT="engine/bimax-engine"
[ "$OS" = "windows" ] && OUT="engine/bimax-engine.exe"

rm -rf engine && mkdir -p engine

echo "engine → bun build --compile --target=bun-${TARGET} (cjs) …"
( cd "$REPO" && bun build src/index.ts --compile --format=cjs \
    --target="bun-${TARGET}" --outfile "app/${OUT%.exe}" )

# bun names windows output .exe itself; normalize if it didn't.
if [ "$OS" = "windows" ] && [ ! -f "$OUT" ] && [ -f "engine/bimax-engine" ]; then
  mv engine/bimax-engine "$OUT"
fi

echo "engine ready: app/${OUT} ($(du -h "$OUT" | cut -f1))"
