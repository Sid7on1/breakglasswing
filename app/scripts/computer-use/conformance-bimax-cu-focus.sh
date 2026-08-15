#!/usr/bin/env bash
# Proves every advertised delivery policy against a real workspace.
#
# Offline tests drive a fake focus controller, and a fake always activates. Real activation is
# asynchronous, can be refused, and can report success while focus never moves. This run is what
# populates `verifiedDeliveryPolicies` in the handshake — that list is maintained by evidence, not
# assumption, and `focusLease` is derived from it.
#
# It builds and launches BimaxCuFixture.app and deliberately brings it to the front and back again.
# Never point --self-test-focus at one of your own applications: it would move your focus around
# and press whatever the fixture probes happen to match.
#
# Your focus will move during this run. It is handed back to whatever was in front beforehand.
#
# Do not use the machine while it runs. Switching windows mid-run changes the thing being measured,
# and the run reports `status: "disturbed"` and exits non-zero rather than pretending otherwise.
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
"$bin_dir/bimax-cu-service" --self-test-focus ai.bimax.cu.fixture
