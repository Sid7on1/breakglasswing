#!/usr/bin/env bash
# Stage a verified, architecture-matched Terminal engine release for Desktop.
# No source compilation occurs here. Contributors may explicitly opt into BIMAX_ENGINE_LOCAL_OVERRIDE.
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:-}"
if [ -z "$target" ]; then
  [ "$(uname -s)" = Darwin ] || { echo "error: Bimax for Mac requires darwin-arm64 or darwin-x64" >&2; exit 1; }
  case "$(uname -m)" in arm64|aarch64) target=darwin-arm64 ;; x86_64|amd64) target=darwin-x64 ;; *) echo "error: unsupported architecture" >&2; exit 1 ;; esac
fi
case "$target" in darwin-arm64|darwin-x64) ;; *) echo "error: target must be darwin-arm64 or darwin-x64" >&2; exit 1 ;; esac

node scripts/resolve-engine-artifact.mjs "$target"
