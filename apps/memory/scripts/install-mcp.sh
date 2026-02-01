#!/usr/bin/env bash
# Install the Clive Memory MCP server for Claude Code.
# Builds the binary and registers it in ~/.claude/settings.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_DIR="${MEMORY_DIR}/bin"
BINARY="${BIN_DIR}/memory-mcp"

echo "==> Building MCP binary..."
cd "$MEMORY_DIR"
CGO_ENABLED=1 go build -tags sqlite_fts5 -o "$BINARY" ./cmd/mcp
echo "    Built: ${BINARY}"

# Update Claude Code settings
SETTINGS_FILE="${HOME}/.claude/settings.json"

if [ ! -f "$SETTINGS_FILE" ]; then
  echo "    Creating ${SETTINGS_FILE}..."
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  echo '{}' > "$SETTINGS_FILE"
fi

echo "==> Registering MCP server in Claude Code settings..."

# Use jq to add/update the mcpServers entry
TEMP_FILE=$(mktemp)
jq --arg bin "$BINARY" '
  .mcpServers = (.mcpServers // {}) |
  .mcpServers["clive-memory"] = {
    "command": $bin,
    "env": {
      "MEMORY_SERVER_URL": "http://localhost:8741"
    }
  }
' "$SETTINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$SETTINGS_FILE"

echo "==> Done! MCP server 'clive-memory' registered."
echo ""
echo "    Tools available:"
echo "      - memory_search_index  Search with compact previews"
echo "      - memory_get           Fetch full memory content"
echo "      - memory_timeline      Chronological context"
echo "      - memory_store         Store new memories"
echo "      - memory_impact        Signal memory value"
echo "      - memory_supersede     Replace outdated memories"
echo ""
echo "    Make sure the memory server is running: docker compose up -d"
echo "    Then restart Claude Code to discover the tools."
