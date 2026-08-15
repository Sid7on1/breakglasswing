#!/usr/bin/env bash
# Proves the bounded ScreenCaptureKit pool receives a complete frame from the inert fixture.
set -euo pipefail
cd "$(dirname "$0")/../../.."

workdir="$(mktemp -d)"
trap 'pkill -f "$workdir/BimaxCuFixture.app" >/dev/null 2>&1 || true; rm -rf "$workdir"' EXIT

app="$workdir/BimaxCuFixture.app"
app/scripts/computer-use/build-bimax-cu-fixture.sh "$app" >/dev/null

sdk=()
retained_sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [ "$(xcode-select -p 2>/dev/null || true)" = "/Library/Developer/CommandLineTools" ] && [ -d "$retained_sdk" ]; then
  sdk=(SDKROOT="$retained_sdk")
fi
package="native/BimaxComputerUseKit"
env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" \
  -c release --product bimax-cu-service >/dev/null
bin_dir="$(env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" -c release --show-bin-path)"

open "$app"
sleep 3
"$bin_dir/bimax-cu-service" --self-test-capture ai.bimax.cu.fixture
