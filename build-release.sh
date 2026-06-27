#!/usr/bin/env bash
# Build the single, self-contained BiMax binary: a Go/Bubble Tea front-end with the bun-compiled
# Node engine baked in via go:embed. The result (build/bimax) ships as ONE file — no Node, no Bun,
# no node_modules on the host. The engine's TypeScript is reused verbatim; nothing is ported.
set -euo pipefail
cd "$(dirname "$0")"

OUT="build/bimax"
mkdir -p build tui/embed

echo "[1/2] Compiling engine → standalone binary (bun --compile, CJS format) …"
# --format=cjs is required: the engine is CommonJS, and Bun's default ESM bundling mangles the
# web-tree-sitter Emscripten glue (surfaces as 'ReferenceError: _a is not defined' at boot).
bun build src/index.ts --compile --format=cjs --outfile tui/embed/bimax-engine

echo "[2/2] Building single Go binary with the engine embedded …"
( cd tui && go build -tags embedengine -o "../$OUT" . )

echo "Done → $OUT ($(du -h "$OUT" | cut -f1)).  Run it inside any project directory."
