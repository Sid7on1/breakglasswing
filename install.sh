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
#   BIMAX_REPO=Sid7on1/breakglasswing  GitHub repo for releases
#   BIMAX_VERSION=v1.2.0               release tag         (default: latest)
#   BIMAX_BASE_URL=https://…           direct artifact base URL (skips GitHub API)
#   BIMAX_LOCAL_ARTIFACT=/path/bimax   install a prebuilt binary (offline/CI)
#
#   install.sh --update                install/replace with the requested or latest version
#   install.sh --uninstall             remove the installed binary
set -euo pipefail

INSTALL_DIR="${BIMAX_INSTALL_DIR:-$HOME/.local/bin}"
REPO="${BIMAX_REPO:-Sid7on1/breakglasswing}"
VERSION="${BIMAX_VERSION:-latest}"
ACTION="${1:---install}"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
say()  { echo -e "${CYAN}→ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
die()  { echo -e "${RED}error: $*${NC}" >&2; exit 1; }

case "$ACTION" in
  --install|--update) ;;
  --uninstall)
    if [ -e "$INSTALL_DIR/bimax" ]; then
      rm -f "$INSTALL_DIR/bimax"
      ok "uninstalled $INSTALL_DIR/bimax"
    else
      say "BiMax is not installed at $INSTALL_DIR/bimax"
    fi
    exit 0
    ;;
  --help|-h)
    echo "Usage: install.sh [--install|--update|--uninstall]"
    exit 0
    ;;
  *) die "unknown action: $ACTION (use --help)" ;;
esac

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

sha256_file() {
  if command -v shasum >/dev/null; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null; then sha256sum "$1" | awk '{print $1}'
  else die "shasum or sha256sum is required to verify the release"
  fi
}

# ---- Mode 0: explicit local artifact (offline installs and clean-machine CI) --------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -n "${BIMAX_LOCAL_ARTIFACT:-}" ]; then
  [ -f "$BIMAX_LOCAL_ARTIFACT" ] || die "local artifact not found: $BIMAX_LOCAL_ARTIFACT"
  cp "$BIMAX_LOCAL_ARTIFACT" "$tmp/bimax"
  install_bin "$tmp/bimax"
# ---- Mode 1: from-source (running inside a checkout with the toolchain) -------------
elif [ -f "$script_dir/build-release.sh" ] && [ -f "$script_dir/src/index.ts" ] \
   && command -v bun >/dev/null && command -v go >/dev/null; then
  say "BiMax checkout + toolchain detected — building locally"
  ( cd "$script_dir" && ./build-release.sh )
  install_bin "$script_dir/build/bimax"
else
  # ---- Mode 2: download a release artifact ------------------------------------------
  command -v curl >/dev/null || die "curl is required"
  if [ -n "${BIMAX_BASE_URL:-}" ]; then
    url="${BIMAX_BASE_URL%/}/${artifact}.tar.gz"
    sums_url="${BIMAX_BASE_URL%/}/SHA256SUMS"
  elif [ "$VERSION" = "latest" ]; then
    url="https://github.com/${REPO}/releases/latest/download/${artifact}.tar.gz"
    sums_url="https://github.com/${REPO}/releases/latest/download/SHA256SUMS"
  else
    url="https://github.com/${REPO}/releases/download/${VERSION}/${artifact}.tar.gz"
    sums_url="https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS"
  fi
  say "downloading ${url}"
  curl -fL --progress-bar -o "$tmp/${artifact}.tar.gz" "$url" \
    || die "download failed — no release artifact for ${os}-${arch}? Build from source instead:
  git clone https://github.com/${REPO} && cd bimax && ./install.sh"
  say "verifying SHA-256 checksum"
  curl -fsSL -o "$tmp/SHA256SUMS" "$sums_url" || die "could not download SHA256SUMS"
  expected="$(awk -v file="${artifact}.tar.gz" '$2 == file || $2 == "*" file { print $1; exit }' "$tmp/SHA256SUMS")"
  [ -n "$expected" ] || die "SHA256SUMS has no entry for ${artifact}.tar.gz"
  actual="$(sha256_file "$tmp/${artifact}.tar.gz")"
  [ "$actual" = "$expected" ] || die "checksum mismatch for ${artifact}.tar.gz"
  ok "checksum verified"
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
