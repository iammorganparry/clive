#!/usr/bin/env bash
# Hook: PreToolUse
# Trigger: Before Write, Edit, or MultiEdit tool calls.
# Action: Search for known gotchas/failures related to the files being modified.
set -uo pipefail
trap 'echo "{}"; exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

read_stdin

# Extract tool input from stdin JSON
TOOL_INPUT=""
if [ -n "$STDIN_JSON" ]; then
  TOOL_INPUT=$(echo "$STDIN_JSON" | jq -r '.tool_input // empty' 2>/dev/null) || true
fi

if [ -z "$TOOL_INPUT" ]; then
  echo '{}'
  exit 0
fi

# Extract file path from tool input
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // .filePath // empty' 2>/dev/null) || true

if [ -z "$FILE_PATH" ]; then
  echo '{}'
  exit 0
fi

if ! is_server_healthy; then
  safe_exit
fi

WORKSPACE=$(get_workspace)
FILENAME=$(basename "$FILE_PATH")

# Search for gotchas and failures related to this file
BODY=$(jq -n \
  --arg ws "$WORKSPACE" \
  --arg q "gotcha failure warning $FILENAME $FILE_PATH" \
  '{
    "workspace": $ws,
    "query": $q,
    "maxResults": 3,
    "minScore": 0.5,
    "memoryTypes": ["GOTCHA", "FAILURE", "PATTERN", "APP_KNOWLEDGE"],
    "includeGlobal": false,
    "searchMode": "hybrid"
  }')

RESPONSE=$(api_call POST /memories/search "$BODY") || safe_exit

CONTEXT=$(format_memories_xml "$RESPONSE") || safe_exit

if [ -n "$CONTEXT" ]; then
  hook_output "$CONTEXT"
else
  echo '{}'
fi
