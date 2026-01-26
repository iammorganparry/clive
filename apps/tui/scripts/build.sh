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

PLUGIN_DIR="$SCRIPT_DIR/.."
SKILLS_DIR="$PLUGIN_DIR/skills"
LOCAL_SKILLS_DIR=".claude/skills"
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
WORKTREE_PATH_OVERRIDE=""

# Check for tailspin (tspin) for prettier log output
if command -v tspin &>/dev/null; then
    HAS_TSPIN=true
else
    HAS_TSPIN=false
fi

# Check for jq (required for beads JSON parsing)
if ! command -v jq &>/dev/null; then
    echo "❌ Error: jq not found. Install with: brew install jq"
    exit 1
fi

# Check if beads is available (REQUIRED)
if ! command -v bd &>/dev/null; then
    echo "❌ Error: Beads (bd) is required but not installed."
    exit 1
fi

if [ ! -d ".beads" ]; then
    echo "❌ Error: No .beads directory found. Run 'bd init' first."
    exit 1
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
        --worktree-path)
            WORKTREE_PATH_OVERRIDE="$2"
            shift 2
            ;;
        *)
            EXTRA_CONTEXT="$EXTRA_CONTEXT $1"
            shift
            ;;
    esac
done

# Verify skills directory exists
if [ ! -d "$SKILLS_DIR" ]; then
    echo "❌ Error: Skills directory not found at $SKILLS_DIR"
    exit 1
fi

# ============================================================================
# WORKTREE SETUP - Creates isolated git worktree for epic execution
# ============================================================================
#
# This enables multiple workers to run on the same machine independently.
# Each epic gets its own worktree directory with separate git branch.
#
# Directory structure created:
#   ~/repos/
#   ├── project/                    # Main repo
#   └── project-worktrees/          # Worktree parent dir
#       ├── feature-one/            # Epic 1 worktree
#       └── feature-two/            # Epic 2 worktree

# Helper: slugify text (convert to lowercase, replace non-alphanumeric with dashes)
slugify() {
    echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//'
}

# Track original directory for reference
ORIGINAL_WORKING_DIR="$(pwd)"
WORKING_DIR="$ORIGINAL_WORKING_DIR"
WORKTREE_ACTIVE=false
BRANCH_NAME=""

