#!/usr/bin/env bash
# build-target-range.sh — build the synthetic click-accuracy range → build/BimaxTargetRange.app
#
# A real .app bundle, not a bare executable: the range has to be an ordinary activatable macOS
# application with its own bundle identity, because that is what the runtime's open/focus/AX path
# actually targets. A loose binary would exercise a different (and easier) code path than the one
# under test.
#
# This is a TEST fixture — it is never staged into tui/embed and never ships in a release.
set -euo pipefail
cd "$(dirname "$0")/../../.."

[ "$(uname -s)" = "Darwin" ] || { echo "error: the target range is macOS-only" >&2; exit 1; }
command -v xcrun >/dev/null || { echo "error: xcrun is required to build the target range" >&2; exit 1; }

app="build/BimaxTargetRange.app"
macos="$app/Contents/MacOS"
rm -rf "$app"
mkdir -p "$macos"

# Mirrors the SDK pin in stage-live-pip.sh: some Command Line Tools updates leave the newest SDK a
# patch ahead of swiftc, which fails the build for reasons unrelated to this source.
sdk=()
clt_sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
if [ "$(xcode-select -p 2>/dev/null || true)" = "/Library/Developer/CommandLineTools" ] && [ -d "$clt_sdk" ]; then
  sdk=(-sdk "$clt_sdk")
fi

module_cache="$(mktemp -d)"
trap 'rm -rf "$module_cache"' EXIT

# Guard empty-array expansion: macOS's bash 3.2 treats "${sdk[@]}" as unbound under `set -u`.
env CLANG_MODULE_CACHE_PATH="$module_cache" SWIFT_MODULECACHE_PATH="$module_cache" \
  xcrun swiftc -O -parse-as-library ${sdk[@]+"${sdk[@]}"} \
  -target "$(uname -m)-apple-macos12.3" \
  -o "$macos/BimaxTargetRange" native/BimaxTargetRange.swift \
  -framework AppKit

cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>BimaxTargetRange</string>
  <key>CFBundleIdentifier</key><string>dev.bimax.targetrange</string>
  <key>CFBundleName</key><string>Bimax Target Range</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.3</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

# Ad-hoc signature. Unsigned bundles are refused AX registration on recent macOS, which would show
# up as an empty element tree and read as a targeting bug rather than a fixture problem.
# xattr -cr first: a quarantine or Finder-info xattr makes codesign reject the bundle outright
# ("resource fork, Finder information, or similar detritus not allowed").
xattr -cr "$app" 2>/dev/null || true
codesign --force --sign - "$app" >/dev/null 2>&1 || echo "warning: ad-hoc codesign failed; AX may be unavailable" >&2

# Register with Launch Services so the runtime's open/focus path can resolve "Bimax Target Range"
# by name and bundle id. Without this the range is only reachable as a bare process, which is a
# different targeting path than the one under test.
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$lsregister" ] && "$lsregister" -f "$PWD/$app" >/dev/null 2>&1 || true

echo "Done → $app"
