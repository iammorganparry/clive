#!/usr/bin/env bash
# Clive Memory Hooks — Uninstaller
# Removes hooks, MCP binary, and cleans Claude Code settings.
set -euo pipefail

INSTALL_DIR="${HOME}/.claude/memory"
HOOKS_DIR="${INSTALL_DIR}/hooks"
BIN_DIR="${INSTALL_DIR}/bin"
ENV_FILE="${INSTALL_DIR}/env"
SETTINGS_FILE="${HOME}/.claude/settings.json"

# Colors
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }

# ── Remove hook scripts ──────────────────────────────────────────────────────

if [ -d "$HOOKS_DIR" ]; then
  info "Removing hooks from ${HOOKS_DIR}/"
  rm -rf "$HOOKS_DIR"
  ok "Hooks removed"
else
  info "No hooks directory found at ${HOOKS_DIR}"
fi

# ── Remove MCP binary ────────────────────────────────────────────────────────

if [ -f "${BIN_DIR}/memory-mcp" ]; then
  info "Removing MCP binary..."
  rm -f "${BIN_DIR}/memory-mcp"
  rmdir "$BIN_DIR" 2>/dev/null || true
  ok "MCP binary removed"
else
  info "No MCP binary found"
fi

# ── Remove env file ──────────────────────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
  info "Removing config file..."
  rm -f "$ENV_FILE"
  ok "Config removed"
fi

# ── Clean up ~/.claude/memory if empty ────────────────────────────────────────

if [ -d "$INSTALL_DIR" ]; then
  if [ -z "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    rmdir "$INSTALL_DIR"
    ok "Removed empty ${INSTALL_DIR}/"
  fi
fi

# ── Remove entries from Claude Code settings ─────────────────────────────────

if [ -f "$SETTINGS_FILE" ]; then
  info "Cleaning Claude Code settings..."

  CLEANED=$(jq --arg hooks_dir "$HOOKS_DIR" '
    # Remove hook entries that reference our hooks directory
    if .hooks then
      .hooks |= with_entries(
        .value |= map(select(.command | test($hooks_dir) | not))
      ) |
      .hooks |= with_entries(select(.value | length > 0)) |
      if .hooks == {} then del(.hooks) else . end
    else . end |

    # Remove MCP server entry
    if .mcpServers then
      del(.mcpServers["clive-memory"]) |
      if .mcpServers == {} then del(.mcpServers) else . end
    else . end
  ' "$SETTINGS_FILE")

  echo "$CLEANED" | jq '.' > "$SETTINGS_FILE"
  ok "Cleaned ${SETTINGS_FILE}"
else
  info "No settings file found at ${SETTINGS_FILE}"
fi

echo ""
echo -e "${GREEN}Uninstall complete.${NC} Restart Claude Code to apply changes."
