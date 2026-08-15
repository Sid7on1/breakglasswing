#!/usr/bin/env bash
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

os="${1:-darwin}"
arch="${2:-$(uname -m)}"
destination="${3:-tui/embed}"
mkdir -p "$destination"

binary_out="$destination/bimax-cu-service"
bridge_out="$destination/bimax-cu-bridge"
bundle_out="$destination/BimaxCuService.xpc"

if [ "$os" != "darwin" ]; then
  printf '#!/usr/bin/env sh\nexit 1\n' > "$binary_out"
  printf '#!/usr/bin/env sh\nexit 1\n' > "$bridge_out"
  chmod 0755 "$binary_out"
  chmod 0755 "$bridge_out"
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || { echo "error: Bimax-Cu Service must be built on macOS" >&2; exit 1; }
command -v swift >/dev/null || { echo "error: Swift is required to build Bimax-Cu Service" >&2; exit 1; }

case "$arch" in
  arm64) swift_arch=arm64 ;;
  amd64|x64|x86_64) swift_arch=x86_64 ;;
  *) echo "error: unsupported Bimax-Cu architecture: $arch" >&2; exit 1 ;;
esac

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
  -c release --product bimax-cu-service --arch "$swift_arch"
env CLANG_MODULE_CACHE_PATH="$cache" SWIFT_MODULECACHE_PATH="$cache" \
  ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" \
  -c release --product bimax-cu-bridge --arch "$swift_arch"
bin_dir="$(env ${sdk[@]+"${sdk[@]}"} swift build --disable-sandbox --package-path "$package" -c release --show-bin-path --arch "$swift_arch")"
cp "$bin_dir/bimax-cu-service" "$binary_out"
cp "$bin_dir/bimax-cu-bridge" "$bridge_out"
chmod 0755 "$binary_out"
chmod 0755 "$bridge_out"

rm -rf "$bundle_out"
mkdir -p "$bundle_out/Contents/MacOS"
cp "$binary_out" "$bundle_out/Contents/MacOS/bimax-cu-service"
cp "$package/Resources/Info.plist" "$bundle_out/Contents/Info.plist"
chmod 0755 "$bundle_out/Contents/MacOS/bimax-cu-service"
