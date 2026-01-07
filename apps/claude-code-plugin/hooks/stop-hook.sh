#!/bin/bash
#
# Clive Test Loop - Stop Hook
#
# This hook implements the Ralph Wiggum loop pattern:
# - Intercepts Claude's attempt to exit
# - Checks if all test suites are complete
# - If not complete, re-injects the test command to continue
#
# Usage: Automatically triggered when Claude tries to stop
# The hook reads transcript from stdin and outputs the next prompt

set -euo pipefail

STATE_FILE=".claude/.test-loop-state"
PLAN_PATH_FILE=".claude/.test-plan-path"
MAX_ITERATIONS_FILE=".claude/.test-max-iterations"

# Read max iterations: config file > env var > default (50)
if [ -f "$MAX_ITERATIONS_FILE" ]; then
    MAX_ITERATIONS=$(cat "$MAX_ITERATIONS_FILE")
elif [ -n "$CLIVE_MAX_ITERATIONS" ]; then
    MAX_ITERATIONS="$CLIVE_MAX_ITERATIONS"
else
    MAX_ITERATIONS=50
fi

# Resolve plan file dynamically
# Priority: stored path > latest symlink > any plan file > default
resolve_plan_file() {
    if [ -f "$PLAN_PATH_FILE" ]; then
        cat "$PLAN_PATH_FILE"
    elif [ -f ".claude/test-plan-latest.md" ]; then
        # Resolve symlink
        local target=$(readlink .claude/test-plan-latest.md 2>/dev/null || echo "test-plan-latest.md")
        echo ".claude/$target"
    elif ls .claude/test-plan-*.md 1>/dev/null 2>&1; then
        # Use most recent plan file
        ls -t .claude/test-plan-*.md 2>/dev/null | head -1
    else
        echo ".claude/test-plan.md"
    fi
}

PLAN_FILE=$(resolve_plan_file)

# Read the transcript from stdin
TRANSCRIPT=$(cat)

# Helper to clean up state files
cleanup_state() {
    rm -f "$STATE_FILE" "$PLAN_PATH_FILE" "$MAX_ITERATIONS_FILE"
}

# === STOP CONDITION 1: All suites complete ===
if echo "$TRANSCRIPT" | grep -q "<promise>ALL_SUITES_COMPLETE</promise>"; then
    echo "[STOP] All suites complete - test loop finished successfully" >&2
    cleanup_state
    exit 0  # Allow normal exit
fi

# === STOP CONDITION 2: User cancellation ===
if [ -f ".claude/.cancel-test-loop" ]; then
    rm -f ".claude/.cancel-test-loop"
    cleanup_state
    echo "[STOP] User cancelled test loop via /clive cancel" >&2
    exit 0  # Allow normal exit
fi

# === STOP CONDITION 3: Plan file missing ===
if [ ! -f "$PLAN_FILE" ]; then
    echo "[STOP] Plan file not found at $PLAN_FILE" >&2
    cleanup_state
    exit 0  # Allow normal exit
fi

# Track iterations
CURRENT_ITERATION=1
if [ -f "$STATE_FILE" ]; then
    CURRENT_ITERATION=$(cat "$STATE_FILE")
    CURRENT_ITERATION=$((CURRENT_ITERATION + 1))
fi

# === STOP CONDITION 4: Max iterations reached ===
if [ "$CURRENT_ITERATION" -ge "$MAX_ITERATIONS" ]; then
    echo "[STOP] Max iterations reached ($CURRENT_ITERATION/$MAX_ITERATIONS)" >&2
    cleanup_state
    exit 0  # Allow normal exit
fi

# Count pending suites
PENDING_COUNT=$(grep -c '\- \[ \] \*\*Status:\*\* pending' "$PLAN_FILE" 2>/dev/null || echo "0")
IN_PROGRESS_COUNT=$(grep -c '\- \[ \] \*\*Status:\*\* in_progress' "$PLAN_FILE" 2>/dev/null || echo "0")
REMAINING=$((PENDING_COUNT + IN_PROGRESS_COUNT))

# === STOP CONDITION 5: No remaining work ===
if [ "$REMAINING" -eq 0 ]; then
    echo "[STOP] All suites processed (0 pending, 0 in_progress)" >&2
    cleanup_state
    exit 0  # Allow normal exit
fi

# Save current iteration
mkdir -p "$(dirname "$STATE_FILE")"
echo "$CURRENT_ITERATION" > "$STATE_FILE"

# Log progress
echo "Iteration $CURRENT_ITERATION/$MAX_ITERATIONS - $REMAINING suites remaining (plan: $PLAN_FILE)" >&2

# Block exit and continue the loop using official JSON format
# Exit code 0 with decision:block tells Claude Code to continue
cat <<EOF
{
  "decision": "block",
  "reason": "Continue implementing tests from $PLAN_FILE. $REMAINING test suites remaining ($CURRENT_ITERATION/$MAX_ITERATIONS iterations). Run the next pending suite."
}
EOF
exit 0
