#!/usr/bin/env bash
# Grades M02's background semantic end state with two inert, purpose-built AppKit bundles.
set -euo pipefail
cd "$(dirname "$0")/../../.."

workdir="$(mktemp -d)"
trap 'pkill -f "$workdir/BimaxCuFixture.app" >/dev/null 2>&1 || true; pkill -f "$workdir/BimaxCuBystander.app" >/dev/null 2>&1 || true; rm -rf "$workdir"' EXIT

target="$workdir/BimaxCuFixture.app"
bystander="$workdir/BimaxCuBystander.app"
reminder_state="$workdir/reminders.json"
typing_state="$workdir/typing.txt"
app/scripts/computer-use/build-bimax-cu-fixture.sh "$target" target >/dev/null
app/scripts/computer-use/build-bimax-cu-fixture.sh "$bystander" bystander >/dev/null

sdk=()
retained_sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [ "$(xcode-select -p 2>/dev/null || true)" = "/Library/Developer/CommandLineTools" ] && [ -d "$retained_sdk" ]; then
  sdk=(SDKROOT="$retained_sdk")
fi
package="native/BimaxComputerUseKit"
env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" \
  -c release --product bimax-cu-service >/dev/null
bin_dir="$(env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" -c release --show-bin-path)"

open -g "$target" --args --m02-fixture --m02-state "$reminder_state"
sleep 2
open "$bystander" --args --bystander-fixture --typing-state "$typing_state"
sleep 2
"$bin_dir/bimax-cu-service" --self-test-m02 \
  ai.bimax.cu.fixture ai.bimax.cu.bystander "$reminder_state" "$typing_state"
