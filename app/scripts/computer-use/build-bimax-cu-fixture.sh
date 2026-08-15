#!/usr/bin/env bash
# Builds BimaxCuFixture.app — the §23.2 fixture application.
#
# It exists so the advertised semantic action catalog can be proven against a real Accessibility
# server without pressing buttons or overwriting text in the user's own applications. Every control
# is inert and mutates only its own state.
set -euo pipefail
cd "$(dirname "$0")/../../.."

destination="${1:-$(mktemp -d)/BimaxCuFixture.app}"
fixture_kind="${2:-target}"
plist="FixtureInfo.plist"
if [ "$fixture_kind" = "bystander" ]; then
  plist="BystanderInfo.plist"
elif [ "$fixture_kind" != "target" ]; then
  echo "usage: $0 [destination] [target|bystander]" >&2
  exit 64
fi

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
  -c release --product bimax-cu-fixture >/dev/null
bin_dir="$(env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" -c release --show-bin-path)"

rm -rf "$destination"
mkdir -p "$destination/Contents/MacOS"
cp "$bin_dir/bimax-cu-fixture" "$destination/Contents/MacOS/bimax-cu-fixture"
cp "$package/Resources/$plist" "$destination/Contents/Info.plist"
chmod 0755 "$destination/Contents/MacOS/bimax-cu-fixture"
codesign --force --sign - "$destination" >/dev/null 2>&1 || true
echo "$destination"
