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

PLUGIN_DIR="$SCRIPT_DIR/.."
SKILLS_DIR="$PLUGIN_DIR/skills"
LOCAL_SKILLS_DIR=".claude/skills"
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
    ERROR_PATTERNS_FILE="$EPIC_DIR/error-patterns.md"
else
    # Fallback for no epic (shouldn't happen in normal use)
    PROGRESS_FILE=".claude/progress.txt"
    SCRATCHPAD_FILE=".claude/scratchpad.md"
    ERROR_PATTERNS_FILE=".claude/error-patterns.md"
fi

# Initialize error patterns file if needed
if [ ! -f "$ERROR_PATTERNS_FILE" ]; then
    cat > "$ERROR_PATTERNS_FILE" << 'EOF'
# Error Patterns & Solutions

This file tracks recurring errors, their root causes, and proven solutions.

## Template
When you encounter an error multiple times, document it here:

### [Error Name/Description]
**Symptom:** [What you see]
**Root Cause:** [Why it happens]
**Solution:** [How to fix it]
**Prevention:** [How to avoid it]
**First Seen:** [Date/Iteration]
**Last Seen:** [Date/Iteration]
**Frequency:** [Number of occurrences]

---
EOF
fi

# Verify skills directory
if [ ! -d "$SKILLS_DIR" ]; then
    echo "❌ Skills directory not found at $SKILLS_DIR" >&2
    exit 1
fi

# Ensure .claude directory exists
mkdir -p .claude
mkdir -p .claude/learnings

# Initialize global learnings files if needed
GLOBAL_ERROR_PATTERNS=".claude/learnings/error-patterns.md"
GLOBAL_SUCCESS_PATTERNS=".claude/learnings/success-patterns.md"
GLOBAL_GOTCHAS=".claude/learnings/gotchas.md"

if [ ! -f "$GLOBAL_ERROR_PATTERNS" ]; then
    cat > "$GLOBAL_ERROR_PATTERNS" << 'EOF'
# Global Error Patterns

Cross-epic knowledge base of recurring errors and their solutions.
When you encounter an error that might affect other work, document it here.

## Template

### [Error Name/Description]
**Symptom:** [What you see]
**Root Cause:** [Why it happens]
**Solution:** [How to fix it]
**Prevention:** [How to avoid it]
**First Seen:** [Date/Epic/Iteration]
**Occurrences:** [List of epics/iterations where this occurred]
**Related Files:** [Files commonly affected]

---
EOF
fi

if [ ! -f "$GLOBAL_SUCCESS_PATTERNS" ]; then
    cat > "$GLOBAL_SUCCESS_PATTERNS" << 'EOF'
# Global Success Patterns

Reusable patterns and techniques that have worked well across different tasks.
When you discover an effective approach, document it here for others to use.

## Template

### [Pattern Name]
**Use Case:** [When to apply this pattern]
**Implementation:** [How to implement it]
**Benefits:** [Why this works well]
**Examples:** [References to where this was used successfully]
**First Used:** [Date/Epic/Iteration]
**Reused In:** [List of other contexts where this pattern was applied]

---
EOF
fi

if [ ! -f "$GLOBAL_GOTCHAS" ]; then
    cat > "$GLOBAL_GOTCHAS" << 'EOF'
# Global Gotchas

Codebase-specific quirks, traps, and non-obvious behaviors.
Document anything that surprised you or took time to figure out.

## Template

### [Gotcha Name]
**What Happens:** [Surprising behavior]
**Why:** [Root cause or design decision]
**How to Handle:** [Correct approach]
**Files Affected:** [Where this applies]
**Discovered:** [Date/Epic/Iteration]

