#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "phase4 gate: FAIL: $*" >&2; exit 1; }

if find src/computer -type f -print -quit 2>/dev/null | grep -q .; then
  fail "Terminal still owns files under src/computer"
fi
for old in scripts/benchmark-cu-baseline.ts scripts/smoke-computer-use.ts scripts/stage-bimax-cu-service.sh; do
  [ ! -e "$old" ] || fail "Desktop-owned artifact remains at $old"
done

if rg -n -i \
  'computer[ _-]?use|ComputerTool|COMPUTER_CONTROL|BIMAX_(CU|COMPUTER|DESKTOP|HOST_PROFILE)|ScreenCaptureKit|CGEvent|AXSemantic|native desktop' \
  src tui \
  --glob '!src/__tests__/**' \
  --glob '!**/*.test.ts' \
  --glob '!tui/*_test.go' \
  --glob '!src/protocol/schema/**'; then
  fail "Terminal implementation still contains a Desktop capability owner label"
fi

npm run build
npm run test:ci -- --runInBand
npm run check:protocol-mirror
npm --prefix app run typecheck
npm --prefix app run build
npm --prefix app run test:mac:unit -- --runInBand
(cd tui && GOCACHE=/tmp/bimax-phase4-go-cache go test ./...)
bash app/scripts/computer-use/test-bimax-cu-native.sh

arch="$(uname -m)"
case "$arch" in
  arm64) target=bun-darwin-arm64 ;;
  x86_64) target=bun-darwin-x64 ;;
  *) fail "unsupported local architecture $arch" ;;
esac
bun build --compile --target="$target" app/src/capabilities/mac/provider.entry.ts \
  --outfile /tmp/bimax-mac-capability-phase4
node app/scripts/verify-mac-provider.mjs /tmp/bimax-mac-capability-phase4

echo "phase4 gate: PASS Terminal is generic and Desktop owns the local macOS capability provider"
