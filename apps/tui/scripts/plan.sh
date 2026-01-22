#!/bin/bash
# Plan command - creates work plan using beads epics/tasks
# Usage: ./plan.sh [--streaming] [custom request]

set -e

# Resolve symlinks to get the real script directory
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

PLUGIN_DIR="$SCRIPT_DIR/../commands"
PLAN_PROMPT="$PLUGIN_DIR/plan.md"
LOCAL_SKILLS_DIR=".claude/skills"

# Defaults
STREAMING=false
PARENT_ID=""

# Parse arguments
POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --streaming)
            STREAMING=true
            shift
            ;;
        --parent)
            PARENT_ID="$2"
            shift 2
            ;;
        *)
            POSITIONAL_ARGS+=("$1")
            shift
            ;;
    esac
done

# Restore positional args
set -- "${POSITIONAL_ARGS[@]}"

# Export parent ID for planning agent (if provided, skip creating a new parent issue)
export CLIVE_PARENT_ID="$PARENT_ID"

# Generate unique slug for plan file
PLAN_SLUG=$(date +%s)-$(openssl rand -hex 4 | cut -c1-8)

# Set plan file paths (native plan mode uses ~/.claude/plans/)
if [ -n "$PARENT_ID" ]; then
    # Epic-scoped plan in ~/.claude/plans/epics/{PARENT_ID}/{slug}.md
    PLAN_DIR="$HOME/.claude/plans/epics/$PARENT_ID"
    mkdir -p "$PLAN_DIR"
    export CLIVE_PLAN_FILE="$PLAN_DIR/$PLAN_SLUG.md"
    export CLIVE_PROGRESS_FILE="$PLAN_DIR/progress.txt"
else
    # New plan in ~/.claude/plans/{slug}.md
    PLAN_DIR="$HOME/.claude/plans"
    mkdir -p "$PLAN_DIR"
    export CLIVE_PLAN_FILE="$PLAN_DIR/$PLAN_SLUG.md"
    export CLIVE_PROGRESS_FILE="$HOME/.claude/plans/progress.txt"
fi

# Verify prompt file exists
if [ ! -f "$PLAN_PROMPT" ]; then
    echo "Error: Plan prompt not found at $PLAN_PROMPT"
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
    if ! command -v bd &> /dev/null; then
        echo "Error: Beads (bd) is required but not installed."
        exit 1
    fi
    # Initialize beads if not present (ignore error if already initialized)
    if [ ! -d ".beads" ]; then
        echo "Initializing beads..."
        bd init || true
    fi
elif [ "$TRACKER" = "linear" ]; then
    LINEAR_TEAM_ID=$(jq -r '.linear.team_id // empty' "$CLIVE_CONFIG" 2>/dev/null)
    if [ -z "$LINEAR_TEAM_ID" ]; then
        echo "Error: Linear team ID not configured in $CLIVE_CONFIG"
        exit 1
    fi
    export LINEAR_TEAM_ID
    echo "Using Linear tracker (team: $LINEAR_TEAM_ID)"
else
    echo "Error: Unknown tracker '$TRACKER'. Supported: beads, linear"
    exit 1
fi

# Get user input from remaining args
USER_INPUT="${*:-}"

echo "Creating work plan..."
echo "Request: $USER_INPUT"
echo ""

# Ensure directories exist for state files
mkdir -p .claude
mkdir -p "$PLAN_DIR"

# Create temp file for the processed prompt (with frontmatter stripped)
TEMP_PROMPT=$(mktemp)
mv "$TEMP_PROMPT" "${TEMP_PROMPT}.md"
TEMP_PROMPT="${TEMP_PROMPT}.md"
trap "rm -f $TEMP_PROMPT" EXIT

# Write prompt to temp file (strip frontmatter from source, inject args and context)
{
    echo "\$ARGUMENTS=\"$USER_INPUT\""
    echo "\$WORKING_DIRECTORY=\"$(pwd)\""
    echo ""
    echo "# Context"
    echo "You are working from: \`$(pwd)\`"
    echo "All bash commands will execute from this directory."
    echo "All file paths should be relative to this directory unless absolute paths are needed."
    echo ""
    sed '1{/^---$/!q;};1,/^---$/d' "$PLAN_PROMPT"
} > "$TEMP_PROMPT"

echo "Starting Claude planning session..."
echo ""

