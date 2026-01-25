#!/bin/bash
#
# Clive - Linear Issue Updated Hook
#
# PostToolUse hook that triggers after mcp__linear__update_issue
# Notifies TUI to refresh sidebar when Linear issues are updated
#
# Input (via stdin): JSON with tool_name, tool_input, tool_use_id
# Output: None (signals TUI via file)

set -euo pipefail

SIGNAL_FILE=".claude/.linear-updated"

# Read JSON input from stdin
INPUT_JSON=$(cat)

# Extract issue ID and state from tool_input
ISSUE_ID=$(echo "$INPUT_JSON" | jq -r '.tool_input.id // empty' 2>/dev/null)
STATE=$(echo "$INPUT_JSON" | jq -r '.tool_input.state // empty' 2>/dev/null)

# Log the update
echo "[HOOK] Linear issue updated: $ISSUE_ID -> $STATE" >&2

# Write signal file for TUI to pick up
# TUI's useLinearSync can watch for this to trigger immediate refresh
mkdir -p ".claude"
cat > "$SIGNAL_FILE" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")",
  "issueId": "$ISSUE_ID",
  "state": "$STATE"
}
EOF

exit 0
