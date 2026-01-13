#!/bin/bash
# Plan command - creates work plan using beads epics/tasks
# Usage: ./plan.sh [custom request]

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

# Verify prompt file exists
if [ ! -f "$PLAN_PROMPT" ]; then
    echo "Error: Plan prompt not found at $PLAN_PROMPT"
    exit 1
fi

# Check beads is available
if ! command -v bd &> /dev/null; then
    echo "Error: Beads (bd) is required but not installed."
    exit 1
fi

# Initialize beads if not present
if [ ! -d ".beads" ]; then
    echo "Initializing beads..."
    bd init
fi

# Get user input
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
echo "Note: Claude output appears below. The plan will create beads tasks."
echo ""
echo "---"

# Run claude interactively
# The --permission-mode acceptEdits allows Claude to make changes
# Output will stream to terminal (captured by TUI if running in TUI)
claude --add-dir "$(dirname "$TEMP_PROMPT")" --permission-mode acceptEdits \
    "Read and execute all instructions in the file: $TEMP_PROMPT" 2>&1

echo "---"
echo ""
echo "Plan session complete."

# Show what was created
TASK_COUNT=$(bd list --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
echo "Beads tasks: $TASK_COUNT"
echo "Run 'bd list --tree' to see task hierarchy."