# Full permissions for plan agents - they need to run bd commands, git, etc.
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

# Add local skills directory if it exists (project-specific custom skills)
if [ -d "$LOCAL_SKILLS_DIR" ]; then
    CLAUDE_ARGS+=(--add-dir "$(pwd)/$LOCAL_SKILLS_DIR")
    LOCAL_SKILLS_COUNT=$(ls "$LOCAL_SKILLS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
    if [ "$LOCAL_SKILLS_COUNT" -gt 0 ]; then
        echo "Found $LOCAL_SKILLS_COUNT custom skill(s) in $LOCAL_SKILLS_DIR"
    fi
fi

if [ "$STREAMING" = true ]; then
    # Streaming mode for TUI - bidirectional communication via stdin/stdout
    # Write prompt path for TUI to read and send via stdin
    echo "$TEMP_PROMPT" > .claude/.plan-prompt-path

    # --output-format stream-json: responses streamed as NDJSON
    # --input-format stream-json: enables bidirectional communication (TUI sends prompt via stdin)
    # --permission-mode plan: Enforce plan mode - Claude can only read/analyze, not write/edit
    # --allow-dangerously-skip-permissions --dangerously-skip-permissions: Bypass permission prompts
    # --model opus: Use Opus for planning (200k context window, most capable model)
    # --tools: Include WebSearch and WebFetch for research during planning
    # -p: persistent session (maintains context across tool uses)
    #
    # CONTEXT WINDOW MANAGEMENT:
    # - Opus has a 200k token context window (input + output combined)
    # - Planning should stay well under this limit by focusing on high-level architecture
    # - If context is exceeded, claude-code will return an error and planning will fail
    # - To reduce context: limit file reads, use targeted Grep instead of full reads
    #
    # PERMISSION HANDLING:
    # - Due to claude-code bugs, some tools (AskUserQuestion, ExitPlanMode) send permission denials
    #   even with --dangerously-skip-permissions enabled
    # - The TUI's spawner.go automatically approves these by detecting permission denial events
    #   (type="user" with is_error=true) and sending approval responses via stdin
    # - This prevents API 400 errors from duplicate tool_results accumulating in conversation state
    # - See apps/tui-go/internal/process/spawner.go lines 1114-1165 for implementation
    #
    CLAUDE_ARGS=(-p --verbose --model opus --output-format stream-json --input-format stream-json --permission-mode plan --allow-dangerously-skip-permissions --dangerously-skip-permissions --tools "default" "${CLAUDE_ARGS[@]}")

    # Redirect stderr to log file to prevent UI flickering from build tool output
    mkdir -p "$HOME/.clive"
    claude "${CLAUDE_ARGS[@]}" 2>>"$HOME/.clive/claude-stderr.log"
else
    # Interactive mode - use Claude CLI directly with Opus model
    # --model opus: Use Opus for planning (200k context window, most capable model)
    # --permission-mode plan: Enforce plan mode - Claude can only read/analyze, not write/edit
    # Full permissions for planning agents - they need to explore codebase, ask questions
    claude --model opus --permission-mode plan "${CLAUDE_ARGS[@]}" \
        "Read and execute all instructions in the file: $TEMP_PROMPT"
fi

echo ""
echo ""
echo "Plan session complete."

# Verify plan file was created
if [ ! -f "$CLIVE_PLAN_FILE" ]; then
    echo "WARNING: Plan file not created at $CLIVE_PLAN_FILE" >&2
    echo "Claude may not be using EnterPlanMode/ExitPlanMode tools" >&2
    echo "Check ~/.clive/claude-stderr.log for errors" >&2
else
    echo "✓ Plan file created: $CLIVE_PLAN_FILE"

    # Verify plan has minimum expected content (basic completeness check)
    if grep -q "## Implementation" "$CLIVE_PLAN_FILE" 2>/dev/null; then
        echo "✓ Plan appears complete"
    else
        echo "WARNING: Plan file may be incomplete (missing Implementation section)" >&2
    fi
fi

# Show what was created (tracker-specific)
if [ "$TRACKER" = "beads" ]; then
    TASK_COUNT=$(bd list --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
    echo "Beads tasks: $TASK_COUNT"
    echo "Run 'bd list --tree' to see task hierarchy."
else
    echo "Issues created in Linear. Check your Linear workspace for details."
fi
