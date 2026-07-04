#!/usr/bin/env bash
#
# install.sh — BiMax one-click installer
#
#   curl -fsSL https://raw.githubusercontent.com/<org>/bimax/main/install.sh | bash
#
# Installs the SINGLE self-contained binary (Go TUI + embedded engine — no Node, no Bun,
# no node_modules needed on this machine) to ~/.local/bin/bimax.
#
# Modes (auto-detected):
#   download     — fetch the platform tarball from GitHub Releases (default off-repo)
#   from-source  — run inside a BiMax checkout with bun+go available: builds locally
#
# Overrides:
#   BIMAX_INSTALL_DIR=/usr/local/bin   install location   (default ~/.local/bin)
#   BIMAX_REPO=org/bimax               GitHub repo for releases
#   BIMAX_VERSION=v1.2.0               release tag         (default: latest)
#   BIMAX_BASE_URL=https://…           direct artifact base URL (skips GitHub API)
set -euo pipefail

INSTALL_DIR="${BIMAX_INSTALL_DIR:-$HOME/.local/bin}"
REPO="${BIMAX_REPO:-bimax/bimax}"
VERSION="${BIMAX_VERSION:-latest}"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
say()  { echo -e "${CYAN}→ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
die()  { echo -e "${RED}error: $*${NC}" >&2; exit 1; }

echo ""
echo -e "${BOLD}BiMax — autonomous AI agent for your terminal${NC}"
echo ""

# ---- Platform detection -------------------------------------------------------------
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  darwin) os=darwin ;;
  linux)  os=linux ;;
  *) die "unsupported OS: $os (macOS and Linux are supported)" ;;
esac
arch="$(uname -m)"
case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=x64 ;;
  *) die "unsupported architecture: $arch" ;;
esac
artifact="bimax-${os}-${arch}"
say "platform: ${os}-${arch}"

mkdir -p "$INSTALL_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

install_bin() { # $1 = path to built/downloaded binary
  chmod +x "$1"
  mv "$1" "$INSTALL_DIR/bimax"
  ok "installed → $INSTALL_DIR/bimax"
}

# ---- Mode 1: from-source (running inside a checkout with the toolchain) -------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$script_dir/build-release.sh" ] && [ -f "$script_dir/src/index.ts" ] \
   && command -v bun >/dev/null && command -v go >/dev/null; then
  say "BiMax checkout + toolchain detected — building locally"
  ( cd "$script_dir" && ./build-release.sh )
  install_bin "$script_dir/build/bimax"
else
  # ---- Mode 2: download a release artifact ------------------------------------------
  command -v curl >/dev/null || die "curl is required"
  if [ -n "${BIMAX_BASE_URL:-}" ]; then
    url="${BIMAX_BASE_URL%/}/${artifact}.tar.gz"
  elif [ "$VERSION" = "latest" ]; then
    url="https://github.com/${REPO}/releases/latest/download/${artifact}.tar.gz"
  else
    url="https://github.com/${REPO}/releases/download/${VERSION}/${artifact}.tar.gz"
  fi
  say "downloading ${url}"
  curl -fL --progress-bar -o "$tmp/${artifact}.tar.gz" "$url" \
    || die "download failed — no release artifact for ${os}-${arch}? Build from source instead:
  git clone https://github.com/${REPO} && cd bimax && ./install.sh"
  tar -C "$tmp" -xzf "$tmp/${artifact}.tar.gz"
  install_bin "$tmp/${artifact}"
fi

# ---- PATH + verify -------------------------------------------------------------------
if ! command -v bimax >/dev/null 2>&1; then
  shellrc="$HOME/.zshrc"; [ -n "${BASH_VERSION:-}" ] && shellrc="$HOME/.bashrc"
  if ! grep -qs "$INSTALL_DIR" "$shellrc" 2>/dev/null; then
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$shellrc"
    say "added $INSTALL_DIR to PATH in $shellrc (restart your shell)"
  fi
  export PATH="$INSTALL_DIR:$PATH"
fi

ver="$("$INSTALL_DIR/bimax" --version 2>/dev/null || true)"
[ -n "$ver" ] || die "installed binary failed to run"
ok "$ver"

echo ""
echo -e "Run ${BOLD}bimax${NC} inside any project directory to start."
echo -e "First run will ask for your model API key (e.g. ${BOLD}NVIDIA_API_KEY${NC})."
echo ""
