#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
package="$root/native/BimaxComputerUseKit"
cache="$(mktemp -d)"
trap 'rm -rf "$cache"' EXIT
retained_sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
sdk=()

if [ "$(xcode-select -p 2>/dev/null || true)" = "/Library/Developer/CommandLineTools" ] && [ -d "$retained_sdk" ]; then
  sdk=(SDKROOT="$retained_sdk")
fi

env CLANG_MODULE_CACHE_PATH="$cache" SWIFT_MODULECACHE_PATH="$cache" \
  ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" \
  --product bimax-cu-service >/dev/null
bin_dir="$(env CLANG_MODULE_CACHE_PATH="$cache" SWIFT_MODULECACHE_PATH="$cache" \
  ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" --show-bin-path)"
"$bin_dir/bimax-cu-service" --self-test-real-app-matrix "${1:-12}" "${2:-4}" --launch-standard-apps
