#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[1/8] Desktop type and production bundle"
npm --prefix app run typecheck
npm --prefix app run build

echo "[2/8] Phase 7 release-fact/privacy tests"
npm --prefix app run test:phase7

echo "[3/8] manual-alpha mutations and rollback"
npm --prefix app run test:phase7:manual-alpha

echo "[4/8] complete Desktop Mac capability regression"
npm --prefix app run test:mac:unit

echo "[5/8] packaged ownership/component gate"
npm run verify:desktop-package -- app/release/mac-arm64/Bimax.app arm64

echo "[6/8] exact DMG and app-tree manifest"
node app/scripts/verify-manual-alpha-release.mjs \
  app/release/Bimax-manual-alpha-manifest.json \
  app/release \
  app/release/mac-arm64/Bimax.app

echo "[7/8] candidate is truthfully manual alpha"
signature="$(codesign --display --verbose=4 app/release/mac-arm64/Bimax.app 2>&1)"
grep -Eq '^Signature=adhoc$|flags=.*adhoc' <<<"$signature" || { echo "candidate signature is not the documented ad-hoc state" >&2; exit 1; }
if grep -q '^Authority=Developer ID Application:' <<<"$signature"; then echo "manual-alpha candidate unexpectedly has Developer ID" >&2; exit 1; fi

echo "[8/8] stable path fails closed without credentials"
if env -u CSC_LINK -u CSC_KEY_PASSWORD -u APPLE_NOTARY_KEY_PATH -u APPLE_NOTARY_KEY_ID -u APPLE_NOTARY_ISSUER_ID \
  bash app/scripts/release-stable-macos.sh arm64 >/dev/null 2>&1; then
  echo "stable script did not refuse absent credentials" >&2
  exit 1
fi

echo "phase7 local manual-alpha gate: PASS"
echo "stable/public/fresh-Mac rows: TARGET — see docs/product-reset/18_PHASE7_RELEASE_HARDENING_RECORD.md"
