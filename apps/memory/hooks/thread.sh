#!/usr/bin/env bash
# Agent-facing helper for managing feature threads.
# Threads provide persistent working context across multiple Claude Code sessions.
#
# Usage:
#   bash thread.sh start  "feature-name" "description"
#   bash thread.sh append "feature-name" "content" [section] [memory_type]
#   bash thread.sh list
#   bash thread.sh status "feature-name"
#   bash thread.sh close  "feature-name" [--distill]
#   bash thread.sh pause  "feature-name"
#   bash thread.sh resume "feature-name"
#
# Sections: findings | decisions | architecture | todo | context (default)
# Memory types: GOTCHA | DECISION | PATTERN | WORKING_SOLUTION | CONTEXT (default) | APP_KNOWLEDGE

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

COMMAND="${1:-}"
NAME="${2:-}"

# Check server health
if ! is_server_healthy; then
  echo "Memory server unavailable — skipping." >&2
  exit 0
fi

WORKSPACE="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Default NAME to current git branch if not provided
if [ -z "$NAME" ] && [ "$COMMAND" != "list" ] && [ "$COMMAND" != "" ]; then
  NAME=$(get_branch "$WORKSPACE")
  if [ -n "$NAME" ]; then
    echo "(Using current branch: ${NAME})" >&2
  fi
fi

# URL-encode a string for query params
urlencode() {
  local string="$1"
  python3 -c "import urllib.parse; print(urllib.parse.quote('$string'))" 2>/dev/null \
    || echo "$string"
}

