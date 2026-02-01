#!/usr/bin/env bash
set -euo pipefail

# ─── Clive Worker — Mac Mini Setup ───────────────────────────────────────────
#
# Sets up a Mac Mini to run Clive worker processes natively.
# Run this script once on a fresh Mac Mini, then start the worker.
#
# Usage:
#   bash scripts/setup-mac-worker.sh
#
# What it does:
#   1. Installs prerequisites (Node.js 22, Claude CLI, GitHub CLI)
#   2. Creates ~/.clive/ directory structure
#   3. Clones the Clive monorepo into ~/.clive/repo
#   4. Prompts for environment variables and writes ~/.clive/worker.env
#   5. Installs the launchd plist for auto-start on boot
# ─────────────────────────────────────────────────────────────────────────────

CLIVE_DIR="$HOME/.clive"
REPO_DIR="$CLIVE_DIR/repo"
LOG_DIR="$CLIVE_DIR/logs"
ENV_FILE="$CLIVE_DIR/worker.env"
PLIST_NAME="com.clive.worker"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m ✓\033[0m  %s\n" "$1"; }
warn()  { printf "\033[1;33m !\033[0m  %s\n" "$1"; }
error() { printf "\033[1;31m ✗\033[0m  %s\n" "$1"; exit 1; }

# ─── Prerequisites ───────────────────────────────────────────────────────────

info "Checking prerequisites..."

# Homebrew
if ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi
ok "Homebrew"

# Node.js 22
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22.* ]]; then
    info "Installing Node.js 22..."
    brew install node@22
    brew link --overwrite node@22
fi
ok "Node.js $(node -v)"

# GitHub CLI
if ! command -v gh &>/dev/null; then
    info "Installing GitHub CLI..."
    brew install gh
fi
ok "GitHub CLI $(gh --version | head -1)"

# Claude CLI
if ! command -v claude &>/dev/null; then
    info "Installing Claude CLI..."
    npm install -g @anthropic-ai/claude-code
fi
ok "Claude CLI"

# yarn (corepack)
if ! command -v yarn &>/dev/null; then
    info "Enabling corepack for yarn..."
    corepack enable
fi
ok "Yarn $(yarn --version 2>/dev/null || echo 'available')"

# ─── Directory Structure ─────────────────────────────────────────────────────

info "Creating directory structure..."

mkdir -p "$CLIVE_DIR"
mkdir -p "$CLIVE_DIR/repo"
mkdir -p "$CLIVE_DIR/worktrees"
mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

ok "~/.clive/ directory structure"

# ─── Clone Repo ──────────────────────────────────────────────────────────────

if [ ! -d "$REPO_DIR/.git" ]; then
    info "Cloning Clive monorepo..."

    if ! gh auth status &>/dev/null; then
        warn "Not logged in to GitHub CLI. Please authenticate:"
        gh auth login
    fi

    gh repo clone anthropics/clive "$REPO_DIR" 2>/dev/null || \
    gh repo clone clive "$REPO_DIR" 2>/dev/null || \
    error "Failed to clone repo. Ensure 'gh auth login' is complete and you have access."

    ok "Cloned to $REPO_DIR"
else
    ok "Repo already cloned at $REPO_DIR"
fi

# ─── Install Dependencies ────────────────────────────────────────────────────

info "Installing dependencies..."
(cd "$REPO_DIR" && yarn install)
ok "Dependencies installed"

# ─── Environment Variables ────────────────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
    warn "~/.clive/worker.env already exists. Skipping env setup."
    warn "Edit $ENV_FILE manually to update."
