#!/usr/bin/env bash
# Agent-facing helper for storing memories with minimal friction.
# Usage: bash remember.sh TYPE "content" "tag1,tag2" [CONFIDENCE] [file1,file2]
#
# Types: GOTCHA | WORKING_SOLUTION | DECISION | PATTERN | FAILURE | PREFERENCE | CONTEXT | APP_KNOWLEDGE
# Confidence: 0.9+=proven, 0.7-0.8=confident, 0.5-0.6=uncertain (default: 0.8)
# Files: comma-separated workspace-relative paths (optional)
#
# Examples:
#   bash remember.sh GOTCHA "SQLite FTS5 requires -tags sqlite_fts5 build flag" "sqlite,build" 0.95
#   bash remember.sh DECISION "Chose hybrid search over pure vector" "search,architecture" 0.85
#   bash remember.sh GOTCHA "Effect pipe requires explicit type" "effect,ts" 0.9 "src/services/foo.ts,src/utils/bar.ts"

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

VALID_TYPES="GOTCHA WORKING_SOLUTION DECISION PATTERN FAILURE PREFERENCE CONTEXT APP_KNOWLEDGE"

MEMORY_TYPE="${1:-}"
CONTENT="${2:-}"
TAGS_CSV="${3:-}"
CONFIDENCE="${4:-0.8}"
RELATED_FILES_CSV="${5:-}"

# Validate arguments
if [ -z "$MEMORY_TYPE" ] || [ -z "$CONTENT" ]; then
  echo "Usage: bash remember.sh TYPE \"content\" \"tag1,tag2\" [CONFIDENCE] [file1,file2]" >&2
  echo "Types: $VALID_TYPES" >&2
  exit 0
fi

# Validate memory type
if ! echo "$VALID_TYPES" | grep -qw "$MEMORY_TYPE"; then
  echo "Invalid memory type: $MEMORY_TYPE" >&2
  echo "Valid types: $VALID_TYPES" >&2
  exit 0
fi

# Check server health
if ! is_server_healthy; then
  echo "Memory server unavailable — skipping." >&2
  exit 0
fi

# Detect workspace and session
WORKSPACE="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"

# Always append "agent-created" tag
if [ -n "$TAGS_CSV" ]; then
  TAGS_CSV="${TAGS_CSV},agent-created"
else
  TAGS_CSV="agent-created"
fi

# Build related files JSON array (strip workspace prefix, convert CSV to JSON)
RELATED_FILES_JSON="[]"
if [ -n "$RELATED_FILES_CSV" ]; then
  RELATED_FILES_JSON=$(echo "$RELATED_FILES_CSV" | tr ',' '\n' | while IFS= read -r fpath; do
    # Strip workspace prefix if present
    fpath="${fpath#"$WORKSPACE/"}"
    echo "$fpath"
  done | jq -R . | jq -s '.')
fi

# Feature 2: Auto-detect encoding context
ENCODING_CTX=$(detect_encoding_context "$WORKSPACE" 2>/dev/null) || ENCODING_CTX=""

# Store the memory
RESPONSE=$(store_memory "$WORKSPACE" "$SESSION_ID" "$MEMORY_TYPE" "$CONTENT" "$CONFIDENCE" "agent" "$TAGS_CSV" "$RELATED_FILES_JSON" "$ENCODING_CTX") || {
  echo "Failed to store memory — continuing." >&2
  exit 0
}

# Check response for ID (success) or dedup signal
MEMORY_ID=$(echo "$RESPONSE" | jq -r '.id // empty' 2>/dev/null) || true

if [ -n "$MEMORY_ID" ]; then
  echo "Stored ${MEMORY_TYPE} memory: ${MEMORY_ID}"

  # Feature 3: Check for near-duplicate and inform the agent
  NEAR_DUP_ID=$(echo "$RESPONSE" | jq -r '.nearDuplicateId // empty' 2>/dev/null) || true
  NEAR_DUP_SIM=$(echo "$RESPONSE" | jq -r '.nearDupSimilarity // empty' 2>/dev/null) || true
  if [ -n "$NEAR_DUP_ID" ]; then
    echo "  Near-duplicate detected: ${NEAR_DUP_ID} (similarity: ${NEAR_DUP_SIM})"
    echo "  If this replaces the old memory, run:"
    echo "    bash ${SCRIPT_DIR}/supersede.sh ${NEAR_DUP_ID} ${MEMORY_ID}"
  fi
else
  # Check if the server returned a dedup/exists indicator
  EXISTS=$(echo "$RESPONSE" | jq -r '.exists // .deduplicated // empty' 2>/dev/null) || true
  if [ "$EXISTS" = "true" ]; then
    echo "Memory already exists (deduplicated)."
  else
    echo "Stored ${MEMORY_TYPE} memory."
  fi
fi
