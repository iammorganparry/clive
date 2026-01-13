#!/bin/bash
#
# Clive Build Loop - Stop Hook
#
# This hook implements the Ralph Wiggum loop pattern:
# - Intercepts Claude's attempt to exit
# - Checks if all tasks are complete
# - If not complete, re-injects the build command to continue
#
# Supports both generic markers (ALL_TASKS_COMPLETE) and legacy test markers
#
# Usage: Automatically triggered when Claude tries to stop
# The hook reads transcript from stdin and outputs the next prompt

set -euo pipefail

STATE_FILE=".claude/.test-loop-state"
PLAN_PATH_FILE=".claude/.test-plan-path"
MAX_ITERATIONS_FILE=".claude/.test-max-iterations"

# Helper to clean up state files (defined early for use throughout)
cleanup_state() {
    rm -f "$STATE_FILE" "$PLAN_PATH_FILE" "$MAX_ITERATIONS_FILE"
}

# Read max iterations: config file > env var > default (50)
if [ -f "$MAX_ITERATIONS_FILE" ]; then
    MAX_ITERATIONS=$(cat "$MAX_ITERATIONS_FILE")
elif [ -n "${CLIVE_MAX_ITERATIONS:-}" ]; then
    MAX_ITERATIONS="$CLIVE_MAX_ITERATIONS"
else
    MAX_ITERATIONS=50
fi

# Resolve plan file dynamically (supports work-plan and legacy test-plan naming)
# Priority: stored path > latest symlink > any plan file > default
resolve_plan_file() {
    if [ -f "$PLAN_PATH_FILE" ]; then
        cat "$PLAN_PATH_FILE"
    # New naming: work-plan-*
    elif [ -f ".claude/work-plan-latest.md" ]; then
        local target=$(readlink .claude/work-plan-latest.md 2>/dev/null || echo "work-plan-latest.md")
        echo ".claude/$target"
    elif ls .claude/work-plan-*.md 1>/dev/null 2>&1; then
        ls -t .claude/work-plan-*.md 2>/dev/null | head -1
    # Legacy naming: test-plan-* (backwards compatibility)
    elif [ -f ".claude/test-plan-latest.md" ]; then
        local target=$(readlink .claude/test-plan-latest.md 2>/dev/null || echo "test-plan-latest.md")
        echo ".claude/$target"
    elif ls .claude/test-plan-*.md 1>/dev/null 2>&1; then
        ls -t .claude/test-plan-*.md 2>/dev/null | head -1
    else
        echo ".claude/work-plan.md"
    fi
}

PLAN_FILE=$(resolve_plan_file)

# Read JSON input from stdin (Claude Code passes metadata including transcript_path)
INPUT_JSON=$(cat)

# Extract transcript path from JSON input
TRANSCRIPT_PATH=$(echo "$INPUT_JSON" | jq -r '.transcript_path // empty' 2>/dev/null)

# Validate transcript file exists (matches official ralph-loop pattern)
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
    echo "⚠️  Clive: Transcript file not found" >&2
    echo "   Expected: $TRANSCRIPT_PATH" >&2
    echo "   This is unusual and may indicate a Claude Code internal issue." >&2
    echo "   Test loop is stopping." >&2
    cleanup_state
    exit 0
fi

# Read the transcript file
TRANSCRIPT=$(cat "$TRANSCRIPT_PATH")

# Validate transcript has assistant messages (matches official ralph-loop pattern)
if ! echo "$TRANSCRIPT" | grep -q '"role":"assistant"'; then
    echo "⚠️  Clive: No assistant messages found in transcript" >&2
    echo "   Transcript: $TRANSCRIPT_PATH" >&2
    echo "   This is unusual and may indicate a transcript format issue" >&2
    echo "   Test loop is stopping." >&2
    cleanup_state
    exit 0
fi

# === STOP CONDITION 1: All tasks complete (generic and legacy markers) ===
if echo "$TRANSCRIPT" | grep -q "<promise>ALL_TASKS_COMPLETE</promise>"; then
    echo "[STOP] All tasks complete - build loop finished successfully" >&2
    cleanup_state
    exit 0  # Allow normal exit
fi

# Legacy marker for backwards compatibility
if echo "$TRANSCRIPT" | grep -q "<promise>ALL_SUITES_COMPLETE</promise>"; then
    echo "[STOP] All suites complete (legacy marker) - build loop finished successfully" >&2
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
    STORED_ITERATION=$(cat "$STATE_FILE")
    # Validate numeric field before arithmetic (matches official ralph-loop pattern)
    if [[ ! "$STORED_ITERATION" =~ ^[0-9]+$ ]]; then
        echo "⚠️  Clive: State file corrupted" >&2
        echo "   File: $STATE_FILE" >&2
        echo "   Problem: iteration value is not a valid number (got: '$STORED_ITERATION')" >&2
        echo "" >&2
        echo "   This usually means the state file was manually edited or corrupted." >&2
        echo "   Test loop is stopping. Run /clive test again to start fresh." >&2
        cleanup_state
        exit 0
    fi
    CURRENT_ITERATION=$((STORED_ITERATION + 1))
fi