else
    info "Setting up environment variables..."
    echo ""
    echo "  Enter the required environment variables."
    echo "  Press Enter to skip optional ones."
    echo ""

    read -rp "  CLIVE_WORKER_TOKEN (required): " CLIVE_WORKER_TOKEN
    [ -z "$CLIVE_WORKER_TOKEN" ] && error "CLIVE_WORKER_TOKEN is required"

    read -rp "  CLIVE_CENTRAL_URL (required, e.g. wss://...): " CLIVE_CENTRAL_URL
    [ -z "$CLIVE_CENTRAL_URL" ] && error "CLIVE_CENTRAL_URL is required"

    read -rp "  ANTHROPIC_API_KEY (required): " ANTHROPIC_API_KEY
    [ -z "$ANTHROPIC_API_KEY" ] && error "ANTHROPIC_API_KEY is required"

    read -rp "  CLIVE_REPO (e.g. owner/repo, optional): " CLIVE_REPO
    read -rp "  GITHUB_APP_ID (optional): " GITHUB_APP_ID
    read -rp "  GITHUB_APP_INSTALLATION_ID (optional): " GITHUB_APP_INSTALLATION_ID

    echo ""
    if [ -n "$GITHUB_APP_ID" ]; then
        read -rp "  Path to GitHub App private key PEM file (optional): " PEM_PATH
        if [ -n "$PEM_PATH" ] && [ -f "$PEM_PATH" ]; then
            GITHUB_APP_PRIVATE_KEY=$(cat "$PEM_PATH")
        else
            GITHUB_APP_PRIVATE_KEY=""
        fi
    else
        GITHUB_APP_PRIVATE_KEY=""
    fi

    read -rp "  CLIVE_MAX_CONCURRENT_SESSIONS (default: 5): " MAX_SESSIONS
    MAX_SESSIONS="${MAX_SESSIONS:-5}"

    read -rp "  CLIVE_WORKER_HOSTNAME (default: $(hostname)): " WORKER_HOSTNAME
    WORKER_HOSTNAME="${WORKER_HOSTNAME:-$(hostname)}"

    cat > "$ENV_FILE" <<ENVEOF
# Clive Worker Environment — generated by setup-mac-worker.sh

# Required
CLIVE_WORKER_TOKEN=$CLIVE_WORKER_TOKEN
CLIVE_CENTRAL_URL=$CLIVE_CENTRAL_URL
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY

# Worker identity
CLIVE_WORKER_HOSTNAME=$WORKER_HOSTNAME
CLIVE_MAX_CONCURRENT_SESSIONS=$MAX_SESSIONS

# Paths (defaults to ~/.clive/*)
CLIVE_REPO_DIR=$HOME/.clive/repo
CLIVE_WORKTREE_DIR=$HOME/.clive/worktrees
CLIVE_WORKSPACE_ROOT=$HOME/.clive/repo

# GitHub App (optional — needed for CLIVE_REPO)
CLIVE_REPO=$CLIVE_REPO
GITHUB_APP_ID=$GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY="$GITHUB_APP_PRIVATE_KEY"
GITHUB_APP_INSTALLATION_ID=$GITHUB_APP_INSTALLATION_ID
ENVEOF

    chmod 600 "$ENV_FILE"
    ok "Environment written to $ENV_FILE"
fi

# ─── Install launchd Plist ────────────────────────────────────────────────────

info "Installing launchd plist..."

PLIST_SRC="$SCRIPT_DIR/com.clive.worker.plist"
if [ ! -f "$PLIST_SRC" ]; then
    error "Plist template not found at $PLIST_SRC"
fi

# Replace __HOME__ placeholder with actual home directory
sed "s|__HOME__|$HOME|g" "$PLIST_SRC" > "$PLIST_DEST"

ok "Installed to $PLIST_DEST"

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
info "Setup complete!"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Test the worker manually first:"
echo "     source $ENV_FILE && cd $REPO_DIR && npx tsx apps/worker/src/index.ts"
echo ""
echo "  2. Once verified, load the launchd service:"
echo "     launchctl load $PLIST_DEST"
echo ""
echo "  3. Check logs:"
echo "     tail -f $LOG_DIR/worker-stdout.log"
echo "     tail -f $LOG_DIR/worker-stderr.log"
echo ""
echo "  4. To stop the service:"
echo "     launchctl unload $PLIST_DEST"
echo ""
echo "  5. To restart after config changes:"
echo "     launchctl unload $PLIST_DEST && launchctl load $PLIST_DEST"
echo ""
