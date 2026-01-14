#!/bin/bash
# Build command - Generic work execution loop with skill-based dispatch
# Usage: ./build.sh [--once] [--max-iterations N] [--fresh] [--skill SKILL] [-i|--interactive] [extra context]

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

# Completion markers (generic markers for all skills)
COMPLETION_MARKER="<promise>ALL_TASKS_COMPLETE</promise>"
TASK_COMPLETE_MARKER="<promise>TASK_COMPLETE</promise>"

# Legacy markers (for backwards compatibility)
LEGACY_ALL_COMPLETE="<promise>ALL_SUITES_COMPLETE</promise>"
LEGACY_ITERATION_COMPLETE="<promise>ITERATION_COMPLETE</promise>"

# Defaults
MAX_ITERATIONS=50
ONCE=false
FRESH=false
INTERACTIVE=false
STREAMING=false
SKILL_OVERRIDE=""
EPIC_FILTER=""
EXTRA_CONTEXT=""

# Check for tailspin (tspin) for prettier log output
if command -v tspin &>/dev/null; then
    HAS_TSPIN=true
else
    HAS_TSPIN=false
fi

# Check for jq (required for beads JSON parsing)
if ! command -v jq &>/dev/null; then
    echo "⚠️  Warning: jq not found. Install with: brew install jq"
    echo "   Beads task tracking will be disabled."
    echo ""
    BEADS_AVAILABLE=false
# Check if beads is available
elif command -v bd &>/dev/null && [ -d ".beads" ]; then
    BEADS_AVAILABLE=true
else
    BEADS_AVAILABLE=false
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --once)
            ONCE=true
            shift
            ;;
        --max-iterations)
            MAX_ITERATIONS="$2"
            shift 2
            ;;
        --fresh)
            FRESH=true
            shift
            ;;
        --skill)
            SKILL_OVERRIDE="$2"
            shift 2
            ;;
        -i|--interactive)
            INTERACTIVE=true
            shift
            ;;
        --streaming)
            STREAMING=true
            shift
            ;;
        --epic)
            EPIC_FILTER="$2"
            shift 2
            ;;
        *)
            EXTRA_CONTEXT="$EXTRA_CONTEXT $1"
            shift
            ;;
    esac
done

