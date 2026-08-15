#!/usr/bin/env bash
# Phase 5 local gate — the frontend reset, end to end.
#
# It runs the checks that can actually detect the requested outcome: the Terminal boundary is still
# free of Computer Use ownership, both products typecheck and build, every Desktop capability suite
# and the renderer view-model suites pass, the protocol mirror is in sync, the macOS provider still
# answers over stdio, and the renderer journeys pass WITH their mutation pass — a journey that
# cannot fail against a broken end state does not count.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "phase5 gate: FAIL: $*" >&2; exit 1; }

# The two-product boundary is a precondition, not a side effect: a frontend that reintroduced a
# Computer Use owner into Terminal would pass every UI journey.
if find src/computer -type f -print -quit 2>/dev/null | grep -q .; then
  fail "Terminal still owns files under src/computer"
fi
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
(cd tui && GOCACHE=/tmp/bimax-phase5-go-cache go test ./...)

arch="$(uname -m)"
case "$arch" in
  arm64) target=bun-darwin-arm64 ;;
  x86_64) target=bun-darwin-x64 ;;
  *) fail "unsupported local architecture $arch" ;;
esac
bun build --compile --target="$target" app/src/capabilities/mac/provider.entry.ts \
  --outfile /tmp/bimax-mac-capability-phase5
node app/scripts/verify-mac-provider.mjs /tmp/bimax-mac-capability-phase5

# Built-renderer journeys at every supported window size, plus the mutation pass.
node app/scripts/ui/journeys.mjs --mutate

# Production boundary: built Electron main + preload IPC + renderer + supervised engine fixture +
# the actual provider stdio protocol. Native-world evidence is deterministic and input-free.
BIMAX_PHASE5_PROVIDER=/tmp/bimax-mac-capability-phase5 node app/scripts/ui/electron-journey.mjs

echo "phase5 gate: PASS the task workspace, production IPC/provider boundary and takeover control are graded on end state"