---
EOF
fi

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
    local local_skill_file="$LOCAL_SKILLS_DIR/${skill}.md"
    local builtin_skill_file="$SKILLS_DIR/${skill}.md"

    # Check local project skills first (user-defined)
    if [ -f "$local_skill_file" ]; then
        echo "$local_skill_file"
    # Fall back to built-in skills
    elif [ -f "$builtin_skill_file" ]; then
        echo "$builtin_skill_file"
    # Default to built-in feature skill
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
        # Priority-based selection: prefer in-progress tasks, then sort by priority (lower = higher)
        if [ -n "$EPIC_FILTER" ]; then
            # Use higher limit to ensure we find tasks under the epic
            NEXT_TASK=$(bd ready --json --limit 100 2>/dev/null | jq -r --arg epic "$EPIC_FILTER" '
              [.[] |
                ((.parent // null) as $explicit_parent |
                 (.id | split(".") | if length > 1 then .[:-1] | join(".") else "" end) as $derived_parent |
                 ($explicit_parent // $derived_parent)) as $parent |
                select($parent == $epic)
              ] | sort_by(
                if .status == "in_progress" then 0 else 1 end,
                .priority // 99
              ) | .[0] // empty
            ')
        else
            # Priority-based selection: prefer in-progress tasks, then sort by priority (lower = higher)
            NEXT_TASK=$(bd ready --json --limit 100 2>/dev/null | jq -r '
              sort_by(
                if .status == "in_progress" then 0 else 1 end,
                .priority // 99
              ) | .[0] // empty
            ')
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
    echo "## Global Learnings (Cross-Epic Knowledge)"
    echo ""
    echo "These learnings apply across ALL epics and tasks. Review before starting work."
    echo ""

    # Show global error patterns
    if [ -f "$GLOBAL_ERROR_PATTERNS" ]; then
        ERROR_COUNT=$(grep -c "^### " "$GLOBAL_ERROR_PATTERNS" 2>/dev/null || echo "0")
        if [ "$ERROR_COUNT" -gt 0 ]; then
            echo "### Known Error Patterns ($ERROR_COUNT documented)"
            echo ""
            grep -A 8 "^### " "$GLOBAL_ERROR_PATTERNS" | head -60
            echo ""
        fi
    fi

    # Show global success patterns
    if [ -f "$GLOBAL_SUCCESS_PATTERNS" ]; then
        PATTERN_COUNT=$(grep -c "^### " "$GLOBAL_SUCCESS_PATTERNS" 2>/dev/null || echo "0")
        if [ "$PATTERN_COUNT" -gt 0 ]; then
            echo "### Reusable Success Patterns ($PATTERN_COUNT documented)"
            echo ""
            grep -A 7 "^### " "$GLOBAL_SUCCESS_PATTERNS" | head -60
            echo ""
        fi
    fi

    # Show global gotchas
    if [ -f "$GLOBAL_GOTCHAS" ]; then
        GOTCHA_COUNT=$(grep -c "^### " "$GLOBAL_GOTCHAS" 2>/dev/null || echo "0")
        if [ "$GOTCHA_COUNT" -gt 0 ]; then
            echo "### Codebase Gotchas ($GOTCHA_COUNT documented)"
            echo ""
            grep -A 6 "^### " "$GLOBAL_GOTCHAS" | head -60
            echo ""
        fi
    fi

    if [ ! -f "$GLOBAL_ERROR_PATTERNS" ] || [ $(grep -c "^### " "$GLOBAL_ERROR_PATTERNS" 2>/dev/null || echo "0") -eq 0 ]; then
        if [ ! -f "$GLOBAL_SUCCESS_PATTERNS" ] || [ $(grep -c "^### " "$GLOBAL_SUCCESS_PATTERNS" 2>/dev/null || echo "0") -eq 0 ]; then
            if [ ! -f "$GLOBAL_GOTCHAS" ] || [ $(grep -c "^### " "$GLOBAL_GOTCHAS" 2>/dev/null || echo "0") -eq 0 ]; then
                echo "_No global learnings documented yet. As you work, document errors, patterns, and gotchas in:_"
                echo "- _$GLOBAL_ERROR_PATTERNS (recurring errors)_"
                echo "- _$GLOBAL_SUCCESS_PATTERNS (reusable techniques)_"
                echo "- _$GLOBAL_GOTCHAS (codebase quirks)_"
            fi
        fi
    fi
    echo ""
    echo "---"
    echo ""
    echo "## Recent Progress (Last 5 Iterations)"
    echo ""
    if [ -f "$PROGRESS_FILE" ]; then
        # Extract key outcomes from recent iterations (last 100 lines, filter for key markers)
        tail -100 "$PROGRESS_FILE" 2>/dev/null | grep -E "(^## |^✅|^❌|^Key decisions:|^Gotchas:|^Success pattern:)" || echo "_No recent progress recorded_"
    else
        echo "_No progress file found - this may be the first iteration._"
    fi
    echo ""
    echo "---"
    echo ""
    echo "## Known Error Patterns"
    echo ""
    if [ -f "$ERROR_PATTERNS_FILE" ]; then
        ERROR_COUNT=$(grep -c "^### " "$ERROR_PATTERNS_FILE" 2>/dev/null || echo "0")
        echo "Documented error patterns: $ERROR_COUNT"
        echo ""
        if [ "$ERROR_COUNT" -gt 0 ]; then
            echo "Review before starting work:"
            echo ""
            cat "$ERROR_PATTERNS_FILE" | grep -A 10 "^### " | head -50
            echo ""
            echo "If you encounter known errors, check this file for solutions."
        fi
    else
        echo "_No error patterns documented yet_"
    fi
    echo ""
    echo "---"
    echo ""
    echo "## Current Task"
    echo "- Task tracker: $TRACKER"
    echo "- Progress: $PROGRESS_FILE"
    echo "- Skill: $SKILL"
    echo ""

    # Extract and display full task details
    if [ "$TRACKER" = "beads" ] && [ -n "$TASK_ID" ]; then
        echo "### Task Details"
        echo "- **ID:** $TASK_ID"
        echo "- **Title:** $TASK_TITLE"
        echo ""

        # Fetch full task details if available
        TASK_DETAILS=$(bd show "$TASK_ID" --format json 2>/dev/null || echo "")
        if [ -n "$TASK_DETAILS" ]; then
            TASK_DESC=$(echo "$TASK_DETAILS" | jq -r '.description // "No description"')
            TASK_STATUS=$(echo "$TASK_DETAILS" | jq -r '.status // "unknown"')
            echo "**Status:** $TASK_STATUS"
            echo ""
            echo "**Description:**"
            echo "$TASK_DESC"
            echo ""
        fi
    fi
    echo ""

    # Check for cached task list (from TUI)
    CACHED_TASKS_FILE=""
    if [ -n "$EPIC_DIR" ]; then
        echo "[DEBUG] Looking for cached tasks at: $EPIC_DIR/tasks.json" >&2
        if [ -f "$EPIC_DIR/tasks.json" ]; then
            CACHED_TASKS_FILE="$EPIC_DIR/tasks.json"
            echo "[DEBUG] Found cached tasks file with $(jq '. | length' "$CACHED_TASKS_FILE") tasks" >&2

            # For Linear, extract and display next pending task details
            if [ "$LINEAR_TASK_FETCH" = true ]; then
                FIRST_TASK=$(jq -r '[.[] | select(.status == "pending" or .status == "in_progress")] | .[0] // empty' "$CACHED_TASKS_FILE")

                if [ -n "$FIRST_TASK" ] && [ "$FIRST_TASK" != "null" ]; then
                    TASK_ID=$(echo "$FIRST_TASK" | jq -r '.id')
                    TASK_IDENTIFIER=$(echo "$FIRST_TASK" | jq -r '.identifier // .id')
                    TASK_TITLE=$(echo "$FIRST_TASK" | jq -r '.title')
                    TASK_DESC=$(echo "$FIRST_TASK" | jq -r '.description // "No description"')
                    TASK_STATUS=$(echo "$FIRST_TASK" | jq -r '.status')

                    echo "### Next Task Details"
                    echo "- **ID:** $TASK_ID"
                    echo "- **Identifier:** $TASK_IDENTIFIER"
                    echo "- **Title:** $TASK_TITLE"
                    echo "- **Status:** $TASK_STATUS"
                    echo ""
                    echo "**Description:**"
                    echo "$TASK_DESC"
                    echo ""

                    # Extract acceptance criteria if present
                    if echo "$TASK_DESC" | grep -q "Acceptance Criteria:"; then
                        echo "**Acceptance Criteria:**"
                        echo "$TASK_DESC" | sed -n '/Acceptance Criteria:/,/^$/p' | tail -n +2
                        echo ""
                    fi

                    # Extract definition of done if present
                    if echo "$TASK_DESC" | grep -q "Definition of Done:"; then
                        echo "**Definition of Done:**"
                        echo "$TASK_DESC" | sed -n '/Definition of Done:/,/^$/p' | tail -n +2
                        echo ""
                    fi
                fi
            fi
        else
            echo "[DEBUG] Cached tasks file not found - Claude will fetch from Linear" >&2
        fi
    else
        echo "[DEBUG] EPIC_DIR not set - cannot use cached tasks" >&2
    fi

    # Linear-specific task fetching instructions
    if [ "$LINEAR_TASK_FETCH" = true ]; then
        if [ -n "$CACHED_TASKS_FILE" ]; then
            echo "## Tasks Pre-Loaded (DO NOT FETCH FROM LINEAR)"
            echo ""
            echo "All tasks for this epic are provided below."
            echo "DO NOT call mcp__linear__list_issues or search for tasks."
            echo ""
            echo "## Available Tasks"
            echo ""
            echo "\`\`\`json"
            cat "$CACHED_TASKS_FILE"
            echo "\`\`\`"
            echo ""
            echo "How to select the next task:"
            echo "1. Find tasks where Status is 'pending' or 'in_progress'"
            echo "2. Select the first pending task (already ordered)"
            echo "3. Use task ID for mcp__linear__update_issue calls"
            echo "4. Use task Title for display and commit messages"
            echo ""
            echo "After completing a task:"
            echo "- Check if task has sub-issues (children array):"
            echo "  - If it has sub-issues (it's an epic): mcp__linear__update_issue (id: [task-id], state: 'In Review')"
            echo "  - If it has NO sub-issues (it's a sub-task): mcp__linear__update_issue (id: [task-id], state: 'Done')"
            echo "- NEVER mark epics as 'Done' - only 'In Review'"
            echo "- Move to next pending task from JSON above"
            echo "- Do NOT fetch tasks again"
            echo ""
            echo "If all tasks are complete:"
            echo "- Output: ALL_TASKS_COMPLETE"
            echo "- STOP immediately"
            echo ""
        else
            echo "## Task Discovery Required"
            echo ""
            echo "IMPORTANT: Fetch your task from Linear FIRST before doing any work."
            echo ""
            echo "1. Call mcp__linear__list_issues twice:"
            echo "   - Call 1: assignee=\"me\", state=\"Todo\""
            echo "   - Call 2: assignee=\"me\", state=\"Backlog\""
            echo "   Combine both result sets before filtering."
            echo ""
            echo "2. Filter results:"

            if [ -n "$LINEAR_PARENT_ID" ]; then
                echo "   - Find tasks where parent.id == \"$LINEAR_PARENT_ID\""
            else
                echo "   - Find tasks assigned to you"
            fi

            echo "   - Sort by createdAt (oldest first) or sortOrder (lowest first)"
            echo "   - Select the FIRST task"
            echo ""
            echo "3. Extract from selected task:"
            echo "   - id (UUID) - use for mcp__linear__update_issue calls"
            echo "   - identifier (e.g., TRI-1234) - use for git commits and display"
            echo "   - title - use for display and commit messages"
            echo ""
            echo "4. If no tasks found:"
            echo "   - Output: ALL_TASKS_COMPLETE"
            echo "   - STOP immediately"
            echo ""
            echo "5. If authentication fails:"
            echo "   - Output: ERROR: Linear MCP is not authenticated."
            echo "   - Output: To authenticate: Cancel build (press 'c'), run 'claude', authenticate with Linear MCP, restart with /build"
            echo "   - Output: TASK_COMPLETE"
            echo "   - STOP immediately"
            echo ""
            echo "Then proceed to your skill file workflow."
            echo ""
        fi
    fi

    if [ -n "$EXTRA_CONTEXT" ]; then
        echo "## Additional Context"
        echo "$EXTRA_CONTEXT"
        echo ""
    fi
    echo "## YOUR PRIMARY INSTRUCTIONS"
    echo ""
    echo "Execute this task using the skill-specific workflow defined in your skill file."
    echo ""
    echo "SKILL FILE: $SKILL_FILE"
    echo ""
    echo "The skill file contains your PRIMARY instructions including:"
    echo "- The exact workflow phases/steps for this type of work"
    echo "- When to update status"
    echo "- Verification requirements"
    echo "- Quality standards"
    echo ""
    echo "Read it FIRST and FOLLOW IT EXACTLY."
    echo ""
    echo "---"
    echo ""
    echo "## SUPPORTING INFRASTRUCTURE"
    echo ""
    echo "The sections below provide supporting context that complements your skill workflow."
    echo ""
    echo "### Task Context"
    echo ""
    if [ -n "$SCRATCHPAD_CONTENT" ]; then
        echo "The scratchpad above contains context from previous iterations - review it for relevant background."
        echo ""
    fi

    # Tracker-specific task details
    if [ "$TRACKER" = "beads" ]; then
        echo "Task tracker: Beads"
        echo "For task details, run: bd show $TASK_ID"
    else
        echo "Task tracker: Linear"
        echo "For task details: mcp__linear__get_issue with task ID"
    fi
    echo ""

    echo "### Essential Requirements (apply to ALL skills)"
    echo ""
    echo "These requirements apply regardless of skill type:"
    echo ""
    echo "STATUS UPDATES (Critical):"
    echo "- Mark 'In Progress' at the START of work"
    echo "- At COMPLETION after verification:"
    echo "  - If task has sub-issues (epic): Mark as 'In Review'"
    echo "  - If task has NO sub-issues (sub-task): Mark as 'Done'"

    if [ "$TRACKER" = "beads" ]; then
        echo "  Start: bd update $TASK_ID --status in_progress"
        echo "  Complete: bd close $TASK_ID"
    else
        echo "  Start: mcp__linear__update_issue (id: [task-id], state: 'In Progress')"
        echo "  Complete (Epic): mcp__linear__update_issue (id: [task-id], state: 'In Review')"
        echo "  Complete (Sub-task): mcp__linear__update_issue (id: [task-id], state: 'Done')"
        echo "  NEVER mark epics as 'Done' - only 'In Review'"
        echo "  VERIFY these calls succeed - if they fail, debug before proceeding"
    fi

    echo ""
    echo "SCRATCHPAD UPDATES (MANDATORY - VERIFICATION REQUIRED):"
    echo "You MUST append structured notes to $SCRATCHPAD_FILE BEFORE marking task complete."
    echo ""
    echo "Use this EXACT template:"
    echo ""
    echo "cat >> $SCRATCHPAD_FILE << 'SCRATCHPAD'"
    echo "---"
    echo "## Iteration $ITERATION - [Task ID] [Task Title]"
    echo "**Completed:** \$(date '+%Y-%m-%d %H:%M')"
    echo "**Status:** [Completed/Blocked/Partial]"
    echo ""
    echo "### ✅ What Worked"
    echo "- [Successful approach or technique]"
    echo "- [Pattern that should be reused]"
    echo "- [Tool/library that solved the problem well]"
    echo ""
    echo "### ❌ What Didn't Work / Blockers"
    echo "- [Approach that failed and why]"
    echo "- [Blocker encountered and resolution]"
    echo "- [Dead end to avoid]"
    echo ""
    echo "### 🧠 Key Decisions & Rationale"
    echo "- [Important decision]: [Why this choice was made]"
    echo "- [Trade-off]: [What was gained vs what was sacrificed]"
    echo ""
    echo "### 📝 Files Modified"
    echo "- \\\`path/to/file.ts\\\` - [What changed and why]"
    echo "- \\\`path/to/test.ts\\\` - [Test coverage added]"
    echo ""
    echo "### ⚠️  Gotchas for Next Agent"
    echo "- [Tricky part of codebase to watch out for]"
    echo "- [Configuration quirk]"
    echo "- [Test that's flaky]"
    echo ""
    echo "### 🎯 Success Patterns"
    echo "- [Reusable pattern discovered]"
    echo "- [Effective workflow]"
    echo ""
    echo "### 📊 Metrics"
    echo "- Tests: [X passed / Y total]"
    echo "- Build time: [duration]"
    echo "- Lines changed: [+X -Y]"
    echo ""
    echo "SCRATCHPAD"
    echo ""
    echo "VERIFICATION: After writing scratchpad, confirm with:"
    echo "echo 'SCRATCHPAD_UPDATED: Iteration $ITERATION' >> $PROGRESS_FILE"
    echo ""
    echo "GIT COMMITS (Required):"
    echo "Create local commit before marking complete."
    echo ""
    echo "Format: [type]: [description]"
    echo ""
    echo "Task: [ID]"
    echo "Skill: $SKILL"
    echo ""
    echo "Do NOT push - local commits only."
    echo ""
    echo "OUTPUT FORMAT:"
    echo "You are running in a Terminal UI that cannot render Markdown."
    echo "- Plain text only - no code blocks, headers, bold, lists"
    echo "- Use blank lines for spacing, CAPITALS for emphasis"
    echo "- Keep output concise and readable"
    echo ""
    echo "DISCOVERED WORK PROTOCOL:"

    if [ "$TRACKER" = "beads" ]; then
        echo "- If you find out-of-scope work, create a beads task (see skill file)"
    else
        echo "- If you find out-of-scope work, create a Linear issue (mcp__linear__create_issue)"
    fi

    echo "- Do NOT do it inline - stay focused on current task"
    echo ""
    echo "COMPLETION MARKERS:"
    echo "- Task done: $TASK_COMPLETE_MARKER"
    echo "- All tasks done: $COMPLETION_MARKER"
    echo "- STOP immediately after outputting marker"
} > "$TEMP_PROMPT"

# Write prompt path for TUI
echo "$TEMP_PROMPT" > .claude/.build-prompt-path

# Build claude args
# Full permissions for build agents - they need to run bd commands, git, etc.
CLAUDE_ARGS=(--add-dir "$(dirname "$TEMP_PROMPT")" --add-dir "$(pwd)" --add-dir "$PLUGIN_DIR" --allow-dangerously-skip-permissions --dangerously-skip-permissions)

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
    #
    # PERMISSION HANDLING:
    # - Due to claude-code bugs, some tools (AskUserQuestion, ExitPlanMode) send permission denials
    #   even with --dangerously-skip-permissions enabled
    # - The TUI's spawner.go automatically approves by detecting permission denials
    #   (type="user" with is_error=true) and sending approvals via stdin
    # - This prevents API 400 errors from duplicate tool_results accumulating in conversation state
    # - See apps/tui-go/internal/process/spawner.go lines 1114-1165 for implementation
    #
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
