#!/usr/bin/env bash
# Cross-compile the standalone Linux BiMax binary the Terminal-Bench adapter copies into
# task containers. Mirrors release.sh's engine step (bun --compile, CJS) but targets Linux.
#   ./build-binary.sh            # arch auto (arm64 on Apple Silicon — matches local Docker)
#   ./build-binary.sh x64        # explicit arch (use for cloud/amd64 runners)
set -euo pipefail
cd "$(dirname "$0")/../.."

ARCH="${1:-}"
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    arm64|aarch64) ARCH=arm64 ;;
    *)             ARCH=x64 ;;
  esac
fi

OUT="benchmarks/terminal_bench_adapter/bin/bimax-linux-${ARCH}"
mkdir -p "$(dirname "$OUT")"
echo "→ bun build src/index.ts --compile --format=cjs --target=bun-linux-${ARCH} → ${OUT}"
bun build src/index.ts --compile --format=cjs \
  --target="bun-linux-${ARCH}" --outfile "$OUT"
ls -lh "$OUT"
