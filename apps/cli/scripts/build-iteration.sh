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
# PROGRESS_FILE is set after argument parsing to support epic-scoped paths

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

# Set epic-scoped paths for scratchpad and progress files
if [ -n "$EPIC_FILTER" ]; then
    EPIC_DIR=".claude/epics/$EPIC_FILTER"
    mkdir -p "$EPIC_DIR"
    PROGRESS_FILE="$EPIC_DIR/progress.txt"
    SCRATCHPAD_FILE="$EPIC_DIR/scratchpad.md"
else
    # Fallback for no epic (shouldn't happen in normal use)
    PROGRESS_FILE=".claude/progress.txt"
    SCRATCHPAD_FILE=".claude/scratchpad.md"
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
        export LINEAR_TASK_FETCH=true
        SKILL="feature"  # Default skill, Claude will determine from task labels

        # Note: Linear MCP authentication will be verified when agent calls list_issues
        # If authentication fails, agent will receive clear error instructions
        echo "Note: Ensure you've authenticated with Linear MCP (run 'claude' and authenticate if needed)"

        # Check for Linear parent issue ID (saved during planning)
        if [ -n "$EPIC_DIR" ] && [ -f "$EPIC_DIR/linear_issue_id.txt" ]; then
            LINEAR_PARENT_ID=$(cat "$EPIC_DIR/linear_issue_id.txt")
            export LINEAR_PARENT_ID
            echo "Found Linear parent issue: $LINEAR_PARENT_ID"
        else
            echo "Warning: Linear parent ID not found. Task filtering may be less precise."
        fi

        # Export Linear team ID if available
        if [ -n "$LINEAR_TEAM_ID" ]; then
            export LINEAR_TEAM_ID
        fi
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
# SCRATCHPAD_FILE is set earlier based on EPIC_FILTER
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
        echo "## CRITICAL: Task Discovery Required"
        echo ""
        echo "**Before doing ANYTHING else, you MUST fetch your task from Linear.**"
        echo ""
        echo "### Execute These Steps in Order:"
        echo ""
        echo "**Step 1: Call Linear MCP to list your tasks (include Backlog AND Todo)**"
        echo ""
        echo "Make TWO calls to get all available tasks:"
        echo ""
        echo "Call 1 - Todo tasks:"
        echo "\`\`\`"
        echo "mcp__linear__list_issues"
        echo "  assignee: \"me\""
        echo "  state: \"Todo\""
        echo "\`\`\`"
        echo ""
        echo "Call 2 - Backlog tasks:"
        echo "\`\`\`"
        echo "mcp__linear__list_issues"
        echo "  assignee: \"me\""
        echo "  state: \"Backlog\""
        echo "\`\`\`"
        echo ""
        echo "Combine both result sets before filtering."
        echo ""
        echo "**If you get an authentication error:**"
        echo ""
        echo "1. Output the following message to the user:"
        echo "   \`\`\`"
        echo "   ERROR: Linear MCP is not authenticated."
        echo ""
        echo "   To authenticate:"
        echo "   1. Cancel this build (press 'c')"
        echo "   2. Run: claude"
        echo "   3. Ask: 'Please authenticate with Linear MCP'"
        echo "   4. Follow the authentication flow"
        echo "   5. Restart build with /build"
        echo "   \`\`\`"
        echo "2. Output the completion marker: \`TASK_COMPLETE\`"
        echo "3. STOP immediately"
        echo ""

        if [ -n "$LINEAR_PARENT_ID" ]; then
            echo "**Step 2: Filter for subtasks of parent issue: $LINEAR_PARENT_ID**"
            echo ""
            echo "From the results, find tasks where:"
            echo "- \`parent.id == \"$LINEAR_PARENT_ID\"\`"
            echo ""
        else
            echo "**Step 2: Filter for tasks in this epic**"
            echo ""
            if [ -n "$EPIC_FILTER" ]; then
                echo "From the results, find tasks related to epic ID: $EPIC_FILTER"
            else
                echo "From the results, find tasks assigned to you in Todo state"
            fi
            echo ""
            echo "Note: Without a parent issue ID, you may need to search by project or labels."
            echo ""
        fi

        echo "**Step 3: Select the first task**"
        echo ""
        echo "- Sort tasks by \`createdAt\` (oldest first) or \`sortOrder\` (lowest first)"
        echo "- Pick the FIRST task from the filtered list"
        echo "- Extract: \`id\`, \`identifier\` (e.g., \"TRI-1234\"), and \`title\`"
        echo ""
        echo "**Step 4: Proceed with the task**"
        echo ""
        echo "- Use the task's \`identifier\` for git commits and display"
        echo "- Use the task's \`id\` (UUID) for MCP tool calls (\`mcp__linear__update_issue\`)"
        echo ""
        echo "**Step 5: If no tasks found**"
        echo ""
        echo "If there are NO tasks matching the filters:"
        echo "- Output the exact text: \`ALL_TASKS_COMPLETE\`"
        echo "- STOP immediately - do not attempt to do any work"
        echo ""
        echo "---"
        echo ""
        echo "**IMPORTANT REMINDERS:**"
        echo "- There is NO \`TASK_ID\` environment variable - you must fetch it"
        echo "- There is NO plan.md file in .claude/epics/ - task info comes from Linear"
        echo "- Do NOT look for files or grep - use the Linear MCP tools"
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

    echo "4. **CRITICAL: Update tracker status at TWO points:**"
    echo "   a. BEFORE starting work: mark 'In Progress'"
    echo "   b. AFTER verification: mark 'Done'"
    echo ""

    if [ "$TRACKER" = "beads" ]; then
        echo "   - Start: bd update $TASK_ID --status in_progress"
        echo "   - Complete: bd close $TASK_ID"
    else
        echo "   - Start: mcp__linear__update_issue (id: [task-id], state: 'In Progress')"
        echo "   - Complete: mcp__linear__update_issue (id: [task-id], state: 'Done')"
        echo ""
        echo "   **VERIFY these calls succeed. If they fail, debug before proceeding.**"
    fi

    echo ""
    echo "5. Execute ONE task only following the skill instructions"
    echo "6. **Update the scratchpad** with notes for the next iteration (see below)"
    echo "7. Output completion marker and STOP"
    echo ""
    echo "## Scratchpad Update (REQUIRED before completing)"
    echo ""
    echo "Before outputting the completion marker, append to $SCRATCHPAD_FILE:"
    echo ""
    echo '```bash'
    echo "cat >> $SCRATCHPAD_FILE << 'SCRATCHPAD'"
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
    echo ""
    echo "## STATUS UPDATE VERIFICATION"
    if [ "$TRACKER" = "linear" ]; then
        echo "After calling mcp__linear__update_issue, check the tool result for errors."
        echo "If you see 'Issue not found' or 'Invalid state', STOP and report the error."
        echo "Do NOT continue if status updates fail."
    fi
} > "$TEMP_PROMPT"

# Write prompt path for TUI
echo "$TEMP_PROMPT" > .claude/.build-prompt-path

# Build claude args
# Full permissions for build agents - they need to run bd commands, git, etc.
CLAUDE_ARGS=(--add-dir "$(dirname "$TEMP_PROMPT")" --add-dir "$(pwd)" --add-dir "$PLUGIN_DIR" --dangerously-skip-permissions)

# Find and include MCP config if present (for Linear integration)
# Search from current directory upward for .mcp.json
MCP_CONFIG=""
SEARCH_DIR="$(pwd)"
while [ "$SEARCH_DIR" != "/" ]; do
    if [ -f "$SEARCH_DIR/.mcp.json" ]; then
        MCP_CONFIG="$SEARCH_DIR/.mcp.json"
        echo "Found MCP config: $MCP_CONFIG"
        break
    fi
    SEARCH_DIR="$(dirname "$SEARCH_DIR")"
done

if [ -n "$MCP_CONFIG" ]; then
    CLAUDE_ARGS+=(--mcp-config "$MCP_CONFIG")
fi

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
