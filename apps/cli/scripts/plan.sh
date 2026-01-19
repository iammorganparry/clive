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

PLUGIN_DIR="$SCRIPT_DIR/../../claude-code-plugin/commands"
PLAN_PROMPT="$PLUGIN_DIR/plan.md"

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

# Set epic-scoped paths for plan files
if [ -n "$PARENT_ID" ]; then
    EPIC_DIR=".claude/epics/$PARENT_ID"
    mkdir -p "$EPIC_DIR"
    export CLIVE_PLAN_FILE="$EPIC_DIR/current-plan.md"
    export CLIVE_PROGRESS_FILE="$EPIC_DIR/progress.txt"
else
    export CLIVE_PLAN_FILE=".claude/current-plan.md"
    export CLIVE_PROGRESS_FILE=".claude/progress.txt"
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

# Ensure .claude directory exists for state files
mkdir -p .claude

# Create temp file for the processed prompt (with frontmatter stripped)
TEMP_PROMPT=$(mktemp)
mv "$TEMP_PROMPT" "${TEMP_PROMPT}.md"
TEMP_PROMPT="${TEMP_PROMPT}.md"
trap "rm -f $TEMP_PROMPT" EXIT

# Write prompt to temp file (strip frontmatter from source, inject args)
{
    echo "\$ARGUMENTS=\"$USER_INPUT\""
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

if [ "$STREAMING" = true ]; then
    # Streaming mode for TUI - bidirectional communication via stdin/stdout
    # Write prompt path for TUI to read and send via stdin
    echo "$TEMP_PROMPT" > .claude/.plan-prompt-path

    # --input-format stream-json: prompt sent via stdin as JSON
    # --output-format stream-json: responses streamed as NDJSON
    # --permission-mode plan: Enforce plan mode - Claude can only read/analyze, not write/edit
    CLAUDE_ARGS=(-p --verbose --output-format stream-json --input-format stream-json --permission-mode plan "${CLAUDE_ARGS[@]}")
    # Redirect stderr to log file to prevent UI flickering from build tool output
    mkdir -p "$HOME/.clive"
    claude "${CLAUDE_ARGS[@]}" 2>>"$HOME/.clive/claude-stderr.log"
else
    # Interactive mode - use Docker sandbox (isolated environment with full permissions)
    docker sandbox run claude --dangerously-skip-permissions \
        --add-dir "$(dirname "$TEMP_PROMPT")" \
        "Read and execute all instructions in the file: $TEMP_PROMPT"
fi

echo ""
echo ""
echo "Plan session complete."

# Show what was created (tracker-specific)
if [ "$TRACKER" = "beads" ]; then
    TASK_COUNT=$(bd list --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
    echo "Beads tasks: $TASK_COUNT"
    echo "Run 'bd list --tree' to see task hierarchy."
else
    echo "Issues created in Linear. Check your Linear workspace for details."
fi
