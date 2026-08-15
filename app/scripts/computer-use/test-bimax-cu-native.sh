#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."

cache="$(mktemp -d)"
trap 'rm -rf "$cache"' EXIT
sdk=()
retained_sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [ "$(xcode-select -p 2>/dev/null || true)" = "/Library/Developer/CommandLineTools" ] && [ -d "$retained_sdk" ]; then
  sdk=(SDKROOT="$retained_sdk")
fi

env CLANG_MODULE_CACHE_PATH="$cache" SWIFT_MODULECACHE_PATH="$cache" \
  ${sdk[@]+"${sdk[@]}"} swift run --disable-sandbox \
  --package-path native/BimaxComputerUseKit bimax-cu-tests
