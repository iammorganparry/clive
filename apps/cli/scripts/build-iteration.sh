#!/bin/bash
# Build iteration - Runs a SINGLE iteration of the build loop
# The TUI controls the loop and spawns this script for each iteration
# This allows fresh stdin pipes per iteration for bidirectional communication
#
# Usage: ./build-iteration.sh --iteration N [--epic EPIC_ID] [--skill SKILL] [extra context]
#
# Exit codes:
#   0 = Task complete, continue to next iteration
#   10 = All tasks complete, stop looping
#   1 = Error

set -e

# Resolve symlinks to get the real script directory
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

PLUGIN_DIR="$SCRIPT_DIR/../../claude-code-plugin"
SKILLS_DIR="$PLUGIN_DIR/skills"
PROGRESS_FILE=".claude/progress.txt"

# Completion markers
COMPLETION_MARKER="<promise>ALL_TASKS_COMPLETE</promise>"
TASK_COMPLETE_MARKER="<promise>TASK_COMPLETE</promise>"
LEGACY_ALL_COMPLETE="<promise>ALL_SUITES_COMPLETE</promise>"

# Defaults
ITERATION=1
MAX_ITERATIONS=50
SKILL_OVERRIDE=""
EPIC_FILTER=""
EXTRA_CONTEXT=""
STREAMING=false

# Check for jq
if ! command -v jq &>/dev/null; then
    BEADS_AVAILABLE=false
elif command -v bd &>/dev/null && [ -d ".beads" ]; then
    BEADS_AVAILABLE=true
else
    BEADS_AVAILABLE=false
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --iteration)
            ITERATION="$2"
            shift 2
            ;;
        --max-iterations)
            MAX_ITERATIONS="$2"
            shift 2
            ;;
        --skill)
            SKILL_OVERRIDE="$2"
            shift 2
            ;;
        --epic)
            EPIC_FILTER="$2"
            shift 2
            ;;
        --streaming)
            STREAMING=true
            shift
            ;;
        *)
            EXTRA_CONTEXT="$EXTRA_CONTEXT $1"
            shift
            ;;
    esac
done

# Resolve plan file
resolve_plan_file() {
    if [ -f ".claude/work-plan-latest.md" ]; then
        readlink -f ".claude/work-plan-latest.md" 2>/dev/null || echo ".claude/work-plan-latest.md"
    elif ls .claude/work-plan-*.md 1>/dev/null 2>&1; then
        ls -t .claude/work-plan-*.md 2>/dev/null | head -1
    elif [ -f ".claude/test-plan-latest.md" ]; then
        readlink -f ".claude/test-plan-latest.md" 2>/dev/null || echo ".claude/test-plan-latest.md"
    elif ls .claude/test-plan-*.md 1>/dev/null 2>&1; then
        ls -t .claude/test-plan-*.md 2>/dev/null | head -1
    else
        echo ".claude/work-plan.md"
    fi
}

PLAN_FILE=$(resolve_plan_file)

# Validate plan exists
if [ ! -f "$PLAN_FILE" ]; then
    echo "❌ No plan found at $PLAN_FILE" >&2
    exit 1
fi

# Verify skills directory
if [ ! -d "$SKILLS_DIR" ]; then
    echo "❌ Skills directory not found at $SKILLS_DIR" >&2
    exit 1
fi

# Ensure .claude directory exists
mkdir -p .claude

# Initialize progress file if needed
if [ ! -f "$PROGRESS_FILE" ]; then
    echo "# Work Execution Progress" > "$PROGRESS_FILE"
    echo "Started: $(date -Iseconds)" >> "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
fi

# Write state files for TUI
echo "$PLAN_FILE" > .claude/.build-plan-path
echo "$ITERATION" > .claude/.build-iteration
echo "$MAX_ITERATIONS" > .claude/.build-max-iterations

# Function to extract skill from beads task
get_task_skill() {
    local task_json="$1"
    local skill=""
    if [ -n "$task_json" ]; then
        skill=$(echo "$task_json" | jq -r '.labels[]? // empty' 2>/dev/null | grep '^skill:' | cut -d: -f2 | head -1)
    fi
    if [ -z "$skill" ] && [ -n "$task_json" ]; then
        skill=$(echo "$task_json" | jq -r '.description // empty' 2>/dev/null | sed -n 's/.*\*\*Skill:\*\* \([a-zA-Z0-9_-]*\).*/\1/p' | head -1)
    fi
    if [ -z "$skill" ]; then
        skill="feature"
    fi
    echo "$skill"
}

# Function to get skill file path
get_skill_file() {
    local skill="$1"
    local skill_file="$SKILLS_DIR/${skill}.md"
    if [ -f "$skill_file" ]; then
        echo "$skill_file"
    else
        echo "$SKILLS_DIR/feature.md"
    fi
}

# Determine skill and task for this iteration
SKILL="$SKILL_OVERRIDE"
TASK_ID=""
TASK_TITLE=""

