#!/usr/bin/env bash
# One command that proves a host release candidate is fit to hand to a user. It intentionally runs
# the browser E2E and the embedded-binary build in addition to unit tests: launch readiness is a
# runtime property, not a green TypeScript compile.
set -euo pipefail
cd "$(dirname "$0")/.."

# Keep the gate hermetic on managed builders where the user-level Go cache is intentionally
# read-only. Honor an explicit caller cache, otherwise use the same disposable cache for both the
# TUI tests and the embedded release build.
export GOCACHE="${GOCACHE:-${TMPDIR:-/tmp}/bimax-release-go-cache}"
# A nested sandbox can prevent the autonomy fixture from starting its own OS sandbox. Keep any
# explicit test-harness bypass scoped to stage 9; the product tests below must always exercise the
# normal fail-closed default.
release_autonomy_soft_floor="${BIMAX_RELEASE_AUTONOMY_SOFT_FLOOR:-0}"
unset BIMAX_SANDBOX_FLOOR_SOFT

echo "[1/10] TypeScript build"
npm run build

echo "[2/10] Protocol mirror"
npm run check:protocol-mirror

echo "[3/10] Engine tests + real browser smoke"
BIMAX_BROWSER_E2E=1 npm run test:ci -- --runInBand --testTimeout=30000

echo "[4/10] Go TUI tests"
( cd tui && go test ./... )

echo "[5/10] Self-contained host binary"
./build-release.sh

echo "[6/10] Artifact identity"
version="$(node -p "require('./package.json').version")"
actual="$(./build/bimax --version)"
first_line="${actual%%$'\n'*}"
[ "$first_line" = "bimax $version" ] || { echo "version mismatch: expected first line 'bimax $version', got '$first_line'" >&2; exit 1; }
source_actual="$(node dist/index.js --version)"
[ "$source_actual" = "$version" ] || { echo "source CLI version mismatch: expected '$version', got '$source_actual'" >&2; exit 1; }
./build/bimax --help >/dev/null

# Structural Terminal boundary: only the coding engine may be embedded by the Go release source.
if grep -En 'go:embed embed/(bimax-computer-use|bimax-live-pip|bimax-desktop-helper|bimax-cu-service)' tui/embed_prod.go; then
  echo "Terminal release source still embeds a Computer Use payload" >&2
  exit 1
fi

echo "[7/10] Clean local install"
install_root="$(mktemp -d)"
trap 'rm -rf "$install_root"' EXIT
mkdir -p "$install_root/home"
HOME="$install_root/home" BIMAX_INSTALL_DIR="$install_root/bin" BIMAX_LOCAL_ARTIFACT="$PWD/build/bimax" ./install.sh
"$install_root/bin/bimax" --version >/dev/null

echo "[8/10] First-user dogfood"
node --import tsx scripts/dogfood-release.ts

echo "[9/10] Offline autonomy pipeline suite"
if [ "$release_autonomy_soft_floor" = "1" ]; then
  BIMAX_SANDBOX_FLOOR_SOFT=1 node --import tsx benchmarks/autonomy/run.ts --suite
else
  node --import tsx benchmarks/autonomy/run.ts --suite
fi

echo "[10/10] Release checksum"
( cd build && shasum -a 256 bimax > bimax.sha256 )

echo ""
echo "RELEASE GATE PASSED — build/bimax ($actual)"
cat build/bimax.sha256
