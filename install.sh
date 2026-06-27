#!/usr/bin/env bash
#
# install.sh — BiMax CLI installer
#
# Usage:
#   curl -fsSL https://bimax.ai/install.sh | bash
#
# Installs:
#   - Node.js (via fnm) if not found
#   - bimax CLI globally via npm
#   - First-run config at ~/.breakglass/config.json

set -euo pipefail

INSTALL_DIR="${BIMAX_INSTALL_DIR:-$HOME/.bimax}"
BIMAX_VERSION="${BIMAX_VERSION:-latest}"

REPO="bimax/bimax"  # GitHub org/repo — update after publishing

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         BiMax — Terminal AI Agent           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ---- Prerequisites: Node.js ----
install_node() {
  echo -e "${CYAN}→ Installing Node.js via fnm...${NC}"

  # Install fnm if not present
  if ! command -v fnm &>/dev/null; then
    curl -fsSL https://fnm.vercel.app/install | bash
    export PATH="$HOME/.local/share/fnm:$PATH"
    eval "$(fnm env)"
  fi

  fnm install --lts
  fnm use lts-latest

  if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js installation failed."
    echo "Install manually: https://nodejs.org/"
    exit 1
  fi
}

if ! command -v node &>/dev/null; then
  echo -e "${CYAN}→ Node.js not found. Installing...${NC}"
  install_node
else
  NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${CYAN}→ Node.js v$NODE_MAJOR is too old (need 18+). Upgrading...${NC}"
    install_node
  fi
fi

echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# ---- Install bimax via npm ----
echo ""
echo -e "${CYAN}→ Installing bimax...${NC}"

if [ "$BIMAX_VERSION" = "latest" ]; then
  npm install -g bimax
else
  npm install -g "bimax@${BIMAX_VERSION}"
fi

echo -e "${GREEN}✓ bimax installed${NC}"

# ---- Verify ----
if command -v bimax &>/dev/null; then
  echo ""
  echo -e "${GREEN}${BOLD}✓ bimax $(bimax --version 2>/dev/null || echo 'installed')${NC}"
  echo ""
  echo -e "Run ${BOLD}bimax${NC} to start the interactive CLI."
  echo ""
  echo -e "Quick start:"
  echo -e "  export NVIDIA_API_KEY=\"your-key-here\""
  echo -e "  bimax"
  echo ""
  echo -e "Or run a one-off:"
  echo -e "  bimax \"list all TypeScript files\" --print"
  echo ""
else
  echo ""
  echo "WARNING: bimax installed but not found in PATH."
  echo "Check that npm global binaries are in your PATH:"
  echo '  export PATH="$(npm bin -g):$PATH"'
  echo ""
  echo "Then run: bimax"
  echo ""
fi
