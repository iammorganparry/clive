#!/usr/bin/env bash
# Agent-facing helper for signaling memory impact or promoting to long-term.
# Usage: bash promote.sh MEMORY_ID [helpful|promoted|cited]
#
# Signals:
#   helpful  - The memory was useful during this session (+0.15 impact)
#   promoted - Promote to permanent long-term storage (+0.25 impact)
#   cited    - The memory was referenced/cited (+0.10 impact)
#
# Examples:
#   bash promote.sh abc-123 helpful
#   bash promote.sh abc-123 promoted

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

MEMORY_ID="${1:-}"
SIGNAL="${2:-helpful}"
VALID_SIGNALS="helpful promoted cited"

# Validate arguments
if [ -z "$MEMORY_ID" ]; then
  echo "Usage: bash promote.sh MEMORY_ID [helpful|promoted|cited]" >&2
  exit 0
fi

# Validate signal
if ! echo "$VALID_SIGNALS" | grep -qw "$SIGNAL"; then
  echo "Invalid signal: $SIGNAL" >&2
  echo "Valid signals: $VALID_SIGNALS" >&2
  exit 0
fi

# Check server health
if ! is_server_healthy; then
  echo "Memory server unavailable — skipping." >&2
  exit 0
fi

SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"

# Record impact signal
BODY=$(jq -n \
  --arg signal "$SIGNAL" \
  --arg source "agent" \
  --arg session "$SESSION_ID" \
  '{
    "signal": $signal,
    "source": $source,
    "sessionId": $session
  }')

RESPONSE=$(api_call POST "/memories/${MEMORY_ID}/impact" "$BODY") || {
  echo "Failed to record impact — continuing." >&2
  exit 0
}

IMPACT_SCORE=$(echo "$RESPONSE" | jq -r '.impactScore // empty' 2>/dev/null) || true
PROMOTED=$(echo "$RESPONSE" | jq -r '.promoted // empty' 2>/dev/null) || true

if [ "$PROMOTED" = "true" ]; then
  echo "Promoted memory ${MEMORY_ID} to long-term (impact: ${IMPACT_SCORE})"
elif [ -n "$IMPACT_SCORE" ]; then
  echo "Recorded ${SIGNAL} signal on ${MEMORY_ID} (impact: ${IMPACT_SCORE})"
else
  echo "Recorded ${SIGNAL} signal on ${MEMORY_ID}"
fi