# === STOP CONDITION 4: Max iterations reached ===
if [ "$CURRENT_ITERATION" -ge "$MAX_ITERATIONS" ]; then
    echo "[STOP] Max iterations reached ($CURRENT_ITERATION/$MAX_ITERATIONS)" >&2
    cleanup_state
    exit 0  # Allow normal exit
fi

# Count pending tasks from plan file
PENDING_COUNT=$(grep -c '\- \[ \] \*\*Status:\*\* pending' "$PLAN_FILE" 2>/dev/null || echo "0")
IN_PROGRESS_COUNT=$(grep -c '\- \[ \] \*\*Status:\*\* in_progress' "$PLAN_FILE" 2>/dev/null || echo "0")
BLOCKED_COUNT=$(grep -c '\- \[ \] \*\*Status:\*\* blocked' "$PLAN_FILE" 2>/dev/null || echo "0")
REMAINING=$((PENDING_COUNT + IN_PROGRESS_COUNT))

# If beads is available, also check beads status for more accurate tracking
BEADS_AVAILABLE=false
NEXT_TASK_SKILL=""
if command -v bd &> /dev/null && [ -d ".beads" ]; then
    BEADS_AVAILABLE=true
    BEADS_PENDING=$(bd list --status pending --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
    BEADS_IN_PROGRESS=$(bd list --status in_progress --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
    BEADS_REMAINING=$((BEADS_PENDING + BEADS_IN_PROGRESS))

    # Get next task and its skill for the prompt
    NEXT_TASK=$(bd ready --json 2>/dev/null | jq -r '.[0] // empty' 2>/dev/null)
    if [ -n "$NEXT_TASK" ] && [ "$NEXT_TASK" != "null" ]; then
        NEXT_TASK_SKILL=$(echo "$NEXT_TASK" | jq -r '.labels[]? // empty' 2>/dev/null | grep '^skill:' | cut -d: -f2 | head -1)
        NEXT_TASK_TITLE=$(echo "$NEXT_TASK" | jq -r '.title // empty' 2>/dev/null)
    fi

    # Use beads count if it's available (more accurate than grep parsing)
    if [ "$BEADS_REMAINING" -ge 0 ] 2>/dev/null; then
        echo "Beads tracking: $BEADS_REMAINING remaining ($BEADS_PENDING pending, $BEADS_IN_PROGRESS in_progress)" >&2
    fi
fi

# === STOP CONDITION 5: Task is blocked (needs user intervention) ===
if [ "$BLOCKED_COUNT" -gt 0 ]; then
    echo "[STOP] Task blocked - waiting for user intervention" >&2
    # Don't cleanup state - user may want to continue after fixing
    exit 0  # Allow normal exit
fi

# === STOP CONDITION 6: No remaining work ===
if [ "$REMAINING" -eq 0 ]; then
    echo "[STOP] All tasks processed (0 pending, 0 in_progress)" >&2
    cleanup_state
    exit 0  # Allow normal exit
fi

# Save current iteration
mkdir -p "$(dirname "$STATE_FILE")"
echo "$CURRENT_ITERATION" > "$STATE_FILE"

# Log progress
if [ "$BEADS_AVAILABLE" = true ]; then
    echo "Iteration $CURRENT_ITERATION/$MAX_ITERATIONS - $REMAINING tasks remaining (plan: $PLAN_FILE, beads: $BEADS_REMAINING)" >&2
else
    echo "Iteration $CURRENT_ITERATION/$MAX_ITERATIONS - $REMAINING tasks remaining (plan: $PLAN_FILE)" >&2
fi

# Build skill-aware prompt for re-injection
SKILL_CONTEXT=""
if [ -n "$NEXT_TASK_SKILL" ]; then
    SKILL_CONTEXT="
Skill: $NEXT_TASK_SKILL (load skill file from skills/${NEXT_TASK_SKILL}.md)"
fi

if [ -n "$NEXT_TASK_TITLE" ]; then
    TASK_CONTEXT="
Next task: $NEXT_TASK_TITLE$SKILL_CONTEXT"
else
    TASK_CONTEXT=""
fi

# Block exit and continue the loop using official Ralph pattern
# "reason" contains the actual prompt to execute (becomes next user message)
# "systemMessage" provides iteration context
PROMPT="Process exactly ONE task from the plan at $PLAN_FILE:
$TASK_CONTEXT
1. Find the first task with status 'pending' or 'in_progress'
2. Load the skill file for this task type
3. Execute the task following skill instructions
4. Mark it as 'complete' (if verified) or 'blocked' (if stuck)
5. If you discover out-of-scope work, create a beads task (see Discovered Work Protocol in skill file)
6. Output a brief progress summary
7. STOP - do not continue to the next task

The loop will automatically restart for the next task."
SYSTEM_MSG="🔄 Iteration $CURRENT_ITERATION/$MAX_ITERATIONS - $REMAINING tasks remaining. Process ONE task then STOP."

# Output JSON using jq for safe escaping (matches official ralph-loop pattern)
jq -n \
  --arg prompt "$PROMPT" \
  --arg msg "$SYSTEM_MSG" \
  '{
    "decision": "block",
    "reason": $prompt,
    "systemMessage": $msg
  }'

exit 0
