#!/usr/bin/env bash
# Hook: SessionStart
# Trigger: When a new Claude Code session begins.
# Action: Check server health, inject recent workspace memories and last session summary.
set -uo pipefail
trap 'echo "{}"; exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

read_stdin

# Verify server is reachable
if ! is_server_healthy; then
  safe_exit
fi

WORKSPACE=$(get_workspace)

# --- Active Feature Threads (highest priority, branch-aware) ---
THREAD_CONTEXT=""
WS_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$WORKSPACE'))" 2>/dev/null || echo "$WORKSPACE")
BRANCH=$(get_branch "$WORKSPACE")
BRANCH_ENCODED=""
if [ -n "$BRANCH" ]; then
  BRANCH_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$BRANCH'))" 2>/dev/null || echo "$BRANCH")
fi

THREAD_RESPONSE=$(api_call GET "/threads/active/context?workspace=${WS_ENCODED}&branch=${BRANCH_ENCODED}") || true
if [ -n "$THREAD_RESPONSE" ]; then
  THREAD_CTX=$(echo "$THREAD_RESPONSE" | jq -r '.context // empty' 2>/dev/null) || true
  if [ -n "$THREAD_CTX" ] && [ "$THREAD_CTX" != "null" ]; then
    THREAD_CONTEXT="$THREAD_CTX"
  fi
fi

# If on a feature branch with no matching thread, instruct Claude to create one
if [ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ]; then
  # Check if a thread exists for this branch (any status)
  BRANCH_THREAD=$(api_call GET "/threads?workspace=${WS_ENCODED}&name=${BRANCH_ENCODED}" 2>/dev/null) || true
  BRANCH_THREAD_COUNT=$(echo "$BRANCH_THREAD" | jq -r '.threads | length' 2>/dev/null) || BRANCH_THREAD_COUNT=0
  if [ "$BRANCH_THREAD_COUNT" = "0" ] || [ -z "$BRANCH_THREAD_COUNT" ]; then
    NO_THREAD_MSG="<branch-thread-required branch=\"${BRANCH}\">
MANDATORY: You are on branch '${BRANCH}' but no feature thread exists for it.
You MUST create a feature thread BEFORE starting any work:

bash ${SCRIPT_DIR}/thread.sh start \"${BRANCH}\" \"<describe what this branch is for>\"

Then append findings, decisions, and context as you work:
bash ${SCRIPT_DIR}/thread.sh append \"${BRANCH}\" \"<what you learned>\" findings
bash ${SCRIPT_DIR}/thread.sh append \"${BRANCH}\" \"<decision made>\" decisions

This ensures context persists across sessions for this feature branch.
</branch-thread-required>"
    if [ -n "$THREAD_CONTEXT" ]; then
      THREAD_CONTEXT="${NO_THREAD_MSG}"$'\n'"${THREAD_CONTEXT}"
    else
      THREAD_CONTEXT="$NO_THREAD_MSG"
    fi
  fi
fi

# Search for recent and high-confidence memories for this workspace
BODY=$(jq -n \
  --arg ws "$WORKSPACE" \
  '{
    "workspace": $ws,
    "query": "project context preferences decisions patterns",
    "maxResults": 5,
    "minScore": 0.2,
    "includeGlobal": true,
    "searchMode": "hybrid"
  }')

RESPONSE=$(api_call POST /memories/search "$BODY") || safe_exit

CONTEXT=$(format_memories_xml "$RESPONSE") || true

# Inject last SESSION_SUMMARY for continuity
SUMMARY_BODY=$(jq -n \
  --arg ws "$WORKSPACE" \
  '{
    "workspace": $ws,
    "query": "session summary investigation decisions lessons",
    "maxResults": 1,
    "minScore": 0.1,
    "memoryTypes": ["SESSION_SUMMARY"],
    "includeGlobal": false,
    "searchMode": "hybrid"
  }')

