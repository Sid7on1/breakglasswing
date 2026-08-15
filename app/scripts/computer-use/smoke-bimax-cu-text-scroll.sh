#!/usr/bin/env bash
# Live text/scroll validation for the Bimax-Cu native service.
#
# Drives the shipping AXSemanticActionEngine selection and scroll paths against a REAL running
# application: observe an exact window, take an element ref, then perform caret placement, range
# selection, exact-text selection, and a page scroll.
#
# It never launches, activates, raises, quits, or types into an application. The target must
# already be running with a window. A skipped run exits non-zero: a skip is not a pass.
#
#   scripts/smoke-bimax-cu-text-scroll.sh [bundle-id]
#
# Accessibility permission is required. A CLI inherits the grant of the terminal that launched it,
# so run this from a terminal that already holds Accessibility access.
set -euo pipefail
cd "$(dirname "$0")/../../.."

bundle="${1:-com.apple.TextEdit}"

cache="$(mktemp -d)"
trap 'rm -rf "$cache"' EXIT
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

exec "$bin_dir/bimax-cu-service" --self-test-text-scroll "$bundle"
