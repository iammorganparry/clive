#!/bin/bash
# Quality Gates Runner
# Runs configured quality gates from .claude/quality-gates.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GATES_CONFIG="$PROJECT_ROOT/.claude/quality-gates.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed${NC}"
    exit 1
fi

# Check if config file exists
if [ ! -f "$GATES_CONFIG" ]; then
    echo -e "${YELLOW}Warning: Quality gates config not found at $GATES_CONFIG${NC}"
    echo "Skipping quality gates."
    exit 0
fi

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}         Running Quality Gates${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Track overall success
REQUIRED_FAILED=0
OPTIONAL_FAILED=0
TOTAL_GATES=0
PASSED_GATES=0

# Get all enabled gate names
GATE_NAMES=$(jq -r '.gates | to_entries[] | select(.value.enabled == true) | .key' "$GATES_CONFIG")

# Run each enabled gate
for GATE_NAME in $GATE_NAMES; do
    GATE_DESC=$(jq -r ".gates.\"$GATE_NAME\".description" "$GATES_CONFIG")
    echo -e "${BLUE}▶ $GATE_DESC${NC}"

    # Get commands for this gate
    COMMAND_COUNT=$(jq -r ".gates.\"$GATE_NAME\".commands | length" "$GATES_CONFIG")

    for i in $(seq 0 $((COMMAND_COUNT - 1))); do
        CMD_NAME=$(jq -r ".gates.\"$GATE_NAME\".commands[$i].name" "$GATES_CONFIG")
        CMD=$(jq -r ".gates.\"$GATE_NAME\".commands[$i].command" "$GATES_CONFIG")
        REQUIRED=$(jq -r ".gates.\"$GATE_NAME\".commands[$i].required" "$GATES_CONFIG")
        TIMEOUT=$(jq -r ".gates.\"$GATE_NAME\".commands[$i].timeout // 60" "$GATES_CONFIG")

        TOTAL_GATES=$((TOTAL_GATES + 1))

        echo -n "  • $CMD_NAME... "

        # Run command with timeout (if available, otherwise run without)
        # Execute in the project root directory
        (
            cd "$PROJECT_ROOT"
            if command -v timeout &> /dev/null; then
                timeout "$TIMEOUT" bash -c "$CMD"
            elif command -v gtimeout &> /dev/null; then
                gtimeout "$TIMEOUT" bash -c "$CMD"
            else
                bash -c "$CMD"
            fi
        ) > /tmp/gate-output-$$.log 2>&1

        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ PASSED${NC}"
            PASSED_GATES=$((PASSED_GATES + 1))
        else
            EXIT_CODE=$?
            if [ "$REQUIRED" = "true" ]; then
                echo -e "${RED}✗ FAILED (required)${NC}"
                REQUIRED_FAILED=$((REQUIRED_FAILED + 1))
                echo -e "${RED}    Output:${NC}"
                tail -20 /tmp/gate-output-$$.log | sed 's/^/    /'
            else
                echo -e "${YELLOW}⚠ FAILED (optional)${NC}"
                OPTIONAL_FAILED=$((OPTIONAL_FAILED + 1))
                echo -e "${YELLOW}    Output:${NC}"
                tail -10 /tmp/gate-output-$$.log | sed 's/^/    /'
            fi
        fi

        # Clean up temp file
        rm -f /tmp/gate-output-$$.log
    done

    echo ""
done

# Summary
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}         Quality Gates Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "Total gates: $TOTAL_GATES"
echo -e "Passed: ${GREEN}$PASSED_GATES${NC}"

if [ $OPTIONAL_FAILED -gt 0 ]; then
    echo -e "Failed (optional): ${YELLOW}$OPTIONAL_FAILED${NC}"
fi

if [ $REQUIRED_FAILED -gt 0 ]; then
    echo -e "Failed (required): ${RED}$REQUIRED_FAILED${NC}"
    echo ""
    echo -e "${RED}❌ Quality gates FAILED - required gates did not pass${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ All required quality gates passed!${NC}"
exit 0
