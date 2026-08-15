#!/usr/bin/env bash
# Phase 1's reproducible, same-machine qualification gate. This deliberately does not pretend to
# replace the quarantined-download/TCC matrix on genuinely fresh Macs; that remains a release-lab
# gate because resetting a developer's live TCC database is destructive and still is not a clean OS.
set -euo pipefail
cd "$(dirname "$0")/.."

for required in \
  AGENTS.md \
  docs/product-reset/05_TARGET_ARCHITECTURE.md \
  docs/product-reset/07_MIGRATION_ROADMAP.md \
  docs/product-reset/08_ACCEPTANCE_GATES.md \
  docs/product-reset/09_PHASE1_FILE_MAP.md; do
  [ -s "$required" ] || { echo "phase 1 local gate: missing required research/contract: $required" >&2; exit 1; }
done

export GOCACHE="${GOCACHE:-${TMPDIR:-/tmp}/bimax-phase1-go-cache}"

echo "[1/8] complete Terminal release gate"
BIMAX_RELEASE_AUTONOMY_SOFT_FLOOR="${BIMAX_RELEASE_AUTONOMY_SOFT_FLOOR:-0}" scripts/release-gate.sh

echo "[2/8] macOS sandbox integration (zero skips required)"
sandbox_report="$(mktemp)"
trap 'rm -f "$sandbox_report"' EXIT
npx jest --coverage=false --runInBand --testTimeout=30000 \
  src/__tests__/exec.sandbox.test.ts src/__tests__/sandbox.floor.test.ts \
  --json --outputFile="$sandbox_report"
node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(r.numPendingTests) throw new Error(`${r.numPendingTests} sandbox tests skipped`); if(!r.success) process.exit(1)' "$sandbox_report"

echo "[3/8] arm64 + x64 Terminal release archives"
./release.sh
npm run verify:terminal-archives

echo "[4/8] shipped Terminal protocol, boundary, and latency"
case "$(uname -m)" in
  arm64|aarch64)
    npm run verify:terminal-protocol -- build/bimax-darwin-arm64
    BIMAX_FOREIGN_ARCH=1 npm run verify:terminal-protocol -- build/bimax-darwin-x64
    ;;
  *)
    npm run verify:terminal-protocol -- build/bimax-darwin-x64
    echo "arm64 execution is not available on Intel; archive/layout checks passed and native arm64 timing remains an external row"
    ;;
esac

echo "[5/8] arm64 Bimax.app"
BIMAX_ENGINE_ARTIFACT_DIR="$PWD/build" npm --prefix app run dist:mac
npm run verify:desktop-package -- app/release/mac-arm64/Bimax.app arm64

echo "[6/8] x64 Bimax.app"
BIMAX_ENGINE_ARTIFACT_DIR="$PWD/build" npm --prefix app run dist:mac:x64
npm run verify:desktop-package -- app/release/mac/Bimax.app x86_64

echo "[7/8] desktop type and protocol mirrors"
npm --prefix app run typecheck
npm run check:protocol-mirror

echo "[8/8] local qualification result"
echo "PHASE 1 LOCAL GATE PASSED"
echo "External gate still required: fresh quarantined install + no Terminal TCC prompts on the oldest/current supported macOS, arm64/x64."
