#!/usr/bin/env bash
# release.sh — build the full BiMax release matrix: ONE self-contained binary per platform
# (Go TUI with the bun-compiled Node engine baked in via go:embed — no Node, no Bun, no
# node_modules on the host), tarballed with SHA256SUMS, ready to attach to a GitHub release.
#
#   ./release.sh                 # all targets
#   ./release.sh darwin-arm64    # one target
#   BIMAX_VERSION=1.2.0 ./release.sh
#
# Requirements (build machine only): bun ≥ 1.1, go ≥ 1.22.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${BIMAX_VERSION:-$(node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)}"
TARGETS=("${@:-darwin-arm64 darwin-x64 linux-x64 linux-arm64}")
# Re-split the default string into words when no args were given.
[ $# -eq 0 ] && TARGETS=(darwin-arm64 darwin-x64 linux-x64 linux-arm64)

command -v bun >/dev/null || { echo "error: bun is required (https://bun.sh)"; exit 1; }
command -v go  >/dev/null || { echo "error: go is required (https://go.dev)"; exit 1; }

mkdir -p build tui/embed
rm -f build/SHA256SUMS

for target in "${TARGETS[@]}"; do
  os="${target%%-*}"
  arch="${target##*-}"
  goarch="$arch"; [ "$arch" = "x64" ] && goarch=amd64
  out="build/bimax-${os}-${arch}"

  echo "── ${target} ──────────────────────────────────────"
  echo "[1/2] engine (bun --compile --target=bun-${os}-${arch}, CJS) …"
  # --format=cjs is required: Bun's default ESM bundling mangles the web-tree-sitter
  # Emscripten glue ('ReferenceError: _a is not defined' at boot).
  bun build src/index.ts --compile --format=cjs \
    --target="bun-${os}-${arch}" --outfile tui/embed/bimax-engine

  echo "[2/2] TUI (GOOS=${os} GOARCH=${goarch}, engine embedded) …"
  ( cd tui && CGO_ENABLED=0 GOOS="$os" GOARCH="$goarch" \
      go build -tags embedengine -trimpath \
      -ldflags "-s -w -X main.version=${VERSION}" -o "../$out" . )

  tar -C build -czf "${out}.tar.gz" "$(basename "$out")"
  ( cd build && shasum -a 256 "$(basename "$out").tar.gz" >> SHA256SUMS )
  echo "   → ${out}.tar.gz ($(du -h "${out}.tar.gz" | cut -f1))"
done

echo ""
echo "Release ${VERSION} built:"
cat build/SHA256SUMS
echo ""
echo "Attach build/*.tar.gz + build/SHA256SUMS to the GitHub release; install.sh downloads them."