SUMMARY_RESPONSE=$(api_call POST /memories/search "$SUMMARY_BODY") || true
SUMMARY_CONTEXT=""
if [ -n "$SUMMARY_RESPONSE" ]; then
  SUMMARY_COUNT=$(echo "$SUMMARY_RESPONSE" | jq -r '.results | length' 2>/dev/null) || SUMMARY_COUNT=0
  if [ "$SUMMARY_COUNT" != "0" ] && [ -n "$SUMMARY_COUNT" ]; then
    SUMMARY_CONTENT=$(echo "$SUMMARY_RESPONSE" | jq -r '.results[0].content // empty' 2>/dev/null) || true
    if [ -n "$SUMMARY_CONTENT" ]; then
      SUMMARY_CONTEXT="<last-session-summary>${SUMMARY_CONTENT}</last-session-summary>"
    fi
  fi
fi

# Skill discovery: search specifically for available skills
SKILL_BODY=$(jq -n \
  --arg ws "$WORKSPACE" \
  '{
    "workspace": $ws,
    "query": "available skills capabilities tools",
    "maxResults": 10,
    "minScore": 0.1,
    "memoryTypes": ["SKILL_HINT"],
    "includeGlobal": true,
    "searchMode": "hybrid"
  }')

SKILL_RESPONSE=$(api_call POST /memories/search "$SKILL_BODY") || true
SKILL_CONTEXT=$(format_memories_xml "$SKILL_RESPONSE") || true

# App knowledge: architecture, data flow, component roles, API contracts
APP_KNOWLEDGE_BODY=$(jq -n \
  --arg ws "$WORKSPACE" \
  '{
    "workspace": $ws,
    "query": "architecture data flow components API contracts business logic configuration",
    "maxResults": 8,
    "minScore": 0.15,
    "memoryTypes": ["APP_KNOWLEDGE"],
    "includeGlobal": false,
    "searchMode": "hybrid"
  }')

APP_KNOWLEDGE_RESPONSE=$(api_call POST /memories/search "$APP_KNOWLEDGE_BODY") || true
APP_KNOWLEDGE_CONTEXT=""
if [ -n "$APP_KNOWLEDGE_RESPONSE" ]; then
  APP_KNOWLEDGE_COUNT=$(echo "$APP_KNOWLEDGE_RESPONSE" | jq -r '.results | length' 2>/dev/null) || APP_KNOWLEDGE_COUNT=0
  if [ "$APP_KNOWLEDGE_COUNT" != "0" ] && [ -n "$APP_KNOWLEDGE_COUNT" ]; then
    APP_KNOWLEDGE_CONTEXT=$(format_memories_xml "$APP_KNOWLEDGE_RESPONSE") || true
  fi
fi

# Combine all contexts — thread context first (highest priority), then app knowledge
COMBINED=""
if [ -n "$THREAD_CONTEXT" ]; then
  COMBINED="$THREAD_CONTEXT"
fi
if [ -n "$APP_KNOWLEDGE_CONTEXT" ]; then
  COMBINED="<app-knowledge>The following memories describe the application you are building. Use this knowledge to inform all your work — architecture, data flow, component roles, and design decisions.</app-knowledge>"$'\n'"$APP_KNOWLEDGE_CONTEXT"
fi
if [ -n "$SUMMARY_CONTEXT" ]; then
  if [ -n "$COMBINED" ]; then
    COMBINED="${COMBINED}"$'\n'"${SUMMARY_CONTEXT}"
  else
    COMBINED="$SUMMARY_CONTEXT"
  fi
fi
if [ -n "$CONTEXT" ]; then
  if [ -n "$COMBINED" ]; then
    COMBINED="${COMBINED}"$'\n'"${CONTEXT}"
  else
    COMBINED="$CONTEXT"
  fi
fi
if [ -n "$SKILL_CONTEXT" ]; then
  if [ -n "$COMBINED" ]; then
    COMBINED="${COMBINED}"$'\n'"${SKILL_CONTEXT}"
  else
    COMBINED="$SKILL_CONTEXT"
  fi
fi

if [ -n "$COMBINED" ]; then
  hook_output "$COMBINED"
else
  echo '{}'
fi
