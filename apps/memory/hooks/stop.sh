#!/usr/bin/env bash
# Hook: Stop
# Trigger: When a Claude Code session ends.
# Action: Send transcript to /sessions/summarize for AI-compressed summary.
#         Falls back to raw CONTEXT extraction if summarization fails.
#
# Stdin contract:
# {
#   "session_id": "...",
#   "transcript_path": "/path/to/session.jsonl",
#   "cwd": "/workspace/path",
#   "hook_event_name": "Stop"
# }

set -uo pipefail
trap 'echo "{}"; exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

read_stdin

# Extract transcript path
TRANSCRIPT_PATH=""
if [ -n "$STDIN_JSON" ]; then
  TRANSCRIPT_PATH=$(echo "$STDIN_JSON" | jq -r '.transcript_path // empty' 2>/dev/null) || true
fi

# No transcript or file missing — nothing to do
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  echo '{}'
  exit 0
fi

# Check server health — bail silently if down
if ! is_server_healthy; then
  echo '{}'
  exit 0
fi

WORKSPACE=$(get_workspace)
SESSION_ID=$(get_session_id)

# Extract transcript content (last 100 lines for summarization, ~50K chars max)
TRANSCRIPT=$(tail -100 "$TRANSCRIPT_PATH" \
  | jq -r 'select(.type == "assistant" or .type == "human") | .message.content[]? | select(.type == "text") | .text' 2>/dev/null \
  | head -c 50000) || true

# Skip trivial sessions (< 100 chars of output)
if [ -z "$TRANSCRIPT" ] || [ ${#TRANSCRIPT} -lt 100 ]; then
  echo '{}'
  exit 0
fi

# Strip private content from transcript
TRANSCRIPT=$(strip_private_tags "$TRANSCRIPT")

# Try AI summarization via /sessions/summarize
SUMMARIZE_BODY=$(jq -n \
  --arg sid "$SESSION_ID" \
  --arg ws "$WORKSPACE" \
  --arg transcript "$TRANSCRIPT" \
  '{
    "sessionId": $sid,
    "workspace": $ws,
    "transcript": $transcript
  }')

RESULT=$(api_call POST /sessions/summarize "$SUMMARIZE_BODY" 2>/dev/null) || RESULT=""

# Check if summarization succeeded
if [ -n "$RESULT" ]; then
  SUMMARY_ID=$(echo "$RESULT" | jq -r '.summaryMemoryId // empty' 2>/dev/null) || true
  if [ -n "$SUMMARY_ID" ]; then
    echo '{}'
    exit 0
  fi
fi

# Fallback: store raw excerpt as CONTEXT memory
SUMMARY=$(echo "$TRANSCRIPT" | tail -c 1500)
store_memory "$WORKSPACE" "$SESSION_ID" "CONTEXT" "$SUMMARY" "0.6" "stop_hook" "session-end,auto-extracted" >/dev/null 2>&1 || true

echo '{}'
