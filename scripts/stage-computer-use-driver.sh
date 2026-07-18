#!/usr/bin/env bash
# Stage the pinned native driver that powers Bimax Computer Use. The upstream implementation is
# MIT-licensed trycua/cua (driver 0.8.3); it is embedded as a private sidecar inside the single Bimax
# executable and is never exposed as a Cua-branded user command.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="0.8.3"
TAG="cua-driver-rs-v${VERSION}"
os="${1:-}"
arch="${2:-}"

if [ -z "$os" ]; then
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "error: Bimax Computer Use is not available on $(uname -s)" >&2; exit 1 ;;
  esac
fi
if [ -z "$arch" ]; then
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) echo "error: unsupported Bimax Computer Use architecture: $(uname -m)" >&2; exit 1 ;;
  esac
fi

case "${os}-${arch}" in
  darwin-arm64|darwin-x64)
    asset="cua-driver-rs-${VERSION}-darwin-universal-binary.tar.gz"
    expected="a2a29f3ccbd45989819df639d60fa68ac6f28b844f74d7d2b0a1495e4359c6a1"
    ;;
  linux-x64)
    asset="cua-driver-rs-${VERSION}-linux-x86_64-binary.tar.gz"
    expected="42bd2cfb2df60b9d635eb52aaf389ff816e6a7ff45c843e815688a8d96feda2f"
    ;;
  linux-arm64)
    asset="cua-driver-rs-${VERSION}-linux-arm64-binary.tar.gz"
    expected="910456505b927966867f668e37195b130364dcc50f566d4301cd9c3760da9cd3"
    ;;
  *) echo "error: unsupported Bimax Computer Use target: ${os}-${arch}" >&2; exit 1 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
archive="$tmp/$asset"

if [ -n "${BIMAX_COMPUTER_USE_ARCHIVE:-}" ]; then
  [ -f "$BIMAX_COMPUTER_USE_ARCHIVE" ] || { echo "error: BIMAX_COMPUTER_USE_ARCHIVE not found" >&2; exit 1; }
  cp "$BIMAX_COMPUTER_USE_ARCHIVE" "$archive"
else
  command -v curl >/dev/null || { echo "error: curl is required to stage Bimax Computer Use" >&2; exit 1; }
  url="https://github.com/trycua/cua/releases/download/${TAG}/${asset}"
  echo "   Bimax Computer Use ${VERSION} → ${os}-${arch}"
  curl -fL --retry 3 --silent --show-error -o "$archive" "$url"
fi

if command -v shasum >/dev/null; then
  actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
else
  actual="$(sha256sum "$archive" | awk '{print $1}')"
fi
[ "$actual" = "$expected" ] || {
  echo "error: Bimax Computer Use checksum mismatch for $asset" >&2
  echo "expected $expected" >&2
  echo "actual   $actual" >&2
  exit 1
}

mkdir -p "$tmp/extract" tui/embed
tar -xzf "$archive" -C "$tmp/extract" cua-driver
[ -f "$tmp/extract/cua-driver" ] || { echo "error: driver archive is missing its binary" >&2; exit 1; }
cp "$tmp/extract/cua-driver" tui/embed/bimax-computer-use
chmod 0755 tui/embed/bimax-computer-use
