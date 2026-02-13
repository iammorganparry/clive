#!/usr/bin/env bash
# Hook: UserPromptSubmit
# Trigger: Every time the user sends a message.
# Action: Search for relevant context using progressive disclosure (Layer 1 index → Layer 3 batch).
set -uo pipefail
trap 'echo "{}"; exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

read_stdin

# Extract the user prompt from stdin JSON
USER_PROMPT=""
if [ -n "$STDIN_JSON" ]; then
  USER_PROMPT=$(echo "$STDIN_JSON" | jq -r '.prompt // empty' 2>/dev/null) || true
fi

# Skip if empty or very short prompt
if [ ${#USER_PROMPT} -lt 10 ]; then
  echo '{}'
  exit 0
fi

if ! is_server_healthy; then
  safe_exit
fi

WORKSPACE=$(get_workspace)

# Feature 2: Detect session context for encoding specificity matching
SESSION_CTX=$(detect_encoding_context "$WORKSPACE" 2>/dev/null) || SESSION_CTX=""

# Layer 1: Search index for compact results (5 results, ~80 char previews)
if [ -n "$SESSION_CTX" ]; then
  INDEX_BODY=$(jq -n \
    --arg ws "$WORKSPACE" \
    --arg q "$USER_PROMPT" \
    --argjson ctx "$SESSION_CTX" \
    '{
      "workspace": $ws,
      "query": $q,
      "maxResults": 5,
      "minScore": 0.45,
      "includeGlobal": true,
      "searchMode": "hybrid",
      "sessionContext": $ctx
    }')
else
  INDEX_BODY=$(jq -n \
    --arg ws "$WORKSPACE" \
    --arg q "$USER_PROMPT" \
    '{
      "workspace": $ws,
      "query": $q,
      "maxResults": 5,
      "minScore": 0.45,
      "includeGlobal": true,
      "searchMode": "hybrid"
    }')
fi

INDEX_RESPONSE=$(api_call POST /memories/search/index "$INDEX_BODY") || safe_exit

# Check if we got results
RESULT_COUNT=$(echo "$INDEX_RESPONSE" | jq -r '.results | length' 2>/dev/null) || RESULT_COUNT=0
if [ "$RESULT_COUNT" = "0" ] || [ -z "$RESULT_COUNT" ]; then
  echo '{}'
  exit 0
fi

# Layer 3: Batch-get full content for top 2 results
TOP_IDS=$(echo "$INDEX_RESPONSE" | jq -c '[.results[:2] | .[].id]' 2>/dev/null) || TOP_IDS="[]"

FULL_MEMORIES=""
if [ "$TOP_IDS" != "[]" ] && [ -n "$TOP_IDS" ]; then
  BATCH_BODY=$(jq -n --argjson ids "$TOP_IDS" '{"ids": $ids}')
  BATCH_RESPONSE=$(api_call POST /memories/batch "$BATCH_BODY" 2>/dev/null) || true

  if [ -n "$BATCH_RESPONSE" ]; then
    # Format full memories as XML
    FULL_MEMORIES=$(echo "$BATCH_RESPONSE" | jq -c '.memories[]?' 2>/dev/null | while IFS= read -r mem; do
      mid=$(echo "$mem" | jq -r '.id // empty')
      mtype=$(echo "$mem" | jq -r '.memoryType // empty')
      content=$(echo "$mem" | jq -r '.content // empty')
      impact=$(echo "$mem" | jq -r '.impactScore // 0')
      echo "  <memory id=\"${mid}\" type=\"${mtype}\" impact=\"${impact}\">${content}</memory>"
    done) || true
  fi
fi

# Format remaining index results (positions 2+) as compact previews
PREVIEW_MEMORIES=$(echo "$INDEX_RESPONSE" | jq -c '.results[2:][]?' 2>/dev/null | while IFS= read -r result; do
  mid=$(echo "$result" | jq -r '.id // empty')
  mtype=$(echo "$result" | jq -r '.memoryType // empty')
  preview=$(echo "$result" | jq -r '.contentPreview // empty')
  score=$(echo "$result" | jq -r '.score // 0')
  echo "  <memory-preview id=\"${mid}\" type=\"${mtype}\" score=\"${score}\">${preview}</memory-preview>"
done) || true

# Combine into XML context
CONTEXT=""
if [ -n "$FULL_MEMORIES" ] || [ -n "$PREVIEW_MEMORIES" ]; then
  CONTEXT="<recalled-memories>"
  [ -n "$FULL_MEMORIES" ] && CONTEXT="${CONTEXT}"$'\n'"${FULL_MEMORIES}"
  [ -n "$PREVIEW_MEMORIES" ] && CONTEXT="${CONTEXT}"$'\n'"${PREVIEW_MEMORIES}"
  CONTEXT="${CONTEXT}"$'\n'"</recalled-memories>"
fi

# Check if a branch thread exists and inject a reminder if Claude hasn't created one
BRANCH_REMINDER=""
BRANCH=$(get_branch "$WORKSPACE")
if [ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
  WS_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$WORKSPACE'))" 2>/dev/null || echo "$WORKSPACE")
  BRANCH_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$BRANCH'))" 2>/dev/null || echo "$BRANCH")
  BRANCH_THREAD=$(api_call GET "/threads?workspace=${WS_ENCODED}&name=${BRANCH_ENCODED}" 2>/dev/null) || true
  BRANCH_THREAD_COUNT=$(echo "$BRANCH_THREAD" | jq -r '.threads | length' 2>/dev/null) || BRANCH_THREAD_COUNT=0
  if [ "$BRANCH_THREAD_COUNT" = "0" ] || [ -z "$BRANCH_THREAD_COUNT" ]; then
    BRANCH_REMINDER="<branch-thread-missing branch=\"${BRANCH}\">No feature thread for this branch. Create one NOW: bash ${SCRIPT_DIR}/thread.sh start \"${BRANCH}\" \"description\"</branch-thread-missing>"
  fi
fi

# Combine branch reminder with recalled memories
FINAL_CONTEXT=""
if [ -n "$BRANCH_REMINDER" ]; then
  FINAL_CONTEXT="$BRANCH_REMINDER"
fi
if [ -n "$CONTEXT" ]; then
  if [ -n "$FINAL_CONTEXT" ]; then
    FINAL_CONTEXT="${FINAL_CONTEXT}"$'\n'"${CONTEXT}"
  else
    FINAL_CONTEXT="$CONTEXT"
  fi
fi

if [ -n "$FINAL_CONTEXT" ]; then
  hook_output "$FINAL_CONTEXT"
else
  echo '{}'
fi
