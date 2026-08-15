#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
OUTPUT_ROOT="${1:-}"
if [ -z "$OUTPUT_ROOT" ]; then
  echo "usage: scripts/phase6-local-gate.sh <new-output-directory>" >&2
  exit 2
fi
case "$OUTPUT_ROOT" in
  /*) ;;
  *) OUTPUT_ROOT="$PWD/$OUTPUT_ROOT" ;;
esac
if [ -e "$OUTPUT_ROOT" ]; then
  echo "error: output directory already exists: $OUTPUT_ROOT" >&2
  exit 2
fi

command -v git-filter-repo >/dev/null || {
  echo "error: git-filter-repo is required by docs/product-reset/06_REPO_SPLIT_RUNBOOK.md" >&2
  exit 2
}

mkdir -p "$OUTPUT_ROOT"
SNAPSHOT="$OUTPUT_ROOT/snapshot"
TERMINAL="$OUTPUT_ROOT/bimax-terminal"
DESKTOP="$OUTPUT_ROOT/bimax-desktop"
SOURCE_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"

echo "[phase6] capture the current Phase 1-5 working tree in a fresh local clone"
git clone --quiet --no-hardlinks "$SOURCE_ROOT" "$SNAPSHOT"
git -C "$SOURCE_ROOT" diff --binary HEAD | git -C "$SNAPSHOT" apply --binary
while IFS= read -r -d '' file; do
  case "$file" in
    app/.bimax/*|benchmarks/autonomy/results/*) continue ;;
  esac
  mkdir -p "$SNAPSHOT/$(dirname "$file")"
  cp -p "$SOURCE_ROOT/$file" "$SNAPSHOT/$file"
done < <(git -C "$SOURCE_ROOT" ls-files --others --exclude-standard -z)
git -C "$SNAPSHOT" add -A
if ! git -C "$SNAPSHOT" diff --cached --quiet; then
  git -C "$SNAPSHOT" -c user.name='Bimax Phase 6' -c user.email='phase6@local.invalid' \
    commit --quiet -m 'chore: capture pre-split product boundary'
fi
SNAPSHOT_COMMIT="$(git -C "$SNAPSHOT" rev-parse HEAD)"
git -C "$SNAPSHOT" tag pre-split-2026-08-09-local

echo "[phase6] filter Terminal history"
git clone --quiet --no-hardlinks "$SNAPSHOT" "$TERMINAL"
git -C "$TERMINAL" filter-repo --force --invert-paths \
  --path app/ \
  --path native/ \
  --path site/ \
  --path docs/product-reset/

echo "[phase6] filter Desktop history and promote app/ to repository root"
git clone --quiet --no-hardlinks "$SNAPSHOT" "$DESKTOP"
git -C "$DESKTOP" filter-repo --force \
  --path app/ \
  --path native/BimaxComputerUseKit/ \
  --path docs/product-reset/ \
  --path docs/APP_FULL_UI_PLAN.md \
  --path docs/BIMAX_CU_BASELINE_v1.1.0.md \
  --path docs/INSTALL.md \
  --path docs/SECURITY_INSTALL.md \
  --path docs/TASK_WORKSPACES.md \
  --path scripts/verify-desktop-package.mjs \
  --path AGENTS.md \
  --path PRIVACY.md \
  --path THIRD_PARTY_NOTICES.md \
  --path-rename app/:

node "$SOURCE_ROOT/scripts/phase6/materialize-repos.mjs" \
  "$TERMINAL" "$DESKTOP" "$SOURCE_COMMIT" "$SNAPSHOT_COMMIT"
for repo in "$TERMINAL" "$DESKTOP"; do
  git -C "$repo" add -A
  git -C "$repo" -c user.name='Bimax Phase 6' -c user.email='phase6@local.invalid' \
    commit --quiet -m 'chore: establish independent product repository'
done

echo "[phase6] static ownership and history gates"
test ! -e "$TERMINAL/app"
test ! -e "$TERMINAL/native"
test ! -e "$TERMINAL/src/computer"
test ! -e "$DESKTOP/src/core/agent.loop.ts"
test ! -e "$DESKTOP/tui"
test -f "$DESKTOP/engine.lock.json"
test -f "$DESKTOP/native/BimaxComputerUseKit/Package.swift"
test -f "$DESKTOP/src/capabilities/mac/provider.entry.ts"
test "$(git -C "$TERMINAL" rev-list --count HEAD)" -gt 2
test "$(git -C "$DESKTOP" rev-list --count HEAD)" -gt 2
git -C "$TERMINAL" log --follow --oneline -- src/index.ts >/dev/null
git -C "$DESKTOP" log --follow --oneline -- src/main/index.ts >/dev/null

echo "[phase6] install and run Terminal pipeline"
( cd "$TERMINAL" && npm ci --ignore-scripts && npm run build && npm run test:ci )
( cd "$TERMINAL/tui" && GOCACHE="${TMPDIR:-/tmp}/bimax-phase6-go-cache" go test ./... )
( cd "$TERMINAL" && ./release.sh )
host_arch="$(uname -m)"
[ "$host_arch" = x86_64 ] && host_arch=x64
( cd "$TERMINAL" && npm run verify:terminal-archives && \
    npm run verify:terminal-protocol -- "build/bimax-darwin-$host_arch" )

echo "[phase6] pin Desktop to the exact split Terminal manifest"
node "$SOURCE_ROOT/scripts/phase6/pin-desktop-engine.mjs" \
  "$DESKTOP" "$TERMINAL/build/bimax-engine-manifest.json"
git -C "$DESKTOP" add engine.lock.json repo-boundary.json
git -C "$DESKTOP" -c user.name='Bimax Phase 6' -c user.email='phase6@local.invalid' \
  commit --quiet -m 'chore: pin split Terminal engine manifest'

echo "[phase6] install and run Desktop pipeline"
( cd "$DESKTOP" && npm ci --ignore-scripts && npm run ci:check )
( cd "$DESKTOP" && swift build --package-path native/BimaxComputerUseKit --product bimax-cu-service )
( cd "$DESKTOP" && swift build --package-path native/BimaxComputerUseKit --product bimax-cu-bridge )
( cd "$DESKTOP" && bun build --compile --target="bun-darwin-$host_arch" \
    src/capabilities/mac/provider.entry.ts --outfile native-service/bimax-mac-capability )
( cd "$DESKTOP" && node scripts/verify-mac-provider.mjs native-service/bimax-mac-capability )
( cd "$DESKTOP" && BIMAX_ENGINE_ARTIFACT_DIR="$TERMINAL/build" npm run prepare:engine -- "darwin-$host_arch" )

echo "[phase6] source and derived trees are cleanly separated"
git -C "$TERMINAL" status --short
git -C "$DESKTOP" status --short
echo "phase6 local gate: PASS"
echo "terminal=$TERMINAL"
echo "desktop=$DESKTOP"
echo "sourceCommit=$SOURCE_COMMIT"
echo "snapshotCommit=$SNAPSHOT_COMMIT"
