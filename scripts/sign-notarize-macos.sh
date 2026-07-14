#!/usr/bin/env bash
# Sign and notarize the two macOS release binaries produced by release.sh, then rebuild their
# tarballs and the release checksum manifest. The certificate is expected to be installed in the
# caller's keychain (the GitHub release workflow uses an ephemeral keychain).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${BIMAX_MACOS_SIGN_IDENTITY:?set BIMAX_MACOS_SIGN_IDENTITY to a Developer ID Application identity}"
: "${APPLE_NOTARY_KEY_PATH:?set APPLE_NOTARY_KEY_PATH to the App Store Connect API .p8 file}"
: "${APPLE_NOTARY_KEY_ID:?set APPLE_NOTARY_KEY_ID}"
: "${APPLE_NOTARY_ISSUER_ID:?set APPLE_NOTARY_ISSUER_ID}"

for arch in arm64 x64; do
  binary="build/bimax-darwin-${arch}"
  archive="${binary}.tar.gz"
  submission="build/bimax-darwin-${arch}-notarization.zip"
  [ -x "$binary" ] || { echo "error: missing executable $binary" >&2; exit 1; }

  echo "Signing bimax-darwin-${arch}"
  codesign --force --options runtime --timestamp --sign "$BIMAX_MACOS_SIGN_IDENTITY" "$binary"
  codesign --verify --strict --verbose=2 "$binary"

  # notarytool accepts ZIP, DMG, or signed PKG—not tar.gz. Standalone executables receive an
  # online ticket from Apple but cannot be stapled, so the signed executable remains unchanged.
  /usr/bin/ditto -c -k --keepParent "$binary" "$submission"
  result="$(xcrun notarytool submit "$submission" --key "$APPLE_NOTARY_KEY_PATH" --key-id "$APPLE_NOTARY_KEY_ID" --issuer "$APPLE_NOTARY_ISSUER_ID" --wait --output-format json)"
  printf '%s\n' "$result"
  status="$(printf '%s' "$result" | node -e "process.stdin.setEncoding('utf8');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(JSON.parse(s).status||''))")"
  [ "$status" = "Accepted" ] || { echo "error: Apple notarization status is $status" >&2; exit 1; }
  rm -f "$submission"

  tar -C build -czf "$archive" "$(basename "$binary")"
done

(
  cd build
  : > SHA256SUMS
  for archive in bimax-darwin-arm64.tar.gz bimax-darwin-x64.tar.gz bimax-linux-x64.tar.gz bimax-linux-arm64.tar.gz; do
    [ -f "$archive" ] || { echo "error: missing release archive $archive" >&2; exit 1; }
    shasum -a 256 "$archive" >> SHA256SUMS
  done
  shasum -a 256 -c SHA256SUMS
)

echo "macOS binaries signed, accepted by Apple's notary service, and repackaged."
