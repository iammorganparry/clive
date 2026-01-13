#!/bin/bash
# Plan command - single invocation to create work plan
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
PLAN_OUTPUT=".claude/work-plan-latest.md"

# Completion marker (exact string match per Ralph Wiggum best practices)
COMPLETION_MARKER="<promise>PLAN_COMPLETE</promise>"

# Verify prompt file exists
if [ ! -f "$PLAN_PROMPT" ]; then
    echo "❌ Error: Plan prompt not found at $PLAN_PROMPT"
    exit 1
fi

# Get user input
USER_INPUT="${*:-}"

echo "🔍 Creating work plan..."
echo ""

# Ensure .claude directory exists
mkdir -p .claude

# Remove completion markers from existing plan files to prevent watcher triggering early
for existing_plan in .claude/work-plan-*.md; do
    if [ -f "$existing_plan" ]; then
        # Remove the completion marker line if present
        sed -i '' '/<promise>PLAN_COMPLETE<\/promise>/d' "$existing_plan" 2>/dev/null || true
    fi
done

# Create temp file for the processed prompt (with frontmatter stripped)
TEMP_PROMPT=$(mktemp)
mv "$TEMP_PROMPT" "${TEMP_PROMPT}.md"
TEMP_PROMPT="${TEMP_PROMPT}.md"
trap "rm -f $TEMP_PROMPT" EXIT

# Write prompt to temp file (strip frontmatter from source)
{
    echo "\$ARGUMENTS=\"$USER_INPUT\""
    echo ""
    sed '1{/^---$/!q;};1,/^---$/d' "$PLAN_PROMPT"
} > "$TEMP_PROMPT"

echo "   Instructions: $TEMP_PROMPT"
echo "   Output: $PLAN_OUTPUT"
echo "   Completion marker: $COMPLETION_MARKER"
echo ""

# Cleanup function
cleanup() {
    [ -n "$WATCHER_PID" ] && kill $WATCHER_PID 2>/dev/null || true
    rm -f "$TEMP_PROMPT"
}
trap cleanup EXIT

# Background watcher: monitors for plan file with completion marker
(
    while true; do
        sleep 2
        # Check if plan file exists and contains completion marker
        if [ -f "$PLAN_OUTPUT" ]; then
            # Resolve symlink to get actual file
            ACTUAL_PLAN=$(readlink "$PLAN_OUTPUT" 2>/dev/null || echo "$PLAN_OUTPUT")
            if [ -f ".claude/$ACTUAL_PLAN" ]; then
                ACTUAL_PLAN=".claude/$ACTUAL_PLAN"
            fi
            if grep -q "$COMPLETION_MARKER" "$ACTUAL_PLAN" 2>/dev/null; then
                sleep 2
                pkill -INT -P $$ claude 2>/dev/null || true
                break
            fi
        fi
        # Also check any work-plan files for the marker
        for plan in .claude/work-plan-*.md; do
            if [ -f "$plan" ] && grep -q "$COMPLETION_MARKER" "$plan" 2>/dev/null; then
                sleep 2
                pkill -INT -P $$ claude 2>/dev/null || true
                break 2
            fi
        done
    done
) &
WATCHER_PID=$!

# Invoke claude interactively - streams output directly to terminal
claude --add-dir "$(dirname "$TEMP_PROMPT")" --permission-mode acceptEdits \
    "Read and execute all instructions in the file: $TEMP_PROMPT"

# Kill watcher
kill $WATCHER_PID 2>/dev/null || true

echo ""
if [ -f "$PLAN_OUTPUT" ]; then
    echo "✅ Plan written to $PLAN_OUTPUT"
    echo "   Run 'clive build' to execute the plan."
else
    echo "⚠️  Plan session ended. Check if plan was created at $PLAN_OUTPUT"
fi
