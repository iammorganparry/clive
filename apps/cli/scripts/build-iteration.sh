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

# Check for jq (required)
if ! command -v jq &>/dev/null; then
    echo "❌ Error: jq not found. Install with: brew install jq" >&2
    exit 1
fi

# Detect configured task tracker
CLIVE_CONFIG="${CLIVE_CONFIG:-$HOME/.clive/config.json}"
if [ -f "$CLIVE_CONFIG" ]; then
    TRACKER=$(jq -r '.issue_tracker // "beads"' "$CLIVE_CONFIG" 2>/dev/null || echo "beads")
else
    TRACKER="beads"
fi
export CLIVE_TRACKER="$TRACKER"

# Validate tracker is available
if [ "$TRACKER" = "beads" ]; then
    if ! command -v bd &>/dev/null; then
        echo "❌ Error: Beads (bd) is required but not installed." >&2
        exit 1
    fi
    if [ ! -d ".beads" ]; then
        echo "❌ Error: No .beads directory found. Run 'bd init' first." >&2
        exit 1
    fi
elif [ "$TRACKER" = "linear" ]; then
    LINEAR_TEAM_ID=$(jq -r '.linear.team_id // empty' "$CLIVE_CONFIG" 2>/dev/null)
    if [ -z "$LINEAR_TEAM_ID" ]; then
        echo "❌ Error: Linear team ID not configured in $CLIVE_CONFIG" >&2
        exit 1
    fi
    export LINEAR_TEAM_ID
else
    echo "❌ Error: Unknown tracker '$TRACKER'. Supported: beads, linear" >&2
    exit 1
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
LINEAR_TASK_FETCH=false