# Resolve plan file (supports both work-plan and legacy test-plan naming)
resolve_plan_file() {
    # New naming: work-plan-*
    if [ -f ".claude/work-plan-latest.md" ]; then
        readlink -f ".claude/work-plan-latest.md" 2>/dev/null || echo ".claude/work-plan-latest.md"
    elif ls .claude/work-plan-*.md 1>/dev/null 2>&1; then
        ls -t .claude/work-plan-*.md 2>/dev/null | head -1
    # Legacy naming: test-plan-* (backwards compatibility)
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
    echo "❌ No plan found at $PLAN_FILE"
    echo "   Run 'clive plan' first to create a work plan."
    exit 1
fi

# Verify skills directory exists
if [ ! -d "$SKILLS_DIR" ]; then
    echo "❌ Error: Skills directory not found at $SKILLS_DIR"
    exit 1
fi

# Clear progress if --fresh
if [ "$FRESH" = true ]; then
    rm -f "$PROGRESS_FILE"
    echo "🧹 Cleared progress file"
fi

# Ensure .claude directory exists
mkdir -p .claude

# Initialize progress file if needed
if [ ! -f "$PROGRESS_FILE" ]; then
    echo "# Work Execution Progress" > "$PROGRESS_FILE"
    echo "Started: $(date -Iseconds)" >> "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
fi

# Write state files for TUI integration
echo "$PLAN_FILE" > .claude/.build-plan-path
echo "$MAX_ITERATIONS" > .claude/.build-max-iterations

echo "🚀 Starting build loop"
echo "   Plan: $PLAN_FILE"
echo "   Skills: $SKILLS_DIR"
if [ -n "$EPIC_FILTER" ]; then
    echo "   Epic: $EPIC_FILTER"
fi
if [ -n "$SKILL_OVERRIDE" ]; then
    echo "   Skill override: $SKILL_OVERRIDE"
fi
if [ "$ONCE" = true ]; then
    echo "   Mode: Single iteration (--once)"
else
    echo "   Max iterations: $MAX_ITERATIONS"
fi
if [ "$STREAMING" = true ]; then
    echo "   Mode: streaming (TUI output)"
elif [ "$INTERACTIVE" = true ]; then
    echo "   Interactive: yes (manual exit required)"
else
    echo "   Interactive: no (auto-exit after each iteration)"
fi
if [ "$HAS_TSPIN" = true ] && [ "$INTERACTIVE" = false ]; then
    echo "   Log highlighting: tailspin"
fi
if [ "$BEADS_AVAILABLE" = true ]; then
    echo "   Task tracking: beads"
else
    echo "   Task tracking: plan file only"
fi
echo "   Progress: $PROGRESS_FILE"
echo ""

# Create temp file for iteration instructions
TEMP_PROMPT=$(mktemp)
mv "$TEMP_PROMPT" "${TEMP_PROMPT}.md"
TEMP_PROMPT="${TEMP_PROMPT}.md"

# Cleanup function
cleanup() {
    rm -f "$TEMP_PROMPT"
}
trap cleanup EXIT

# Function to extract skill from beads task
get_task_skill() {
    local task_json="$1"
    local skill=""

    # Try to get skill from labels
    if [ -n "$task_json" ]; then
        skill=$(echo "$task_json" | jq -r '.labels[]? // empty' 2>/dev/null | grep '^skill:' | cut -d: -f2 | head -1)
    fi

    # If no skill found, try to get from description
    if [ -z "$skill" ] && [ -n "$task_json" ]; then
        # Use sed instead of grep -P for macOS compatibility
        skill=$(echo "$task_json" | jq -r '.description // empty' 2>/dev/null | sed -n 's/.*\*\*Skill:\*\* \([a-zA-Z0-9_-]*\).*/\1/p' | head -1)
    fi

    # Default to feature skill
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

# The Build Loop (Ralph Wiggum pattern)
for ((i=1; i<=MAX_ITERATIONS; i++)); do
    # Write current iteration for TUI
    echo "$i" > .claude/.build-iteration

    if [ "$ONCE" = true ]; then
        echo "🔄 Running single iteration"
    else
        echo "🔄 Iteration $i/$MAX_ITERATIONS"
    fi
    echo ""

    # Determine skill for this iteration
    SKILL="$SKILL_OVERRIDE"
    TASK_ID=""
    TASK_TITLE=""

    if [ "$BEADS_AVAILABLE" = true ] && [ -z "$SKILL_OVERRIDE" ]; then
        # Get next task from beads, optionally filtered by epic
        if [ -n "$EPIC_FILTER" ]; then
            # Filter ready tasks to those under the specified epic
            # Derive parent from ID convention: "epic-id.1" -> parent is "epic-id"
            # Uses .parent if set, otherwise derives from ID by removing last .N segment
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
            echo "   Task: $TASK_TITLE ($TASK_ID)"
            echo "   Skill: $SKILL"
        else
            # No ready tasks available
            if [ -n "$EPIC_FILTER" ]; then
                echo "   No ready tasks under epic $EPIC_FILTER"
            else
                echo "   No ready tasks available"
            fi
            echo ""
            echo "✅ All ready tasks complete!"
            exit 0
        fi
    fi

    # Default skill if none determined
    if [ -z "$SKILL" ]; then
        SKILL="feature"
    fi

    # Get skill file
    SKILL_FILE=$(get_skill_file "$SKILL")
    echo "   Skill file: $SKILL_FILE"
    echo ""

    # Build the execution prompt
    {
        echo "# Task Execution - Iteration $i/$MAX_ITERATIONS"
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

    # Build claude args
    # --add-dir gives Claude access to read the temp prompt file
    # --permission-mode acceptEdits allows file edits without prompting
    # but still requires approval for dangerous operations (bash, etc.)
    CLAUDE_ARGS=(--add-dir "$(dirname "$TEMP_PROMPT")" --permission-mode acceptEdits)

    if [ "$INTERACTIVE" = false ] || [ "$STREAMING" = true ]; then
        # -p for non-interactive, --output-format stream-json for real-time NDJSON streaming
        CLAUDE_ARGS=(-p --verbose --output-format stream-json "${CLAUDE_ARGS[@]}")
    fi

    # Invoke claude - use CLI directly for streaming (TUI), docker sandbox for interactive
    if [ "$STREAMING" = true ]; then
        # Streaming mode - output structured JSON events for TUI parsing
        # Format: {"type":"assistant|tool_use|tool_result","text":"...","name":"..."}
        claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT" 2>&1 | while IFS= read -r line; do
            if [[ -n "$line" ]]; then
                # Parse NDJSON and output structured events for TUI
                event=$(echo "$line" | jq -c '
                    if .type == "content_block_delta" and .delta.type == "text_delta" then
                        {type: "assistant", text: .delta.text}
                    elif .type == "content_block_start" and .content_block.type == "text" then
                        {type: "assistant", text: .content_block.text}
                    elif .type == "content_block_start" and .content_block.type == "tool_use" then
                        {type: "tool_use", name: .content_block.name, id: .content_block.id}
                    elif .type == "assistant" then
                        (.message.content[]? | select(.type == "text") | {type: "assistant", text: .text})
                    elif .type == "user" then
                        (.message.content[]? | select(.type == "tool_result") | {
                            type: "tool_result",
                            id: .tool_use_id,
                            content: (if .content | type == "string" then .content[0:200] else (.content | tostring)[0:200] end)
                        })
                    else empty
                    end
                ' 2>/dev/null)
                if [[ -n "$event" ]]; then
                    echo "$event"
                fi
            fi
        done
    elif [ "$HAS_TSPIN" = true ] && [ "$INTERACTIVE" = false ]; then
        # Non-streaming with tspin - use Claude CLI directly, pipe to tspin
        claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT" 2>&1 | while IFS= read -r line; do
            if [[ -n "$line" ]]; then
                text=$(echo "$line" | jq -r '
                    if .type == "content_block_delta" and .delta.type == "text_delta" then .delta.text
                    elif .type == "content_block_start" and .content_block.type == "text" then .content_block.text
                    elif .type == "assistant" then (.message.content[]? | select(.type == "text") | .text)
                    else empty
                    end
                ' 2>/dev/null)
                if [[ -n "$text" ]]; then
                    printf '%s' "$text"
                fi
            fi
        done | tspin
    else
        # Interactive mode - no -p flag, let Claude handle TTY directly
        claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT"
    fi

    # Check for completion markers in progress file (generic and legacy)
    if grep -q "$COMPLETION_MARKER" "$PROGRESS_FILE" 2>/dev/null || \
       grep -q "$LEGACY_ALL_COMPLETE" "$PROGRESS_FILE" 2>/dev/null; then
        echo ""
        echo "✅ All tasks complete!"
        exit 0
    fi

    # Check --once flag
    if [ "$ONCE" = true ]; then
        echo ""
        echo "🔄 Single iteration complete (--once flag)"
        exit 0
    fi

    echo ""
    echo "---"
    echo ""
done

echo "⚠️ Max iterations ($MAX_ITERATIONS) reached"
echo "   Check $PROGRESS_FILE to see what was completed"
exit 1
