#!/usr/bin/env bash
# Hook: PreCompact
# Trigger: When Claude Code is about to compact the context window.
# Action: Store conversation summary and trigger lifecycle compaction.
set -uo pipefail
trap 'echo "{}"; exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

read_stdin

if ! is_server_healthy; then
  safe_exit
fi

WORKSPACE=$(get_workspace)
SESSION_ID=$(get_session_id)

# Extract summary from stdin JSON if available
SUMMARY=""
if [ -n "$STDIN_JSON" ]; then
  SUMMARY=$(echo "$STDIN_JSON" | jq -r '.summary // .prompt // empty' 2>/dev/null) || true
fi

# If we have a conversation summary, store it as a CONTEXT memory
if [ -n "$SUMMARY" ] && [ ${#SUMMARY} -gt 50 ]; then
  # Feature 5: Zeigarnik Effect — detect incomplete work in the summary
  COMPLETION_STATUS=""
  if echo "$SUMMARY" | grep -qiE '(TODO|will fix later|WIP|unresolved|not yet|incomplete|still need|haven.t finished|work in progress|needs to be done|left to do)'; then
    COMPLETION_STATUS="incomplete"
  fi

  if [ -n "$COMPLETION_STATUS" ]; then
    STORE_BODY=$(jq -n \
      --arg ws "$WORKSPACE" \
      --arg content "$SUMMARY" \
      --arg session "$SESSION_ID" \
      --arg status "$COMPLETION_STATUS" \
      '{
        "workspace": $ws,
        "content": $content,
        "memoryType": "CONTEXT",
        "tier": "short",
        "confidence": 0.7,
        "tags": ["session-context", "auto-extracted"],
        "source": "pre_compact",
        "sessionId": $session,
        "completionStatus": $status
      }')
  else
    STORE_BODY=$(jq -n \
      --arg ws "$WORKSPACE" \
      --arg content "$SUMMARY" \
      --arg session "$SESSION_ID" \
      '{
        "workspace": $ws,
        "content": $content,
        "memoryType": "CONTEXT",
        "tier": "short",
        "confidence": 0.7,
        "tags": ["session-context", "auto-extracted"],
        "source": "pre_compact",
        "sessionId": $session
      }')
  fi

  api_call POST /memories "$STORE_BODY" >/dev/null 2>&1 || true
fi

# Auto-append session context to active feature thread (prefer branch-matching)
if [ -n "$SUMMARY" ] && [ ${#SUMMARY} -gt 50 ]; then
  WS_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$WORKSPACE'))" 2>/dev/null || echo "$WORKSPACE")
  BRANCH=$(get_branch "$WORKSPACE")
  PRIMARY_THREAD_ID=""

  # First try to find a thread matching the current branch
  if [ -n "$BRANCH" ]; then
    BRANCH_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$BRANCH'))" 2>/dev/null || echo "$BRANCH")
    BRANCH_THREAD=$(api_call GET "/threads?workspace=${WS_ENCODED}&status=active&name=${BRANCH_ENCODED}" 2>/dev/null) || true
    if [ -n "$BRANCH_THREAD" ]; then
      PRIMARY_THREAD_ID=$(echo "$BRANCH_THREAD" | jq -r '.threads[0].id // empty' 2>/dev/null) || true
    fi
  fi

  # Fallback to first active thread if no branch match
  if [ -z "$PRIMARY_THREAD_ID" ]; then
    THREAD_LIST=$(api_call GET "/threads?workspace=${WS_ENCODED}&status=active" 2>/dev/null) || true
    if [ -n "$THREAD_LIST" ]; then
      PRIMARY_THREAD_ID=$(echo "$THREAD_LIST" | jq -r '.threads[0].id // empty' 2>/dev/null) || true
    fi
  fi

  if [ -n "$PRIMARY_THREAD_ID" ]; then
    THREAD_BODY=$(jq -n \
      --arg ws "$WORKSPACE" \
      --arg content "$SUMMARY" \
      '{
        "workspace": $ws,
        "content": $content,
        "section": "context",
        "memoryType": "CONTEXT"
      }')
    api_call POST "/threads/${PRIMARY_THREAD_ID}/entries" "$THREAD_BODY" >/dev/null 2>&1 || true
  fi
fi

# Trigger compaction: expire old short-term, promote high-value
api_call POST /memories/compact '{}' >/dev/null 2>&1 || true

echo '{}'