# Setup worktree if epic filter is specified
if [ -n "$EPIC_FILTER" ]; then
    # Get epic metadata from beads
    EPIC_METADATA=$(bd show "$EPIC_FILTER" --json 2>/dev/null || echo "{}")

    # Try to get worktree metadata from epic
    WORKTREE_NAME=$(echo "$EPIC_METADATA" | jq -r '.metadata.worktreeName // empty' 2>/dev/null)
    WORKTREE_PATH=$(echo "$EPIC_METADATA" | jq -r '.metadata.worktreePath // empty' 2>/dev/null)
    BASE_BRANCH=$(echo "$EPIC_METADATA" | jq -r '.metadata.baseBranch // "main"' 2>/dev/null)
    BRANCH_NAME=$(echo "$EPIC_METADATA" | jq -r '.metadata.branchName // empty' 2>/dev/null)

    # Override worktree path if provided via CLI
    if [ -n "$WORKTREE_PATH_OVERRIDE" ]; then
        WORKTREE_PATH="$WORKTREE_PATH_OVERRIDE"
    fi

    # If no worktree metadata, derive from epic title
    if [ -z "$WORKTREE_NAME" ] && [ -n "$EPIC_METADATA" ]; then
        EPIC_TITLE=$(echo "$EPIC_METADATA" | jq -r '.title // empty' 2>/dev/null)
        if [ -n "$EPIC_TITLE" ]; then
            WORKTREE_NAME=$(slugify "$EPIC_TITLE")
        fi
    fi

    # If we have a worktree name, setup the worktree
    if [ -n "$WORKTREE_NAME" ]; then
        # Get repo info from current directory
        REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
        if [ -z "$REPO_ROOT" ]; then
            echo "⚠️  Warning: Not in a git repository, skipping worktree setup"
        else
            REPO_NAME=$(basename "$REPO_ROOT")
            WORKTREES_DIR="$(dirname "$REPO_ROOT")/${REPO_NAME}-worktrees"

            # Set worktree path if not already set
            if [ -z "$WORKTREE_PATH" ]; then
                WORKTREE_PATH="${WORKTREES_DIR}/${WORKTREE_NAME}"
            fi

            # Generate branch name if not provided
            if [ -z "$BRANCH_NAME" ]; then
                # Use epic filter ID as branch prefix (e.g., "TRI-123-feature-name")
                BRANCH_NAME="${EPIC_FILTER}-${WORKTREE_NAME}"
            fi

            # Create worktrees parent directory if needed
            if [ ! -d "$WORKTREES_DIR" ]; then
                echo "📁 Creating worktrees directory: $WORKTREES_DIR"
                mkdir -p "$WORKTREES_DIR"
            fi

            # Check if worktree already exists
            if [ -d "$WORKTREE_PATH" ]; then
                echo "📂 Worktree exists: $WORKTREE_PATH"

                # Check if on correct branch
                CURRENT_BRANCH=$(git -C "$WORKTREE_PATH" branch --show-current 2>/dev/null)
                if [ "$CURRENT_BRANCH" != "$BRANCH_NAME" ]; then
                    echo "⚠️  Worktree on branch '$CURRENT_BRANCH', switching to '$BRANCH_NAME'"
                    git -C "$WORKTREE_PATH" checkout "$BRANCH_NAME" 2>/dev/null || \
                    git -C "$WORKTREE_PATH" checkout -b "$BRANCH_NAME" 2>/dev/null || \
                    echo "   Note: Could not switch branches, continuing on $CURRENT_BRANCH"
                fi
            else
                # Create new worktree with branch
                echo "📂 Creating worktree: $WORKTREE_NAME"
                echo "   Path: $WORKTREE_PATH"
                echo "   Branch: $BRANCH_NAME"
                echo "   Base: $BASE_BRANCH"

                # Fetch latest from remote
                git fetch origin "$BASE_BRANCH" 2>/dev/null || true

                # Create worktree with new branch based on origin/main (or base branch)
                if git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "origin/$BASE_BRANCH" 2>/dev/null; then
                    echo "✅ Worktree created successfully"

                    # Install dependencies in fresh worktree
                    echo "📦 Installing dependencies in new worktree..."
                    if [ -f "$WORKTREE_PATH/yarn.lock" ]; then
                        (cd "$WORKTREE_PATH" && yarn install --frozen-lockfile 2>/dev/null || yarn install)
                        echo "✅ Dependencies installed"

                        # Build packages if this is a monorepo with a build:packages script
                        if [ -f "$WORKTREE_PATH/package.json" ] && grep -q '"build:packages"' "$WORKTREE_PATH/package.json" 2>/dev/null; then
                            echo "🔨 Building packages..."
                            (cd "$WORKTREE_PATH" && yarn build:packages 2>/dev/null || yarn build 2>/dev/null || true)
                            echo "✅ Packages built"
                        fi
                    elif [ -f "$WORKTREE_PATH/package-lock.json" ]; then
                        (cd "$WORKTREE_PATH" && npm ci 2>/dev/null || npm install)
                        echo "✅ Dependencies installed"
                    elif [ -f "$WORKTREE_PATH/pnpm-lock.yaml" ]; then
                        (cd "$WORKTREE_PATH" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
                        echo "✅ Dependencies installed"
                    fi
                else
                    # Fallback: try creating without -b flag (branch might exist)
                    if git worktree add "$WORKTREE_PATH" "$BRANCH_NAME" 2>/dev/null; then
                        echo "✅ Worktree created (existing branch)"
                    else
                        echo "⚠️  Warning: Could not create worktree, continuing in main repo"
                        WORKTREE_PATH=""
                    fi
                fi
            fi

            # Change to worktree directory if setup succeeded
            if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
                echo "📍 Working in: $WORKTREE_PATH"
                cd "$WORKTREE_PATH"
                WORKING_DIR="$WORKTREE_PATH"
                WORKTREE_ACTIVE=true

                # Write worktree state for other tools
                mkdir -p .claude
                echo "$WORKTREE_PATH" > .claude/.worktree-path
                echo "$BRANCH_NAME" > .claude/.worktree-branch
                echo "$ORIGINAL_WORKING_DIR" > .claude/.worktree-origin
            fi
        fi
    fi
fi

echo ""

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
echo "$MAX_ITERATIONS" > .claude/.build-max-iterations

echo "🚀 Starting build loop"
echo "   Task source: beads (bd ready)"
echo "   Built-in skills: $SKILLS_DIR"
if [ -d "$LOCAL_SKILLS_DIR" ] && [ -n "$(ls -A "$LOCAL_SKILLS_DIR" 2>/dev/null)" ]; then
    echo "   📦 Local skills: $LOCAL_SKILLS_DIR ($(ls "$LOCAL_SKILLS_DIR" | wc -l | tr -d ' ') custom skills found)"
fi
if [ -n "$EPIC_FILTER" ]; then
    echo "   Epic: $EPIC_FILTER"
fi
if [ "$WORKTREE_ACTIVE" = true ]; then
    echo "   🌲 Worktree: $WORKTREE_PATH"
    echo "   🌿 Branch: $BRANCH_NAME"
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
# Priority: 1) Local project skills (.claude/skills), 2) Built-in skills, 3) Default to feature
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

    if [ -z "$SKILL_OVERRIDE" ]; then
        # Get next task from beads, optionally filtered by epic
        if [ -n "$EPIC_FILTER" ]; then
            # Filter ready tasks to those under the specified epic
            # Derive parent from ID convention: "epic-id.1" -> parent is "epic-id"
            # Uses .parent if set, otherwise derives from ID by removing last .N segment
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
        echo "- Working directory: \`$(pwd)\`"
        echo "- Task source: beads (bd ready)"
        echo "- Progress: $PROGRESS_FILE"
        echo "- Skill: $SKILL"
        if [ -n "$TASK_ID" ]; then
            echo "- Task ID: $TASK_ID"
            echo "- Task: $TASK_TITLE"
        fi
        if [ "$WORKTREE_ACTIVE" = true ]; then
            echo ""
            echo "## Worktree Context"
            echo "- **Worktree Active:** Yes"
            echo "- **Worktree Path:** \`$WORKTREE_PATH\`"
            echo "- **Branch:** \`$BRANCH_NAME\`"
            echo "- **Main Repo:** \`$ORIGINAL_WORKING_DIR\`"
            echo ""
            echo "**Important:** You are working in an isolated git worktree. All changes are on branch \`$BRANCH_NAME\`."
            echo "Commits in this worktree do not affect the main repo until the branch is merged."
        fi
        echo ""
        echo "**Note:** All bash commands execute from the working directory above. File paths are relative to this directory."
        echo ""
        if [ -n "$EXTRA_CONTEXT" ]; then
            echo "## Additional Context"
            echo "$EXTRA_CONTEXT"
            echo ""
        fi
        echo "## Instructions"
        echo ""
        echo "1. Read the skill file for execution instructions: $SKILL_FILE"
        echo "2. Use beads as source of truth: run 'bd show $TASK_ID' for task details"
        echo "3. Execute ONE task only following the skill instructions"
        echo "4. Update beads status after completion: bd close $TASK_ID"
        echo "5. Output completion marker and STOP"
        echo ""
        echo "## Completion Markers"
        echo "- Task done: $TASK_COMPLETE_MARKER"
        echo "- All tasks done: $COMPLETION_MARKER"
        echo ""
        echo "## CRITICAL"
        echo "- Follow the skill file instructions exactly"
        echo "- Update beads status (bd close) when task is complete"
        echo "- Create a LOCAL git commit before outputting completion marker"
        echo "- STOP immediately after outputting completion marker"
        echo "- If you discover out-of-scope work, create a beads task for it (see skill file)"
    } > "$TEMP_PROMPT"

    # Build claude args
    # --add-dir gives Claude access to read files
    # --permission-mode acceptEdits allows file edits without prompting
    # but still requires approval for dangerous operations (bash, etc.)
    # Full permissions for build agents - they need to run bd commands, git, etc.
    CLAUDE_ARGS=(--add-dir "$(dirname "$TEMP_PROMPT")" --add-dir "$(pwd)" --add-dir "$PLUGIN_DIR" --dangerously-skip-permissions)

    # Add local skills directory if it exists (project-specific custom skills)
    if [ -d "$LOCAL_SKILLS_DIR" ]; then
        CLAUDE_ARGS+=(--add-dir "$(pwd)/$LOCAL_SKILLS_DIR")
    fi

    if [ "$STREAMING" = true ]; then
        # Streaming mode for TUI - NDJSON output for parsing
        # --output-format stream-json: responses streamed as NDJSON
        # -p: persistent session (maintains context across iterations)
        #
        # Note: prompt is passed as CLI argument (not stdin) to allow multi-iteration loops
        # Using stdin for prompts breaks loops since stdin closes after first iteration
        #
        # PERMISSION HANDLING:
        # - Due to claude-code bugs, some tools (AskUserQuestion, ExitPlanMode) send permission denials
        #   even with --dangerously-skip-permissions enabled
        # - The TUI's spawner.go automatically approves by detecting permission denials
        #   (type="user" with is_error=true) and sending approvals via stdin
        # - This prevents API 400 errors from duplicate tool_results accumulating in conversation state
        # - Works even though prompts come via CLI args - stdin is still open for bidirectional communication
        # - See apps/tui-go/internal/process/spawner.go lines 1114-1165 for implementation
        #
        CLAUDE_ARGS=(-p --verbose --output-format stream-json "${CLAUDE_ARGS[@]}")
    elif [ "$INTERACTIVE" = false ]; then
        # Non-interactive, non-streaming mode (e.g., with tspin)
        CLAUDE_ARGS=(-p --verbose --output-format stream-json "${CLAUDE_ARGS[@]}")
    fi

    # Invoke claude - use CLI directly for streaming (TUI), docker sandbox for interactive
    if [ "$STREAMING" = true ]; then
        # Streaming mode - prompt passed as file argument, NDJSON output
        # NOT using stdin for prompt because it breaks multi-iteration loops
        # (stdin closes after first iteration, subsequent iterations get EOF)
        echo "$TEMP_PROMPT" > .claude/.build-prompt-path
        claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT" 2>&1
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
