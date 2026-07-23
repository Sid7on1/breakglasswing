#!/usr/bin/env bash
# Build the in-repo macOS ScreenCaptureKit PiP helper that is embedded beside the engine and native
# action driver. Non-macOS releases embed a tiny inert placeholder so the common Go embed graph stays
# deterministic; the runtime never launches it outside macOS.
set -euo pipefail
cd "$(dirname "$0")/.."

os="${1:-}"
arch="${2:-}"
if [ -z "$os" ]; then
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    *) os=linux ;;
  esac
fi

mkdir -p tui/embed
out="tui/embed/bimax-live-pip"

if [ "$os" != "darwin" ]; then
  printf '#!/usr/bin/env sh\nexit 1\n' > "$out"
  chmod 0755 "$out"
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || {
  echo "error: macOS live PiP must be built on macOS with the Apple SDK" >&2
  exit 1
}
command -v xcrun >/dev/null || { echo "error: xcrun is required to build native live PiP" >&2; exit 1; }

target=()
case "$arch" in
  arm64) target=(-target arm64-apple-macos12.3) ;;
  amd64|x64) target=(-target x86_64-apple-macos12.3) ;;
  "") target=(-target "$(uname -m)-apple-macos12.3") ;;
  *) echo "error: unsupported macOS live PiP architecture: $arch" >&2; exit 1 ;;
esac

sdk=()
clt_sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [ "$(xcode-select -p 2>/dev/null || true)" = "/Library/Developer/CommandLineTools" ] && [ -d "$clt_sdk" ]; then
  # Some CLT updates leave the newest SDK one patch ahead of swiftc. The retained 15.4 SDK has the
  # same ScreenCaptureKit API surface we use and supports the macOS 12.3 deployment target.
  sdk=(-sdk "$clt_sdk")
fi
module_cache="$(mktemp -d)"
trap 'rm -rf "$module_cache"' EXIT

env CLANG_MODULE_CACHE_PATH="$module_cache" SWIFT_MODULECACHE_PATH="$module_cache" \
  xcrun swiftc -O -parse-as-library "${sdk[@]}" "${target[@]}" \
  -o "$out" native/BimaxLivePip.swift \
  -framework AppKit -framework AVFoundation -framework ScreenCaptureKit
chmod 0755 "$out"
