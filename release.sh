#!/usr/bin/env bash
# release.sh — build the full BiMax release matrix: ONE self-contained binary per platform
# (Go TUI with the bun-compiled Node engine baked in via go:embed — no Node, no Bun, no
# node_modules on the host), tarballed with SHA256SUMS, ready to attach to a GitHub release.
# Shared build steps live in scripts/lib-build.sh; the quick host build is build-release.sh.
#
#   ./release.sh                 # all targets
#   ./release.sh darwin-arm64    # one target
#   BIMAX_VERSION=1.2.0 ./release.sh
#
# Requirements (build machine only): bun ≥ 1.1, go ≥ 1.22.
set -euo pipefail
cd "$(dirname "$0")"
source scripts/lib-build.sh

command -v bun >/dev/null || { echo "error: bun is required (https://bun.sh)"; exit 1; }
command -v go  >/dev/null || { echo "error: go is required (https://go.dev)"; exit 1; }

VERSION="$(bimax_version)"
[ $# -eq 0 ] && set -- darwin-arm64 darwin-x64 linux-x64 linux-arm64

bimax_sweep_bunbuild
trap bimax_sweep_bunbuild EXIT
mkdir -p build
rm -f build/SHA256SUMS

for target in "$@"; do
  os="${target%%-*}"
  arch="${target##*-}"
  goarch="$arch"; [ "$arch" = "x64" ] && goarch=amd64
  out="build/bimax-${os}-${arch}"

  echo "── ${target} ──────────────────────────────────────"
  build_bimax "$os" "$goarch" "$out" release "bun-${os}-${arch}"

  # macOS code signing + hardened runtime for the CLI binary. Requires a Developer ID Application
  # cert in the keychain and MACOS_SIGN_IDENTITY set (e.g. "Developer ID Application: Name (TEAMID)").
  # Skipped with a clear warning when unset, so a keyless CI build still produces (unsigned) artifacts.
  if [ "$os" = "darwin" ]; then
    if [ -n "${MACOS_SIGN_IDENTITY:-}" ] && command -v codesign >/dev/null; then
      echo "   signing ${out} (Developer ID + hardened runtime)…"
      codesign --force --options runtime --timestamp \
        --sign "$MACOS_SIGN_IDENTITY" "$out"
      codesign --verify --strict --verbose=2 "$out" || { echo "error: codesign verification failed"; exit 1; }
    else
      echo "   ⚠ MACOS_SIGN_IDENTITY unset — shipping UNSIGNED darwin binary (see docs/SECURITY_INSTALL.md)."
    fi
  fi

  tar -C build -czf "${out}.tar.gz" "$(basename "$out")"
  ( cd build && shasum -a 256 "$(basename "$out").tar.gz" >> SHA256SUMS )
  echo "   → ${out}.tar.gz ($(du -h "${out}.tar.gz" | cut -f1))"
done

# Independent signature over the checksum manifest. The installer pins the PUBLIC key (see
# install.sh#MINISIGN_PUBKEY), so this signature — not the manifest's mere co-location with the
# artifacts — is the trust root. Requires the minisign SECRET key; skipped (with a warning) otherwise.
if [ -n "${BIMAX_MINISIGN_SECKEY:-}" ] && command -v minisign >/dev/null; then
  echo "signing SHA256SUMS with minisign…"
  minisign -Sm build/SHA256SUMS -s "$BIMAX_MINISIGN_SECKEY" -x build/SHA256SUMS.minisig
  echo "   → build/SHA256SUMS.minisig"
else
  echo "⚠ BIMAX_MINISIGN_SECKEY unset — SHA256SUMS is NOT signed (checksum-only trust). See docs/SECURITY_INSTALL.md."
fi

echo ""
echo "Release ${VERSION} built:"
cat build/SHA256SUMS
echo ""
echo "Attach build/*.tar.gz + build/SHA256SUMS (+ SHA256SUMS.minisig if present) to the GitHub release."
echo "For notarization of the darwin binaries/DMG, see docs/SECURITY_INSTALL.md."
