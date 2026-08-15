#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[phase3] generated protocol contract"
npm run gen:protocol
npm run gen:app-protocol
npm run check:protocol-mirror

echo "[phase3] current + previous compatibility and boundary contracts"
npx jest --coverage=false --runInBand \
  src/__tests__/protocol.test.ts \
  src/__tests__/protocol.contract.test.ts \
  src/__tests__/desktop.supervisor.test.ts \
  src/__tests__/desktop.bundle.resolution.test.ts \
  src/__tests__/phase3.engine.boundary.test.ts
( cd tui && GOCACHE="${TMPDIR:-/tmp}/bimax-phase3-go-cache" go test ./... )

echo "[phase3] architecture artifacts and pinned manifest"
# Match release.sh exactly: Bun embeds the output path in the executable, so build in the shared
# release staging path and copy that exact binary just as Terminal release packaging does.
bun build src/index.ts --compile --format=cjs --target=bun-darwin-arm64 --outfile tui/embed/bimax-engine
cp tui/embed/bimax-engine build/bimax-engine-darwin-arm64
bun build src/index.ts --compile --format=cjs --target=bun-darwin-x64 --outfile tui/embed/bimax-engine
cp tui/embed/bimax-engine build/bimax-engine-darwin-x64
node scripts/generate-engine-manifest.mjs build
actual_manifest="$(shasum -a 256 build/bimax-engine-manifest.json | awk '{print $1}')"
locked_manifest="$(node -p "require('./app/engine.lock.json').manifestSha256")"
[ "$actual_manifest" = "$locked_manifest" ] || { echo "engine lock stale: $locked_manifest != $actual_manifest" >&2; exit 1; }
BIMAX_ENGINE_ARTIFACT_DIR="$PWD/build" npm --prefix app run prepare:engine -- darwin-arm64

echo "[phase3] digest and size mutations fail closed"
phase3_tmp="$(mktemp -d)"
trap 'rm -rf "$phase3_tmp"' EXIT
cp build/bimax-engine-manifest.json "$phase3_tmp/"
cp build/bimax-engine-darwin-arm64 "$phase3_tmp/"
cp build/bimax-engine-darwin-x64 "$phase3_tmp/"
printf x >> "$phase3_tmp/bimax-engine-darwin-arm64"
if BIMAX_ENGINE_ARTIFACT_DIR="$phase3_tmp" npm --prefix app run prepare:engine -- darwin-arm64 >/dev/null 2>&1; then
  echo "mutated engine was accepted" >&2; exit 1
fi
cp build/bimax-engine-darwin-arm64 "$phase3_tmp/bimax-engine-darwin-arm64"
printf ' ' >> "$phase3_tmp/bimax-engine-manifest.json"
if BIMAX_ENGINE_ARTIFACT_DIR="$phase3_tmp" npm --prefix app run prepare:engine -- darwin-arm64 >/dev/null 2>&1; then
  echo "mutated manifest was accepted" >&2; exit 1
fi
BIMAX_ENGINE_ARTIFACT_DIR="$PWD/build" npm --prefix app run prepare:engine -- darwin-arm64

echo "[phase3] Desktop builds in a checkout with no Terminal source"
mkdir -p "$phase3_tmp/standalone"
tar -C app --exclude=node_modules --exclude=release --exclude=out -cf - . | tar -C "$phase3_tmp/standalone" -xf -
ln -s "$PWD/app/node_modules" "$phase3_tmp/standalone/node_modules"
[ ! -e "$phase3_tmp/standalone/../src" ]
( cd "$phase3_tmp/standalone" && npm run typecheck && npm run build )

echo "phase3 local gate: PASS"
