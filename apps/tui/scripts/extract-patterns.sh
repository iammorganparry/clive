#!/bin/bash
# Pattern Extractor for Progress History
# Extracts architectural decisions, gotchas, and success patterns from progress files

set -euo pipefail

PROGRESS_FILE="${1:-}"
OUTPUT_FILE="${2:-/dev/stdout}"

if [ -z "$PROGRESS_FILE" ] || [ ! -f "$PROGRESS_FILE" ]; then
    echo "Usage: $0 <progress-file> [output-file]" >&2
    echo "  progress-file: Path to progress.md file to analyze" >&2
    echo "  output-file: Where to write patterns (default: stdout)" >&2
    exit 1
fi

# Colors for terminal output (only used if outputting to stdout)
if [ "$OUTPUT_FILE" = "/dev/stdout" ]; then
    BLUE='\033[0;34m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    NC='\033[0m' # No Color
else
    BLUE=''
    GREEN=''
    YELLOW=''
    NC=''
fi

{
    echo "# Patterns Discovered from Progress History"
    echo ""
    echo "_Generated: $(date '+%Y-%m-%d %H:%M:%S')_"
    echo "_Source: $PROGRESS_FILE_"
    echo ""
    echo "---"
    echo ""

    # Extract Architectural Decisions
    echo "## Architectural Decisions"
    echo ""
    ARCH_DECISIONS=$(grep -A 5 "Key decisions:" "$PROGRESS_FILE" 2>/dev/null | tail -20 || echo "")
    if [ -n "$ARCH_DECISIONS" ]; then
        echo "$ARCH_DECISIONS" | sed 's/^/  /'
    else
        echo "  _No architectural decisions recorded yet._"
    fi
    echo ""

    # Extract Common Gotchas/Pitfalls
    echo "## Common Gotchas & Pitfalls"
    echo ""
    GOTCHAS=$(grep -A 3 "Gotchas:" "$PROGRESS_FILE" 2>/dev/null | tail -15 || echo "")
    if [ -n "$GOTCHAS" ]; then
        echo "$GOTCHAS" | sed 's/^/  /'
    else
        echo "  _No gotchas recorded yet._"
    fi
    echo ""

    # Extract Successful Patterns
    echo "## Successful Patterns"
    echo ""
    SUCCESS_PATTERNS=$(grep -A 3 "Success pattern:" "$PROGRESS_FILE" 2>/dev/null | tail -15 || echo "")
    if [ -n "$SUCCESS_PATTERNS" ]; then
        echo "$SUCCESS_PATTERNS" | sed 's/^/  /'
    else
        echo "  _No success patterns recorded yet._"
    fi
    echo ""

    # Extract Failed Approaches (to avoid repeating)
    echo "## Failed Approaches (Avoid These)"
    echo ""
    FAILED_APPROACHES=$(grep -B 2 -A 2 "❌" "$PROGRESS_FILE" 2>/dev/null | grep -v "^--$" | tail -20 || echo "")
    if [ -n "$FAILED_APPROACHES" ]; then
        echo "$FAILED_APPROACHES" | sed 's/^/  /'
    else
        echo "  _No failed approaches recorded yet._"
    fi
    echo ""

    # Extract Recent Issues (last 10 iterations)
    echo "## Recent Issues Encountered"
    echo ""
    RECENT_ISSUES=$(grep -E "(Error:|Failed:|FAIL)" "$PROGRESS_FILE" 2>/dev/null | tail -10 || echo "")
    if [ -n "$RECENT_ISSUES" ]; then
        echo "$RECENT_ISSUES" | sed 's/^/  /'
    else
        echo "  _No recent issues recorded._"
    fi
    echo ""

    # Extract Iteration Summaries (last 5)
    echo "## Recent Iteration Summaries"
    echo ""
    ITERATION_SUMMARIES=$(grep -A 3 "^## Iteration" "$PROGRESS_FILE" 2>/dev/null | tail -25 || echo "")
    if [ -n "$ITERATION_SUMMARIES" ]; then
        echo "$ITERATION_SUMMARIES" | sed 's/^/  /'
    else
        echo "  _No iteration summaries available._"
    fi
    echo ""

    # Extract Dependencies/Blockers Mentioned
    echo "## Dependencies & Blockers"
    echo ""
    BLOCKERS=$(grep -iE "(blocked|blocker|dependency|depends on|waiting for)" "$PROGRESS_FILE" 2>/dev/null | tail -10 || echo "")
    if [ -n "$BLOCKERS" ]; then
        echo "$BLOCKERS" | sed 's/^/  /'
    else
        echo "  _No blockers or dependencies recorded._"
    fi
    echo ""

    # Stats
    echo "---"
    echo ""
    echo "### Statistics"
    echo ""
    TOTAL_ITERATIONS=$(grep -c "^## Iteration" "$PROGRESS_FILE" 2>/dev/null || echo "0")
    SUCCESS_COUNT=$(grep -c "✅" "$PROGRESS_FILE" 2>/dev/null || echo "0")
    FAIL_COUNT=$(grep -c "❌" "$PROGRESS_FILE" 2>/dev/null || echo "0")

    echo "- Total iterations: $TOTAL_ITERATIONS"
    echo "- Successes: $SUCCESS_COUNT"
    echo "- Failures: $FAIL_COUNT"

    if [ "$TOTAL_ITERATIONS" -gt 0 ]; then
        SUCCESS_RATE=$(awk "BEGIN {printf \"%.1f\", ($SUCCESS_COUNT / $TOTAL_ITERATIONS) * 100}")
        echo "- Success rate: ${SUCCESS_RATE}%"
    fi
    echo ""

} > "$OUTPUT_FILE"

if [ "$OUTPUT_FILE" != "/dev/stdout" ]; then
    echo -e "${GREEN}✓ Patterns extracted to: $OUTPUT_FILE${NC}" >&2
fi