if [ -z "$SKILL_OVERRIDE" ]; then
    if [ "$TRACKER" = "beads" ]; then
        # Beads: fetch next task via bd ready
        if [ -n "$EPIC_FILTER" ]; then
            # Use higher limit to ensure we find tasks under the epic
            NEXT_TASK=$(bd ready --json --limit 100 2>/dev/null | jq -r --arg epic "$EPIC_FILTER" '
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
    elif [ "$TRACKER" = "linear" ]; then
        # Linear: Claude will fetch the next task via MCP tools
        # We set a flag to include instructions in the prompt
        LINEAR_TASK_FETCH=true
        SKILL="feature"  # Default skill, Claude will determine from task labels
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

# Read scratchpad if it exists (context from previous iterations)
SCRATCHPAD_FILE=".claude/scratchpad.md"
SCRATCHPAD_CONTENT=""
if [ -f "$SCRATCHPAD_FILE" ]; then
    SCRATCHPAD_CONTENT=$(cat "$SCRATCHPAD_FILE")
fi

# Build the execution prompt
{
    echo "# Task Execution - Iteration $ITERATION/$MAX_ITERATIONS"
    echo ""
    echo "## Previous Context (Scratchpad)"
    echo ""
    if [ -n "$SCRATCHPAD_CONTENT" ]; then
        echo "$SCRATCHPAD_CONTENT"
    else
        echo "_No previous context - this is the first iteration._"
    fi
    echo ""
    echo "---"
    echo ""
    echo "## Current Task"
    echo "- Task tracker: $TRACKER"
    echo "- Progress: $PROGRESS_FILE"
    echo "- Skill: $SKILL"
    if [ "$TRACKER" = "beads" ] && [ -n "$TASK_ID" ]; then
        echo "- Task ID: $TASK_ID"
        echo "- Task: $TASK_TITLE"
    fi
    echo ""

    # Linear-specific task fetching instructions
    if [ "$LINEAR_TASK_FETCH" = true ]; then
        echo "## Task Fetching (Linear)"
        echo ""
        echo "Use the Linear MCP tools to find the next ready task:"
        echo "1. Call \`mcp__linear__list_issues\` with \`assignee: \"me\"\` and \`state: \"Todo\"\`"
        if [ -n "$EPIC_FILTER" ]; then
            echo "2. Filter for tasks under project/parent: $EPIC_FILTER"
        fi
        echo "3. Pick the first issue from the results as your current task"
        echo "4. If no tasks are found, output the ALL_TASKS_COMPLETE marker and stop"
        echo ""
    fi

    if [ -n "$EXTRA_CONTEXT" ]; then
        echo "## Additional Context"
        echo "$EXTRA_CONTEXT"
        echo ""
    fi
    echo "## Instructions"
    echo ""
    echo "1. Read the skill file for execution instructions: $SKILL_FILE"
    echo "2. **Review the scratchpad above** for any relevant context from previous iterations"

    # Tracker-specific task details instruction
    if [ "$TRACKER" = "beads" ]; then
        echo "3. Use beads as source of truth: run 'bd show $TASK_ID' for task details"
    else
        echo "3. Use Linear as source of truth: call \`mcp__linear__get_issue\` with the task ID for details"
    fi

    echo "4. Execute ONE task only following the skill instructions"

    # Tracker-specific completion instruction
    if [ "$TRACKER" = "beads" ]; then
        echo "5. Update beads status after completion: bd close $TASK_ID"
    else
        echo "5. Update Linear status after completion: call \`mcp__linear__update_issue\` with state: \"Done\""
    fi

    echo "6. **Update the scratchpad** with notes for the next iteration (see below)"
    echo "7. Output completion marker and STOP"
    echo ""
    echo "## Scratchpad Update (REQUIRED before completing)"
    echo ""
    echo "Before outputting the completion marker, append to .claude/scratchpad.md:"
    echo ""
    echo '```bash'
    echo 'cat >> .claude/scratchpad.md << '\''SCRATCHPAD'\'''
    echo ""
    echo "## Iteration $ITERATION - [Task Title]"
    echo '**Completed:** $(date +%Y-%m-%d\ %H:%M)'
    echo ""
    echo "### Key Decisions"
    echo "- [Decision and reasoning]"
    echo ""
    echo "### Notes for Next Agent"
    echo "- [Important context]"
    echo "- [Files modified]"
    echo "- [Patterns used]"
    echo ""
    echo "SCRATCHPAD"
    echo '```'
    echo ""
    echo "## Completion Markers"
    echo "- Task done: $TASK_COMPLETE_MARKER"
    echo "- All tasks done: $COMPLETION_MARKER"
    echo ""
    echo "## CRITICAL"
    echo "- Follow the skill file instructions exactly"

    # Tracker-specific status update reminder
    if [ "$TRACKER" = "beads" ]; then
        echo "- Update beads status (bd close) when task is complete"
        echo "- If you discover out-of-scope work, create a beads task for it (see skill file)"
    else
        echo "- Update Linear status (mcp__linear__update_issue) when task is complete"
        echo "- If you discover out-of-scope work, create a Linear issue for it (mcp__linear__create_issue)"
    fi

    echo "- **Update the scratchpad before completing** - this helps the next agent"
    echo "- Create a LOCAL git commit before outputting completion marker"
    echo "- STOP immediately after outputting completion marker"
} > "$TEMP_PROMPT"

# Write prompt path for TUI
echo "$TEMP_PROMPT" > .claude/.build-prompt-path

# Build claude args
# Full permissions for build agents - they need to run bd commands, git, etc.
CLAUDE_ARGS=(--add-dir "$(dirname "$TEMP_PROMPT")" --add-dir "$(pwd)" --add-dir "$PLUGIN_DIR" --dangerously-skip-permissions)

if [ "$STREAMING" = true ]; then
    # Streaming mode for TUI - bidirectional communication via stdin/stdout
    # --input-format stream-json: prompt and user messages sent via stdin as JSON
    # --output-format stream-json: responses streamed as NDJSON
    CLAUDE_ARGS=(-p --verbose --output-format stream-json --input-format stream-json "${CLAUDE_ARGS[@]}")

    # Run Claude - TUI will send prompt via stdin
    # Redirect stderr to log file to prevent UI flickering from build tool output
    mkdir -p "$HOME/.clive"
    claude "${CLAUDE_ARGS[@]}" 2>>"$HOME/.clive/claude-stderr.log"
else
    # Non-streaming mode - pass prompt as argument
    CLAUDE_ARGS=(-p --verbose --output-format stream-json "${CLAUDE_ARGS[@]}")
    mkdir -p "$HOME/.clive"
    claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT" 2>>"$HOME/.clive/claude-stderr.log"
fi

# Check completion status from progress file
if grep -q "$COMPLETION_MARKER" "$PROGRESS_FILE" 2>/dev/null || \
   grep -q "$LEGACY_ALL_COMPLETE" "$PROGRESS_FILE" 2>/dev/null; then
    exit 10  # All tasks complete
fi

# Default: task complete, continue to next iteration
exit 0
