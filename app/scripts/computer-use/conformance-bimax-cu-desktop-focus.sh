#!/usr/bin/env bash
# End-to-end foreground lease conformance through the app-owned Electron activation broker.
set -euo pipefail
cd "$(dirname "$0")/../../.."

workdir="$(mktemp -d)"
trap 'pkill -f "$workdir/BimaxCuFixture.app" >/dev/null 2>&1 || true; rm -rf "$workdir"' EXIT

fixture="$workdir/BimaxCuFixture.app"
app/scripts/computer-use/build-bimax-cu-fixture.sh "$fixture" >/dev/null

cache="$(mktemp -d)"
trap 'pkill -f "$workdir/BimaxCuFixture.app" >/dev/null 2>&1 || true; rm -rf "$workdir" "$cache"' EXIT
sdk=()
retained_sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [ "$(xcode-select -p 2>/dev/null || true)" = "/Library/Developer/CommandLineTools" ] && [ -d "$retained_sdk" ]; then
  sdk=(SDKROOT="$retained_sdk")
fi
package="native/BimaxComputerUseKit"
env CLANG_MODULE_CACHE_PATH="$cache" SWIFT_MODULECACHE_PATH="$cache" \
  ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" \
  -c release --product bimax-cu-service >/dev/null
bin_dir="$(env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" -c release --show-bin-path)"

npm --prefix app run build:focus-harness >/dev/null
BIMAX_CU_FIXTURE_APP="$fixture" BIMAX_CU_SERVICE_BINARY="$bin_dir/bimax-cu-service" \
  app/node_modules/.bin/electron app/out-focus/main/main.js
