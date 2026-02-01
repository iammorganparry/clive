#!/usr/bin/env bash
# Hook: PostToolUse
# Trigger: After every tool use (Write, Edit, Bash, etc.)
# Action: Capture observation for richer session data.
#
# Stdin contract:
# {
#   "session_id": "...",
#   "cwd": "/workspace/path",
#   "tool_name": "Write",
#   "tool_input": { ... },
#   "tool_output": "...",
#   "hook_event_name": "PostToolUse"
# }
#
# Fire-and-forget: must complete in <100ms, runs 50-200x per session.

set -uo pipefail
trap 'echo "{}"; exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

read_stdin

# Extract fields from stdin
TOOL_NAME=""
TOOL_INPUT=""
TOOL_OUTPUT=""
SESSION_ID=""

if [ -n "$STDIN_JSON" ]; then
  TOOL_NAME=$(echo "$STDIN_JSON" | jq -r '.tool_name // empty' 2>/dev/null) || true
  SESSION_ID=$(echo "$STDIN_JSON" | jq -r '.session_id // empty' 2>/dev/null) || true
  # Truncate input/output to keep payloads small
  TOOL_INPUT=$(echo "$STDIN_JSON" | jq -r '.tool_input // empty' 2>/dev/null | head -c 500) || true
  TOOL_OUTPUT=$(echo "$STDIN_JSON" | jq -r '.tool_output // empty' 2>/dev/null | head -c 200) || true
fi

# Skip if no tool name or session
if [ -z "$TOOL_NAME" ] || [ -z "$SESSION_ID" ]; then
  echo '{}'
  exit 0
fi

# Strip private content
TOOL_INPUT=$(strip_private_tags "$TOOL_INPUT")
TOOL_OUTPUT=$(strip_private_tags "$TOOL_OUTPUT")

# Fire-and-forget: store observation in background
store_observation "$SESSION_ID" "$TOOL_NAME" "$TOOL_INPUT" "$TOOL_OUTPUT" &

echo '{}'
