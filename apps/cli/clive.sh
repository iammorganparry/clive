#!/bin/bash
# Clive CLI - Ralph Wiggum loop for test planning and execution
# Usage: ./clive.sh <command> [args...]

set -e

# Resolve symlinks to get the real script directory
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

show_help() {
    echo "Clive - AI-powered test planning and execution"
    echo ""
    echo "Usage: clive <command> [options]"
    echo ""
    echo "Commands:"
    echo "  plan [input]     Create a test plan (single invocation)"
    echo "  test [options]   Run test implementation loop"
    echo ""
    echo "Test options:"
    echo "  --once           Run single iteration (for testing)"
    echo "  --max-iterations N  Set max iterations (default: 50)"
    echo "  --fresh          Clear progress file before starting"
    echo ""
    echo "Examples:"
    echo "  clive plan"
    echo "  clive plan \"add tests for auth module\""
    echo "  clive test --once"
    echo "  clive test --max-iterations 25"
}

case "${1:-}" in
    plan)
        shift
        "$SCRIPT_DIR/scripts/plan.sh" "$@"
        ;;
    test)
        shift
        "$SCRIPT_DIR/scripts/test.sh" "$@"
        ;;
    -h|--help|"")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
