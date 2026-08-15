#!/usr/bin/env bash
# Warm-path AX latency measurement against the §24.2 budgets in the master refactor plan.
#
# Read-only: observes an already-running application and never mutates, launches, activates, or
# types. Budgets are asserted, so a regression exits non-zero rather than just printing numbers.
#
#   scripts/bench-bimax-cu-latency.sh [bundle-id] [iterations]
#
# Accessibility permission is required; a CLI inherits the grant of the terminal that launched it.
set -euo pipefail
cd "$(dirname "$0")/../../.."

bundle="${1:-com.apple.TextEdit}"
iterations="${2:-20}"

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

exec "$bin_dir/bimax-cu-service" --self-test-latency "$bundle" "$iterations"
