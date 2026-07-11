#!/usr/bin/env bash
# build-release.sh — quick HOST build of the single self-contained BiMax binary → build/bimax
# (a Go/Bubble Tea front-end with the bun-compiled Node engine baked in via go:embed; one file,
# no Node/Bun/node_modules on the host). This is the from-source path install.sh uses. For the
# full cross-platform, tarballed release matrix, use release.sh. Shared steps live in
# scripts/lib-build.sh.
set -euo pipefail
cd "$(dirname "$0")"
source scripts/lib-build.sh

bimax_sweep_bunbuild
trap bimax_sweep_bunbuild EXIT

build_bimax "" "" "build/bimax" dev

echo "Done → build/bimax ($(du -h build/bimax | cut -f1)).  Run it inside any project directory."
