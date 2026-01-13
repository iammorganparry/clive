#!/bin/bash
# Test command - DEPRECATED: Use build.sh instead
# Usage: ./test.sh [--once] [--max-iterations N] [--fresh] [-i|--interactive] [extra context]

# Deprecation warning
echo "⚠️  'clive test' is deprecated. Use 'clive build' instead."
echo "   The test command will be removed in a future version."
echo ""

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
TEST_PROMPT="$PLUGIN_DIR/test.md"
PROGRESS_FILE=".claude/progress.txt"

# Completion markers (exact string match per Ralph Wiggum best practices)
COMPLETION_MARKER="<promise>ALL_SUITES_COMPLETE</promise>"
ITERATION_COMPLETE_MARKER="<promise>ITERATION_COMPLETE</promise>"

# Defaults
MAX_ITERATIONS=50
ONCE=false
FRESH=false
INTERACTIVE=false
EXTRA_CONTEXT=""

# Check for tailspin (tspin) for prettier log output
if command -v tspin &>/dev/null; then
    HAS_TSPIN=true
else
    HAS_TSPIN=false
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
        -i|--interactive)
            INTERACTIVE=true
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
    if [ -f ".claude/test-plan-latest.md" ]; then
        readlink -f ".claude/test-plan-latest.md" 2>/dev/null || echo ".claude/test-plan-latest.md"
    elif ls .claude/test-plan-*.md 1>/dev/null 2>&1; then
        ls -t .claude/test-plan-*.md 2>/dev/null | head -1
    else
        echo ".claude/test-plan.md"
    fi
}

PLAN_FILE=$(resolve_plan_file)

# Validate plan exists
if [ ! -f "$PLAN_FILE" ]; then
    echo "❌ No test plan found at $PLAN_FILE"
    echo "   Run 'clive plan' first to create a test plan."
    exit 1
fi

# Verify test prompt exists
if [ ! -f "$TEST_PROMPT" ]; then
    echo "❌ Error: Test prompt not found at $TEST_PROMPT"
    exit 1
fi

# Clear progress if --fresh
if [ "$FRESH" = true ]; then
    rm -f "$PROGRESS_FILE"
    echo "🧹 Cleared progress file"
fi

# Ensure .claude directory exists
mkdir -p .claude

# Initialize progress file if needed (will be appended to, not overwritten)
if [ ! -f "$PROGRESS_FILE" ]; then
    echo "# Test Implementation Progress" > "$PROGRESS_FILE"
    echo "Started: $(date -Iseconds)" >> "$PROGRESS_FILE"
    echo "" >> "$PROGRESS_FILE"
fi

echo "🚀 Starting Ralph Wiggum loop"
echo "   Plan: $PLAN_FILE"
if [ "$ONCE" = true ]; then
    echo "   Mode: Single iteration (--once)"
else
    echo "   Max iterations: $MAX_ITERATIONS"
fi
if [ "$INTERACTIVE" = true ]; then
    echo "   Interactive: yes (manual exit required)"
else
    echo "   Interactive: no (auto-exit after each iteration)"
fi
if [ "$HAS_TSPIN" = true ] && [ "$INTERACTIVE" = false ]; then
    echo "   Log highlighting: tailspin"
fi
echo "   Progress: $PROGRESS_FILE"
echo "   Completion marker: $COMPLETION_MARKER"
echo ""

# Note: Test prompt is no longer embedded - Claude reads it via allowed-tools

# Create temp file for iteration instructions
TEMP_PROMPT=$(mktemp)
mv "$TEMP_PROMPT" "${TEMP_PROMPT}.md"
TEMP_PROMPT="${TEMP_PROMPT}.md"

# Cleanup function
cleanup() {
    rm -f "$TEMP_PROMPT"
}
trap cleanup EXIT

# The Ralph Wiggum Loop
for ((i=1; i<=MAX_ITERATIONS; i++)); do
    if [ "$ONCE" = true ]; then
        echo "🔄 Running single iteration"
    else
        echo "🔄 Iteration $i/$MAX_ITERATIONS"
    fi
    echo ""

    # Build minimal context - don't embed file contents, let Claude read them
    {
        echo "# Test Implementation - Iteration $i/$MAX_ITERATIONS"
        echo ""
        echo "## Files to Read"
        echo "- Plan: $PLAN_FILE"
        echo "- Progress: $PROGRESS_FILE"
        echo ""
        if [ -n "$EXTRA_CONTEXT" ]; then
            echo "## Additional Context"
            echo "$EXTRA_CONTEXT"
            echo ""
        fi
        echo "## Instructions"
        echo ""
        echo "1. Check beads first: run 'bd ready' to find next task (if .beads/ exists)"
        echo "2. Read the plan file to get test details for that suite"
        echo "3. Implement ONE test suite only (follow test.md prompt)"
        echo "4. REQUIRED: Update status - run 'bd close [TASK_ID]' AND update plan file"
        echo "5. Output completion marker and STOP - do not continue to next suite"
        echo ""
        echo "## CRITICAL"
        echo "- Beads is the SOURCE OF TRUTH when available - use 'bd ready' not progress.txt"
        echo "- You MUST update beads AND plan file status after completing"
        echo "- Without status updates, the loop repeats forever"
        echo ""
        echo "## Completion Markers"
        echo "- Suite done: $ITERATION_COMPLETE_MARKER"
        echo "- All suites done: $COMPLETION_MARKER"
    } > "$TEMP_PROMPT"

    # Build claude command args
    CLAUDE_ARGS=(--add-dir "$(dirname "$TEMP_PROMPT")" --permission-mode acceptEdits)
    if [ "$INTERACTIVE" = false ]; then
        CLAUDE_ARGS=(-p "${CLAUDE_ARGS[@]}")
    fi

    # Invoke claude (pipe through tspin if available for prettier output)
    # Only use tspin in non-interactive mode (piping breaks stdin)
    if [ "$HAS_TSPIN" = true ] && [ "$INTERACTIVE" = false ]; then
        claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT" 2>&1 | tspin
    else
        claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT"
    fi

    # Check for full completion in progress file
    if grep -q "$COMPLETION_MARKER" "$PROGRESS_FILE" 2>/dev/null; then
        echo ""
        echo "✅ All test suites complete!"
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
