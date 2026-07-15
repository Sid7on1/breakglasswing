#!/usr/bin/env bash
#
# install.sh — BiMax one-click installer
#
#   curl -fsSL https://bimax-liard.vercel.app/install | bash
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
#   BIMAX_REPO=Sid7on1/bimax-releases  GitHub repo for public releases
#   BIMAX_VERSION=v1.2.0               release tag         (default: latest)
#   BIMAX_BASE_URL=https://…           direct artifact base URL (skips GitHub API)
#   BIMAX_LOCAL_ARTIFACT=/path/bimax   install a prebuilt binary (offline/CI)
#
#   install.sh --update                install/replace with the requested or latest version
#   install.sh --uninstall             remove the installed binary
set -euo pipefail

INSTALL_DIR="${BIMAX_INSTALL_DIR:-$HOME/.local/bin}"
REPO="${BIMAX_REPO:-Sid7on1/bimax-releases}"
VERSION="${BIMAX_VERSION:-latest}"
ACTION="${1:---install}"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
say()  { echo -e "${CYAN}→ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
die()  { echo -e "${RED}error: $*${NC}" >&2; exit 1; }

case "$ACTION" in
  --install|--update) ;;
  --uninstall)
    # Tiered removal: the EXECUTABLE always; CONFIG (~/.breakglass — holds your API key) only with
    # --purge; PROJECT DATA (per-repo .bimax/ directories) is NEVER touched by the installer — it is
    # yours and may be under version control. We print exactly what each tier covers so nothing is
    # deleted by surprise.
    if [ -e "$INSTALL_DIR/bimax" ]; then
      rm -f "$INSTALL_DIR/bimax"
      ok "removed executable  → $INSTALL_DIR/bimax"
    else
      say "no executable at $INSTALL_DIR/bimax"
    fi
    if [ "${2:-}" = "--purge" ]; then
      if [ -e "$HOME/.breakglass" ]; then
        rm -rf "$HOME/.breakglass"
        ok "removed config      → ~/.breakglass (API keys)"
      fi
    else
      say "kept config         → ~/.breakglass (re-run with '--uninstall --purge' to remove your API key)"
    fi
    say "kept project data   → per-repo .bimax/ directories are left untouched (yours to keep or delete)"
    exit 0
    ;;
  --help|-h)
    echo "Usage: install.sh [--install|--update|--uninstall [--purge]]"
    echo "  --uninstall           remove the executable only"
    echo "  --uninstall --purge   also remove ~/.breakglass (your API keys)"
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

dest="$INSTALL_DIR/bimax"

install_bin() { # $1 = path to a FULLY VERIFIED binary
  chmod +x "$1"
  # Transactional install: preserve the currently-installed binary, atomically swap the new one into
  # place (mv within the same dir is atomic — a reader sees either the old or the new file, never a
  # half-written one), then smoke-test it. If the new binary can't run, roll back to the saved one so
  # a failed update never leaves the user with a broken/half-installed `bimax`.
  local backup=""
  if [ -e "$dest" ]; then
    backup="${dest}.prev-$$"
    cp -p "$dest" "$backup"
  fi
  # Stage into the destination directory so the final mv stays on one filesystem (keeps it atomic).
  local staged="${dest}.new-$$"
  mv "$1" "$staged"
  mv "$staged" "$dest"
  if ! "$dest" --version >/dev/null 2>&1; then
    if [ -n "$backup" ]; then
      mv "$backup" "$dest"
      die "new binary failed to run — rolled back to the previous version ($("$dest" --version 2>/dev/null || echo unknown))"
    fi
    rm -f "$dest"
    die "installed binary failed to run (no previous version to roll back to)"
  fi
  [ -n "$backup" ] && rm -f "$backup"
  ok "installed → $dest"
}

sha256_file() {
  if command -v shasum >/dev/null; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null; then sha256sum "$1" | awk '{print $1}'
  else die "shasum or sha256sum is required to verify the release"
  fi
}

