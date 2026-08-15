#!/usr/bin/env bash
# Proves the mutating workspace operations the handshake advertises.
#
# The offline suite drives AppWorkspace through a fake Launch Services seam: it proves the policy
# and proves nothing about macOS. This run resolves and starts the inert fixture through the whole
# service path and checks that the process really started while the human's foreground did not
# move. It populates `verifiedWorkspaceOperations`, which is maintained by evidence, not assumption.
#
# Unlike the catalog run this must NOT pre-launch the fixture: a launch that already happened
# cannot be observed. The harness terminates the fixture it started.
set -euo pipefail
cd "$(dirname "$0")/../../.."

# Launch Services does not index bundles under /var/folders, so a bundle-id lookup cannot resolve
# a fixture built into a temp directory. The fixture is therefore staged in ~/Applications for the
# duration of the run and removed again — including on failure.
app="$HOME/Applications/BimaxCuFixture.app"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
cleanup() {
  pkill -f "$app/Contents/MacOS/bimax-cu-fixture" >/dev/null 2>&1 || true
  [ -x "$lsregister" ] && "$lsregister" -u "$app" >/dev/null 2>&1 || true
  rm -rf "$app"
}
trap cleanup EXIT

if [ -e "$app" ]; then
  echo "refusing to overwrite an existing $app" >&2
  exit 1
fi
mkdir -p "$HOME/Applications"
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

# Register the staged bundle so a bundle-id lookup can find it without the harness ever handing
# the service a filesystem path.
if [ -x "$lsregister" ]; then
  "$lsregister" -f "$app" >/dev/null 2>&1 || true
  sleep 1
fi

"$bin_dir/bimax-cu-service" --self-test-app-workspace ai.bimax.cu.fixture
