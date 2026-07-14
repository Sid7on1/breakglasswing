#!/usr/bin/env bash
# One command that proves a host release candidate is fit to hand to a user. It intentionally runs
# the browser E2E and the embedded-binary build in addition to unit tests: launch readiness is a
# runtime property, not a green TypeScript compile.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/10] TypeScript build"
npm run build

echo "[2/10] Protocol mirror"
npm run check:protocol-mirror

echo "[3/10] Engine tests + real browser smoke"
BIMAX_BROWSER_E2E=1 npm run test:ci -- --runInBand --testTimeout=30000

echo "[4/10] Go TUI tests"
( cd tui && GOCACHE="${TMPDIR:-/tmp}/bimax-release-go-cache" go test ./... )

echo "[5/10] Self-contained host binary"
./build-release.sh

echo "[6/10] Artifact identity"
version="$(node -p "require('./package.json').version")"
actual="$(./build/bimax --version)"
[ "$actual" = "bimax $version" ] || { echo "version mismatch: expected bimax $version, got $actual" >&2; exit 1; }
./build/bimax --help >/dev/null

echo "[7/10] Clean local install"
install_root="$(mktemp -d)"
trap 'rm -rf "$install_root"' EXIT
mkdir -p "$install_root/home"
HOME="$install_root/home" BIMAX_INSTALL_DIR="$install_root/bin" BIMAX_LOCAL_ARTIFACT="$PWD/build/bimax" ./install.sh
"$install_root/bin/bimax" --version >/dev/null

echo "[8/10] First-user dogfood"
npx tsx scripts/dogfood-release.ts

echo "[9/10] Offline autonomy pipeline suite"
npx tsx benchmarks/autonomy/run.ts --suite

echo "[10/10] Release checksum"
( cd build && shasum -a 256 bimax > bimax.sha256 )

echo ""
echo "RELEASE GATE PASSED — build/bimax ($actual)"
cat build/bimax.sha256