# BiMax's release-signing public key (minisign / Ed25519). Trust is rooted HERE, in the installer
# script itself, NOT in a file fetched next to the artifacts — so a compromised release host that can
# swap the tarball AND its adjacent SHA256SUMS still cannot forge a valid signature. Empty until the
# signing key is published with v1.0.1; override for testing with BIMAX_MINISIGN_PUBKEY.
MINISIGN_PUBKEY="${BIMAX_MINISIGN_PUBKEY:-}"

# Verify a detached minisign signature over $1 using $2 (the .minisig). Fail-closed semantics:
#  - signature file present  → it MUST verify (a bad/forged signature aborts the install), and
#  - signature file absent AND no pinned key → checksum-only (transitional, pre-v1.0.1 signing).
# Never executes a partially verified download: callers verify BEFORE install_bin.
verify_signature() { # $1 = signed file, $2 = .minisig path (may be missing)
  if [ ! -f "$2" ]; then
    [ -n "$MINISIGN_PUBKEY" ] && die "release signature missing but a signing key is pinned — refusing to install"
    return 0
  fi
  command -v minisign >/dev/null || die "release is signed but 'minisign' is not installed — install it (brew install minisign) to verify, or set BIMAX_ALLOW_UNVERIFIED=1 to skip (NOT recommended)"
  [ -n "$MINISIGN_PUBKEY" ] || die "a signature was provided but no trusted public key is pinned in this installer"
  minisign -Vm "$1" -x "$2" -P "$MINISIGN_PUBKEY" >/dev/null 2>&1 || die "SIGNATURE VERIFICATION FAILED for $(basename "$1") — refusing to install"
  ok "signature verified (minisign)"
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
  say "verifying release integrity"
  curl -fsSL -o "$tmp/SHA256SUMS" "$sums_url" || die "could not download SHA256SUMS"
  # Independent signature over the checksum manifest. Verifying the SIGNATURE of SHA256SUMS (rather
  # than trusting the file because it sits next to the artifact) is what makes the checksums
  # meaningful: forging the tarball now also requires forging a signature over the manifest.
  curl -fsSL -o "$tmp/SHA256SUMS.minisig" "${sums_url}.minisig" 2>/dev/null || true
  if [ "${BIMAX_ALLOW_UNVERIFIED:-0}" != "1" ]; then
    verify_signature "$tmp/SHA256SUMS" "$tmp/SHA256SUMS.minisig"
  fi
  expected="$(awk -v file="${artifact}.tar.gz" '$2 == file || $2 == "*" file { print $1; exit }' "$tmp/SHA256SUMS")"
  [ -n "$expected" ] || die "SHA256SUMS has no entry for ${artifact}.tar.gz"
  actual="$(sha256_file "$tmp/${artifact}.tar.gz")"
  [ "$actual" = "$expected" ] || die "checksum mismatch for ${artifact}.tar.gz — refusing to install"
  ok "checksum verified"
  # Extract into a scratch subdir so a malicious tarball can't overwrite anything outside $tmp, and
  # only ever install the exact expected artifact filename.
  mkdir -p "$tmp/extract"
  tar -C "$tmp/extract" -xzf "$tmp/${artifact}.tar.gz"
  [ -f "$tmp/extract/${artifact}" ] || die "release tarball did not contain the expected binary '${artifact}'"
  install_bin "$tmp/extract/${artifact}"
fi

# ---- PATH + verify -------------------------------------------------------------------
if ! command -v bimax >/dev/null 2>&1; then
  case "${SHELL:-}" in
    */zsh) shellrc="$HOME/.zshrc" ;;
    */bash) shellrc="$HOME/.bashrc" ;;
    *) shellrc="$HOME/.profile" ;;
  esac
  if ! grep -qs "$INSTALL_DIR" "$shellrc" 2>/dev/null; then
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$shellrc"
    say "added $INSTALL_DIR to PATH in $shellrc (restart your shell)"
  fi
  export PATH="$INSTALL_DIR:$PATH"
fi

# install_bin already smoke-tested the binary (and rolled back on failure), so this is just the
# friendly final version echo.
ver="$("$dest" --version 2>/dev/null || true)"
ok "${ver:-installed}"

echo ""
echo -e "Run ${BOLD}bimax${NC} inside any project directory to start."
echo -e "First run will ask for your model API key (e.g. ${BOLD}NVIDIA_API_KEY${NC})."
echo ""