case "$COMMAND" in
  start)
    DESCRIPTION="${3:-}"
    if [ -z "$NAME" ]; then
      echo "Usage: bash thread.sh start [feature-name] [description]" >&2
      echo "  (Defaults to current git branch if name is omitted)" >&2
      exit 0
    fi
    # Default description to branch name if not provided
    if [ -z "$DESCRIPTION" ]; then
      DESCRIPTION="Feature thread for branch: ${NAME}"
    fi

    BODY=$(jq -n \
      --arg ws "$WORKSPACE" \
      --arg name "$NAME" \
      --arg desc "$DESCRIPTION" \
      '{
        "workspace": $ws,
        "name": $name,
        "description": $desc
      }')

    RESPONSE=$(api_call POST /threads "$BODY") || {
      echo "Failed to create thread." >&2
      exit 0
    }

    THREAD_ID=$(echo "$RESPONSE" | jq -r '.id // empty' 2>/dev/null) || true
    if [ -n "$THREAD_ID" ]; then
      echo "Created feature thread: ${NAME} (${THREAD_ID})"
    else
      ERROR=$(echo "$RESPONSE" | jq -r '.error // empty' 2>/dev/null) || true
      echo "Failed to create thread: ${ERROR:-unknown error}" >&2
    fi
    ;;

  append)
    CONTENT="${3:-}"
    SECTION="${4:-context}"
    MEMORY_TYPE="${5:-CONTEXT}"

    if [ -z "$NAME" ] || [ -z "$CONTENT" ]; then
      echo "Usage: bash thread.sh append \"feature-name\" \"content\" [section] [memory_type]" >&2
      exit 0
    fi

    # Find thread by listing and filtering by name
    WS_ENCODED=$(urlencode "$WORKSPACE")
    LIST_RESPONSE=$(api_call GET "/threads?workspace=${WS_ENCODED}&status=active") || {
      echo "Failed to list threads." >&2
      exit 0
    }

    THREAD_ID=$(echo "$LIST_RESPONSE" | jq -r --arg name "$NAME" '.threads[] | select(.name == $name) | .id' 2>/dev/null | head -1) || true

    # Also check paused threads
    if [ -z "$THREAD_ID" ]; then
      LIST_PAUSED=$(api_call GET "/threads?workspace=${WS_ENCODED}&status=paused") || true
      THREAD_ID=$(echo "$LIST_PAUSED" | jq -r --arg name "$NAME" '.threads[] | select(.name == $name) | .id' 2>/dev/null | head -1) || true
    fi

    if [ -z "$THREAD_ID" ]; then
      echo "Thread '${NAME}' not found. Create it first with: bash thread.sh start \"${NAME}\" \"description\"" >&2
      exit 0
    fi

    BODY=$(jq -n \
      --arg ws "$WORKSPACE" \
      --arg content "$CONTENT" \
      --arg section "$SECTION" \
      --arg mtype "$MEMORY_TYPE" \
      '{
        "workspace": $ws,
        "content": $content,
        "section": $section,
        "memoryType": $mtype
      }')

    RESPONSE=$(api_call POST "/threads/${THREAD_ID}/entries" "$BODY") || {
      echo "Failed to append entry." >&2
      exit 0
    }

    SEQ=$(echo "$RESPONSE" | jq -r '.sequence // empty' 2>/dev/null) || true
    if [ -n "$SEQ" ]; then
      echo "Appended to thread '${NAME}' [${SECTION}] (seq: ${SEQ})"
    else
      ERROR=$(echo "$RESPONSE" | jq -r '.error // empty' 2>/dev/null) || true
      echo "Failed to append: ${ERROR:-unknown error}" >&2
    fi
    ;;

  list)
    WS_ENCODED=$(urlencode "$WORKSPACE")
    RESPONSE=$(api_call GET "/threads?workspace=${WS_ENCODED}") || {
      echo "Failed to list threads." >&2
      exit 0
    }

    COUNT=$(echo "$RESPONSE" | jq -r '.threads | length' 2>/dev/null) || COUNT=0
    if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
      echo "No feature threads found."
      exit 0
    fi

    echo "Feature Threads:"
    echo "$RESPONSE" | jq -r '.threads[] | "  [\(.status)] \(.name) — \(.description) (\(.entryCount) entries, updated: \(.updatedAt | todate))"' 2>/dev/null
    ;;

  status)
    if [ -z "$NAME" ]; then
      echo "Usage: bash thread.sh status \"feature-name\"" >&2
      exit 0
    fi

    WS_ENCODED=$(urlencode "$WORKSPACE")
    LIST_RESPONSE=$(api_call GET "/threads?workspace=${WS_ENCODED}") || {
      echo "Failed to list threads." >&2
      exit 0
    }

    THREAD_ID=$(echo "$LIST_RESPONSE" | jq -r --arg name "$NAME" '.threads[] | select(.name == $name) | .id' 2>/dev/null | head -1) || true

    if [ -z "$THREAD_ID" ]; then
      echo "Thread '${NAME}' not found." >&2
      exit 0
    fi

    RESPONSE=$(api_call GET "/threads/${THREAD_ID}") || {
      echo "Failed to get thread." >&2
      exit 0
    }

    echo "$RESPONSE" | jq '{
      name: .name,
      status: .status,
      description: .description,
      entryCount: .entryCount,
      summary: .summary,
      tags: .tags,
      entries: [.entries[] | {seq: .sequence, section: .section, type: .memoryType, content: (.content | if length > 80 then .[:80] + "..." else . end)}]
    }' 2>/dev/null
    ;;

  close)
    DISTILL_FLAG="${3:-}"
    if [ -z "$NAME" ]; then
      echo "Usage: bash thread.sh close \"feature-name\" [--distill]" >&2
      exit 0
    fi

    WS_ENCODED=$(urlencode "$WORKSPACE")
    LIST_RESPONSE=$(api_call GET "/threads?workspace=${WS_ENCODED}") || {
      echo "Failed to list threads." >&2
      exit 0
    }

    THREAD_ID=$(echo "$LIST_RESPONSE" | jq -r --arg name "$NAME" '.threads[] | select(.name == $name) | .id' 2>/dev/null | head -1) || true

    if [ -z "$THREAD_ID" ]; then
      echo "Thread '${NAME}' not found." >&2
      exit 0
    fi

    DISTILL="false"
    if [ "$DISTILL_FLAG" = "--distill" ]; then
      DISTILL="true"
    fi

    BODY=$(jq -n --argjson distill "$DISTILL" '{"distill": $distill}')
    RESPONSE=$(api_call POST "/threads/${THREAD_ID}/close" "$BODY") || {
      echo "Failed to close thread." >&2
      exit 0
    }

    STATUS=$(echo "$RESPONSE" | jq -r '.status // empty' 2>/dev/null) || true
    DISTILLED=$(echo "$RESPONSE" | jq -r '.distilledMemories | length // 0' 2>/dev/null) || DISTILLED=0

    echo "Thread '${NAME}' closed (status: ${STATUS})."
    if [ "$DISTILLED" != "0" ] && [ -n "$DISTILLED" ]; then
      echo "  Distilled ${DISTILLED} permanent memories from thread entries."
    fi
    ;;

  pause)
    if [ -z "$NAME" ]; then
      echo "Usage: bash thread.sh pause \"feature-name\"" >&2
      exit 0
    fi

    WS_ENCODED=$(urlencode "$WORKSPACE")
    LIST_RESPONSE=$(api_call GET "/threads?workspace=${WS_ENCODED}&status=active") || {
      echo "Failed to list threads." >&2
      exit 0
    }

    THREAD_ID=$(echo "$LIST_RESPONSE" | jq -r --arg name "$NAME" '.threads[] | select(.name == $name) | .id' 2>/dev/null | head -1) || true

    if [ -z "$THREAD_ID" ]; then
      echo "Active thread '${NAME}' not found." >&2
      exit 0
    fi

    BODY='{"status":"paused"}'
    api_call PATCH "/threads/${THREAD_ID}" "$BODY" >/dev/null 2>&1

    echo "Thread '${NAME}' paused."
    ;;

  resume)
    if [ -z "$NAME" ]; then
      echo "Usage: bash thread.sh resume \"feature-name\"" >&2
      exit 0
    fi

    WS_ENCODED=$(urlencode "$WORKSPACE")
    LIST_RESPONSE=$(api_call GET "/threads?workspace=${WS_ENCODED}&status=paused") || {
      echo "Failed to list threads." >&2
      exit 0
    }

    THREAD_ID=$(echo "$LIST_RESPONSE" | jq -r --arg name "$NAME" '.threads[] | select(.name == $name) | .id' 2>/dev/null | head -1) || true

    if [ -z "$THREAD_ID" ]; then
      echo "Paused thread '${NAME}' not found." >&2
      exit 0
    fi

    BODY='{"status":"active"}'
    api_call PATCH "/threads/${THREAD_ID}" "$BODY" >/dev/null 2>&1

    echo "Thread '${NAME}' resumed."
    ;;

  *)
    echo "Usage: bash thread.sh <command> [args...]"
    echo ""
    echo "Commands:"
    echo "  start   \"name\" \"description\"              Create a new feature thread"
    echo "  append  \"name\" \"content\" [section] [type] Add an entry to a thread"
    echo "  list                                        List all threads"
    echo "  status  \"name\"                             Show thread details"
    echo "  close   \"name\" [--distill]                 Close a thread"
    echo "  pause   \"name\"                             Pause a thread"
    echo "  resume  \"name\"                             Resume a paused thread"
    echo ""
    echo "Sections: findings | decisions | architecture | todo | context (default)"
    echo "Types: GOTCHA | DECISION | PATTERN | WORKING_SOLUTION | CONTEXT (default) | APP_KNOWLEDGE"
    ;;
esac
