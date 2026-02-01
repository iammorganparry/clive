#!/usr/bin/env bash
# Agent-facing helper for superseding an old memory with a new one.
# The old memory is marked as superseded and will be excluded from future searches.
#
# Usage: bash supersede.sh OLD_MEMORY_ID NEW_MEMORY_ID
#
# Example:
#   bash supersede.sh abc123 def456
#
# This is typically called after remember.sh reports a near-duplicate.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

OLD_ID="${1:-}"
NEW_ID="${2:-}"

if [ -z "$OLD_ID" ] || [ -z "$NEW_ID" ]; then
  echo "Usage: bash supersede.sh OLD_MEMORY_ID NEW_MEMORY_ID" >&2
  exit 0
fi

if ! is_server_healthy; then
  echo "Memory server unavailable — skipping." >&2
  exit 0
fi

BODY=$(jq -n --arg newId "$NEW_ID" '{"newMemoryId": $newId}')

RESPONSE=$(api_call POST "/memories/${OLD_ID}/supersede" "$BODY") || {
  echo "Failed to supersede memory — continuing." >&2
  exit 0
}

# Check for success
SUPERSEDED=$(echo "$RESPONSE" | jq -r '.supersededId // empty' 2>/dev/null) || true
if [ -n "$SUPERSEDED" ]; then
  echo "Memory ${OLD_ID} superseded by ${NEW_ID}."
else
  ERROR=$(echo "$RESPONSE" | jq -r '.error // empty' 2>/dev/null) || true
  echo "Supersede failed: ${ERROR:-unknown error}" >&2
fi
