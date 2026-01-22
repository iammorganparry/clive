#!/bin/bash
# Clive CLI - Global Installation Script
# Usage: ./install.sh [--uninstall]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIVE_PATH="$SCRIPT_DIR/clive.sh"
INSTALL_NAME="clive"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Uninstall mode
if [ "$1" = "--uninstall" ]; then
    echo "Uninstalling clive..."

    if [ -L "/usr/local/bin/$INSTALL_NAME" ]; then
        sudo rm -f "/usr/local/bin/$INSTALL_NAME"
        echo -e "${GREEN}✓ Removed /usr/local/bin/$INSTALL_NAME${NC}"
    elif [ -L "$HOME/bin/$INSTALL_NAME" ]; then
        rm -f "$HOME/bin/$INSTALL_NAME"
        echo -e "${GREEN}✓ Removed ~/bin/$INSTALL_NAME${NC}"
    else
        echo -e "${YELLOW}clive not found in standard locations${NC}"
    fi
    exit 0
fi

echo "Installing clive CLI..."
echo ""

# Check if clive.sh exists
if [ ! -f "$CLIVE_PATH" ]; then
    echo -e "${RED}Error: clive.sh not found at $CLIVE_PATH${NC}"
    exit 1
fi

# Try /usr/local/bin first (requires sudo)
if [ -w "/usr/local/bin" ] || sudo -n true 2>/dev/null; then
    echo "Installing to /usr/local/bin (may require sudo)..."
    sudo ln -sf "$CLIVE_PATH" "/usr/local/bin/$INSTALL_NAME"
    echo -e "${GREEN}✓ Installed to /usr/local/bin/$INSTALL_NAME${NC}"
else
    # Fall back to ~/bin
    echo "Installing to ~/bin (no sudo required)..."
    mkdir -p "$HOME/bin"
    ln -sf "$CLIVE_PATH" "$HOME/bin/$INSTALL_NAME"
    echo -e "${GREEN}✓ Installed to ~/bin/$INSTALL_NAME${NC}"

    # Check if ~/bin is in PATH
    if [[ ":$PATH:" != *":$HOME/bin:"* ]]; then
        echo ""
        echo -e "${YELLOW}Note: ~/bin is not in your PATH${NC}"
        echo ""
        echo "Add it by running one of:"
        echo "  echo 'export PATH=\"\$HOME/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
        echo "  echo 'export PATH=\"\$HOME/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
    fi
fi

echo ""
echo "Done! Test with: clive --help"
