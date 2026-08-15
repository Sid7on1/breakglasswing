#!/usr/bin/env bash
# Build a LOCAL, runnable Bimax.app on this machine.
#
# `npm run dist:mac` targets a release: it refuses a local engine and produces a hardened bundle for
# notarization. Neither is right for a build you intend to run here, and two failures on 2026-08-15
# proved it — both silent until launch.
#
#   1. HARDENED RUNTIME + A SELF-SIGNED CERT CANNOT RUN.
#      electron-builder.yml assumes "keyless local builds remain unsigned". Once the self-signed
#      "Bimax Local Code Signing" identity exists in the keychain that stops being true:
#      auto-discovery signs with it AND applies `hardenedRuntime: true`. Hardened runtime enforces
#      library validation, which requires every loaded library to share the process's Team ID — and
#      a self-signed cert has none. The app dies in dyld before any of its own code runs:
#        Library not loaded: @rpath/Electron Framework.framework/Electron Framework
#        ... (non-platform) have different Team IDs
#      Hardening only exists to enable notarization, which a self-signed build can never obtain, so
#      it is turned off here rather than defeated with disable-library-validation — that entitlement
#      would weaken the real Developer ID release too.
#
#   2. THE OUTPUT DIRECTORY MUST NOT BE INSIDE ICLOUD.
#      This repo lives under a synced Desktop. The file provider stamps `com.apple.FinderInfo` and
#      `com.apple.fileprovider.fpfs#P` onto bundle DIRECTORIES as it syncs, and `codesign` rejects
#      them outright ("resource fork, Finder information, or similar detritus not allowed"). It
#      re-applies them faster than a pre-signing sweep can strip them, so the only reliable fix is
#      to build somewhere unsynced. scripts/after-pack.cjs still clears what it can.
#
# Release builds are unaffected: they use dist:mac, a Developer ID identity, and stay hardened.
set -euo pipefail
cd "$(dirname "$0")/.."

ARCH="${1:-arm64}"
OUT="${BIMAX_LOCAL_BUILD_DIR:-/private/tmp/bimax-build/release}"
ENGINE="${BIMAX_ENGINE_LOCAL_OVERRIDE:-}"

case "$ARCH" in arm64) target=darwin-arm64 ;; x64) target=darwin-x64 ;; *) echo "usage: $0 [arm64|x64]" >&2; exit 1 ;; esac
case "$OUT" in "$PWD"/*|"$HOME"/Desktop/*|"$HOME"/Documents/*) echo "error: output dir is inside the synced tree: $OUT" >&2; exit 1 ;; esac

echo "→ renderer + main"
npx electron-vite build

echo "→ engine"
#
# A LOCAL build compiles the engine from the CLI source in this repo. It does not download one.
#
# This is the honest form of the dependency. Bimax is two shipped products — the `bimax` CLI at the
# repo root and this desktop app — and the app embeds the CLI as its engine. For a RELEASE that
# engine must be a published, digest-pinned artifact, which is what engine.lock.json and
# resolve-engine-artifact.mjs exist to enforce. For a build you intend to run on this machine,
# fetching a tarball of the same source that is already checked out next door buys nothing and adds
# a network dependency to `npm run build`.
#
# It also removes a foot-gun that cost a build on 2026-08-15: engine.lock.json pins v1.1.0 of
# Sid7on1/bimax-releases, and that release was never published (the repo stops at v1.0.8, which
# additionally uses the older per-platform tarball scheme rather than the manifest scheme the lock
# expects). The download 404s, and because a 404 from GitHub is indistinguishable between "asset
# missing" and "no permission", it reads as an auth failure and sends you looking for a token you
# do not need.
#
# Release builds are untouched: they set BIMAX_RELEASE_BUILD=1, and resolve-engine-artifact.mjs
# refuses an override outright in that mode.
if [ -z "$ENGINE" ]; then
  ENGINE="$(cd "$(dirname "$0")/../.." && pwd)/.engine-local/bimax-engine"
  mkdir -p "$(dirname "$ENGINE")"
  echo "   compiling engine from CLI source (src/index.ts)"
  (
    cd "$(dirname "$0")/../.."
    # --format=cjs is required: the engine is CommonJS and Bun's default ESM bundling mangles it.
    # Mirrors scripts/lib-build.sh, which is what produces the released engine.
    bun build src/index.ts --compile --format=cjs --target="bun-$target" --outfile "$ENGINE"
    # Bun leaves 60MB `.<hash>.bun-build` scratch blobs at cwd when --compile is used.
    rm -f .*.bun-build 2>/dev/null || true
  )
fi
BIMAX_ENGINE_LOCAL_OVERRIDE="$ENGINE" bash scripts/prepare-engine.sh "$target"

# NOTE: prepare-native.sh begins with `rm -rf native-service` and rebuilds every native component
# from Swift source. It is deliberately NOT run here — as of 2026-08-15 the sources for
# BimaxCuBridge are missing from the working tree, so that script destroys the staged binaries and
# then fails. Stage native-service yourself (see docs) and this build consumes it.
for required in BimaxCuService.xpc bimax-cu-bridge bimax-desktop-helper; do
  [ -e "native-service/$required" ] || { echo "error: native-service/$required is missing — stage it before building" >&2; exit 1; }
done
echo "→ mac capability provider (the only native component built from TypeScript)"
bun build --compile --target="bun-$target" src/capabilities/mac/provider.entry.ts --outfile native-service/bimax-mac-capability

echo "→ package (unhardened, outside iCloud)"
rm -rf "$OUT"
npx electron-builder --mac "--$ARCH" \
  -c.directories.output="$OUT" \
  -c.mac.hardenedRuntime=false

APP="$OUT/mac-$ARCH/Bimax.app"
echo "→ verify"
codesign --verify --deep --strict "$APP"
node ../scripts/verify-desktop-package.mjs "$APP" "$ARCH"
echo "Built → $APP"
