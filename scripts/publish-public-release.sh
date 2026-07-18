#!/usr/bin/env bash
# Promote a locally verified release matrix from the private source repo to the public binary repo.
set -euo pipefail
cd "$(dirname "$0")/.."

release_repo="${BIMAX_RELEASE_REPO:-Sid7on1/bimax-releases}"
version="$(node -p "require('./package.json').version")"
tag="v${version}"
title="Bimax ${tag} (unsigned macOS beta)"
assets=(
  build/bimax-darwin-arm64.tar.gz
  build/bimax-darwin-x64.tar.gz
  build/bimax-linux-x64.tar.gz
  build/bimax-linux-arm64.tar.gz
  build/SHA256SUMS
)

for asset in "${assets[@]}"; do
  [ -f "$asset" ] || { echo "missing release asset: $asset (run ./release.sh first)" >&2; exit 1; }
done

( cd build && shasum -a 256 -c SHA256SUMS )
notes="$(mktemp)"
trap 'rm -f "$notes"' EXIT
{
  echo "> **macOS beta notice:** These builds are unsigned because Apple Developer credentials are not configured. Verify the attached SHA256SUMS before use; macOS may display a first-run security warning."
  echo
  cat docs/CLI_V1_RELEASE.md
} > "$notes"

if gh release view "$tag" -R "$release_repo" >/dev/null 2>&1; then
  gh release upload "$tag" "${assets[@]}" --clobber -R "$release_repo"
  gh release edit "$tag" --title "$title" --notes-file "$notes" -R "$release_repo"
else
  gh release create "$tag" "${assets[@]}" --title "$title" --notes-file "$notes" -R "$release_repo"
fi

echo "published ${tag} → https://github.com/${release_repo}/releases/tag/${tag}"
