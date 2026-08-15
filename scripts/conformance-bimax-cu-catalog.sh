#!/usr/bin/env bash
# Proves every advertised semantic action against a real Accessibility server.
#
# The service must not advertise a capability it has never performed. Offline tests use synthetic
# nodes and have passed while the real path was inert. This run is what populates
# `verifiedSemanticActions` in the handshake — that list is maintained by evidence, not assumption.
#
# It builds and launches BimaxCuFixture.app, whose controls are inert by construction, drives the
# whole catalog against it, and quits it. Never point --self-test-catalog at one of your own
# applications: it would press that application's real buttons.
set -euo pipefail
cd "$(dirname "$0")/.."

workdir="$(mktemp -d)"
trap 'pkill -f "$workdir/BimaxCuFixture.app" >/dev/null 2>&1 || true; rm -rf "$workdir"' EXIT

app="$workdir/BimaxCuFixture.app"
scripts/build-bimax-cu-fixture.sh "$app" >/dev/null

sdk=()
retained_sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [ "$(xcode-select -p 2>/dev/null || true)" = "/Library/Developer/CommandLineTools" ] && [ -d "$retained_sdk" ]; then
  sdk=(SDKROOT="$retained_sdk")
fi
package="native/BimaxComputerUseKit"
env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" \
  -c release --product bimax-cu-service >/dev/null
bin_dir="$(env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" -c release --show-bin-path)"

open "$app" --args --title-ui-element-fixture
sleep 3
"$bin_dir/bimax-cu-service" --self-test-catalog ai.bimax.cu.fixture