if [ "$BEADS_AVAILABLE" = true ] && [ -z "$SKILL_OVERRIDE" ]; then
    if [ -n "$EPIC_FILTER" ]; then
        NEXT_TASK=$(bd ready --json 2>/dev/null | jq -r --arg epic "$EPIC_FILTER" '
          [.[] |
            ((.parent // null) as $explicit_parent |
             (.id | split(".") | if length > 1 then .[:-1] | join(".") else "" end) as $derived_parent |
             ($explicit_parent // $derived_parent)) as $parent |
            select($parent == $epic)
          ] | .[0] // empty
        ')
    else
        NEXT_TASK=$(bd ready --json 2>/dev/null | jq -r '.[0] // empty')
    fi

    if [ -n "$NEXT_TASK" ] && [ "$NEXT_TASK" != "null" ]; then
        TASK_ID=$(echo "$NEXT_TASK" | jq -r '.id // empty')
        TASK_TITLE=$(echo "$NEXT_TASK" | jq -r '.title // empty')
        SKILL=$(get_task_skill "$NEXT_TASK")
    else
        # No ready tasks - signal all complete
        if [ -n "$EPIC_FILTER" ]; then
            echo "No ready tasks under epic $EPIC_FILTER"
        else
            echo "No ready tasks available"
        fi
        echo "✅ All ready tasks complete!"
        exit 10  # Special exit code for "all complete"
    fi
fi

# Default skill if none determined
if [ -z "$SKILL" ]; then
    SKILL="feature"
fi

SKILL_FILE=$(get_skill_file "$SKILL")

# Create temp prompt file
TEMP_PROMPT=$(mktemp)
mv "$TEMP_PROMPT" "${TEMP_PROMPT}.md"
TEMP_PROMPT="${TEMP_PROMPT}.md"

cleanup() {
    rm -f "$TEMP_PROMPT"
}
trap cleanup EXIT

# Build the execution prompt
{
    echo "# Task Execution - Iteration $ITERATION/$MAX_ITERATIONS"
    echo ""
    echo "## Context"
    echo "- Plan: $PLAN_FILE"
    echo "- Progress: $PROGRESS_FILE"
    echo "- Skill: $SKILL"
    if [ -n "$TASK_ID" ]; then
        echo "- Task ID: $TASK_ID"
        echo "- Task: $TASK_TITLE"
    fi
    echo ""
    if [ -n "$EXTRA_CONTEXT" ]; then
        echo "## Additional Context"
        echo "$EXTRA_CONTEXT"
        echo ""
    fi
    echo "## Instructions"
    echo ""
    echo "1. Read the skill file for execution instructions: $SKILL_FILE"
    echo "2. Read the plan file for task details: $PLAN_FILE"
    if [ "$BEADS_AVAILABLE" = true ]; then
        echo "3. Use beads as source of truth: run 'bd ready' to confirm task"
    fi
    echo "4. Execute ONE task only following the skill instructions"
    echo "5. Update status (beads AND plan file) after completion"
    echo "6. Output completion marker and STOP"
    echo ""
    echo "## Completion Markers"
    echo "- Task done: $TASK_COMPLETE_MARKER"
    echo "- All tasks done: $COMPLETION_MARKER"
    echo ""
    echo "## CRITICAL"
    echo "- Follow the skill file instructions exactly"
    echo "- Update status in BOTH beads and plan file"
    echo "- Create a LOCAL git commit before outputting completion marker"
    echo "- STOP immediately after outputting completion marker"
    echo "- If you discover out-of-scope work, create a beads task for it (see skill file)"
} > "$TEMP_PROMPT"

# Write prompt path for TUI
echo "$TEMP_PROMPT" > .claude/.build-prompt-path

# Build claude args
CLAUDE_ARGS=(--add-dir "$(dirname "$TEMP_PROMPT")" --add-dir "$(pwd)" --permission-mode acceptEdits)

if [ "$STREAMING" = true ]; then
    # Streaming mode for TUI - bidirectional communication via stdin/stdout
    # --input-format stream-json: prompt and user messages sent via stdin as JSON
    # --output-format stream-json: responses streamed as NDJSON
    CLAUDE_ARGS=(-p --verbose --output-format stream-json --input-format stream-json "${CLAUDE_ARGS[@]}")

    # Run Claude - TUI will send prompt via stdin
    claude "${CLAUDE_ARGS[@]}" 2>&1
else
    # Non-streaming mode - pass prompt as argument
    CLAUDE_ARGS=(-p --verbose --output-format stream-json "${CLAUDE_ARGS[@]}")
    claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT" 2>&1
fi

# Check completion status from progress file
if grep -q "$COMPLETION_MARKER" "$PROGRESS_FILE" 2>/dev/null || \
   grep -q "$LEGACY_ALL_COMPLETE" "$PROGRESS_FILE" 2>/dev/null; then
    exit 10  # All tasks complete
fi

# Default: task complete, continue to next iteration
exit 0
