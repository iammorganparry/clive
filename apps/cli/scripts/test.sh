#!/bin/bash
# Test command - Ralph Wiggum loop for test implementation
# Usage: ./test.sh [--once] [--max-iterations N] [--fresh] [-i|--interactive] [extra context]

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
echo "   Progress: $PROGRESS_FILE"
echo "   Completion marker: $COMPLETION_MARKER"
echo ""

# Read test prompt content (strip frontmatter)
TEST_PROMPT_CONTENT=$(sed '1{/^---$/!q;};1,/^---$/d' "$TEST_PROMPT")

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

    # Read current plan and progress
    PLAN_CONTENT=$(cat "$PLAN_FILE")
    PROGRESS_CONTENT=$(cat "$PROGRESS_FILE")

    # Build context block
    CONTEXT_BLOCK=""
    if [ -n "$EXTRA_CONTEXT" ]; then
        CONTEXT_BLOCK="## Additional Context
$EXTRA_CONTEXT

---

"
    fi

    # Write combined prompt to temp file
    # Key: Tell Claude to APPEND to progress.txt (not overwrite)
    {
        echo "## Test Plan"
        echo "$PLAN_CONTENT"
        echo ""
        echo "## Progress So Far"
        echo "$PROGRESS_CONTENT"
        echo ""
        echo "$CONTEXT_BLOCK"
        echo "$TEST_PROMPT_CONTENT"
        echo ""
        echo "=============================================="
        echo "IMPORTANT INSTRUCTIONS (MUST FOLLOW):"
        echo "=============================================="
        echo ""
        echo "Plan file: $PLAN_FILE"
        echo "Progress file: $PROGRESS_FILE"
        echo "Iteration: $i/$MAX_ITERATIONS"
        echo ""
        echo "STEP 0: REVIEW PROGRESS (above) - Check what was completed in previous iterations"
        echo "   - The '## Progress So Far' section shows work from previous iterations"
        echo "   - Do NOT repeat work that was already completed"
        echo "   - If a suite is marked 'complete' in progress, it's DONE"
        echo ""
        echo "STEP 1: Find the FIRST suite with Status: pending or in_progress from the embedded plan above"
        echo "   - Skip any suites already marked complete/blocked/skipped in the plan"
        echo ""
        echo "STEP 2: IMMEDIATELY update plan file status to in_progress:"
        echo "   Edit $PLAN_FILE to change: '- [ ] **Status:** pending' to '- [ ] **Status:** in_progress'"
        echo ""
        echo "STEP 3: Implement the test suite and verify tests pass"
        echo ""
        echo "STEP 4: Update plan file status when done:"
        echo "   - If tests PASS: change to '- [x] **Status:** complete'"
        echo "   - If tests FAIL after 5+ attempts: change to '- [ ] **Status:** blocked'"
        echo ""
        echo "STEP 5: APPEND progress summary to $PROGRESS_FILE (REQUIRED):"
        echo "   Use this format:"
        echo "   ---"
        echo "   ## Iteration $i - [Suite Name]"
        echo "   - Status: [complete/blocked/in_progress]"
        echo "   - Tests: [X passing / Y total]"
        echo "   - Summary: [brief description of work done]"
        echo "   ---"
        echo ""
        echo "STEP 6: Output completion marker:"
        echo "   - If this suite is done: $ITERATION_COMPLETE_MARKER"
        echo "   - If ALL suites are done: $COMPLETION_MARKER"
        echo ""
        echo "=============================================="
    } > "$TEMP_PROMPT"

    # Build claude command args
    CLAUDE_ARGS=(--add-dir "$(dirname "$TEMP_PROMPT")" --permission-mode acceptEdits)
    if [ "$INTERACTIVE" = false ]; then
        CLAUDE_ARGS=(-p "${CLAUDE_ARGS[@]}")
    fi

    # Invoke claude
    claude "${CLAUDE_ARGS[@]}" "Read and execute all instructions in the file: $TEMP_PROMPT"

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
