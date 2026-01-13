#!/bin/bash
# Clive CLI - AI-powered work planning and execution
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
    echo "Clive - AI-powered work planning and execution"
    echo ""
    echo "Usage: clive [command] [options]"
    echo ""
    echo "When run without arguments, opens the TUI dashboard."
    echo ""
    echo "Commands:"
    echo "  (none)           Open TUI dashboard with slash commands"
    echo "  plan [input]     Create a work plan with category detection"
    echo "  build [options]  Execute work plan with skill-based dispatch"
    echo "  test [options]   (deprecated) Alias for 'build'"
    echo ""
    echo "Build options:"
    echo "  --once              Run single iteration"
    echo "  --max-iterations N  Set max iterations (default: 50)"
    echo "  --fresh             Clear progress file before starting"
    echo "  --skill SKILL       Override skill detection (unit-tests, feature, etc.)"
    echo "  -i, --interactive   Keep stdin open for manual interaction"
    echo ""
    echo "Categories detected by plan:"
    echo "  test      - Test implementation (unit-tests, integration-tests, e2e-tests)"
    echo "  feature   - New feature implementation"
    echo "  refactor  - Code restructuring"
    echo "  bugfix    - Bug fixing"
    echo "  docs      - Documentation"
    echo ""
    echo "Examples:"
    echo "  clive plan"
    echo "  clive plan \"add tests for auth module\""
    echo "  clive plan \"fix the login bug\""
    echo "  clive plan \"refactor the API client\""
    echo "  clive build --once"
    echo "  clive build --skill unit-tests"
}

# If no args, launch TUI dashboard
if [ $# -eq 0 ]; then
    exec node "$SCRIPT_DIR/../tui/bin/clive-tui.js"
fi

case "${1:-}" in
    plan)
        shift
        "$SCRIPT_DIR/scripts/plan.sh" "$@"
        ;;
    build)
        shift
        "$SCRIPT_DIR/scripts/build.sh" "$@"
        ;;
    test)
        # Deprecated - delegate to test.sh which shows warning then runs
        shift
        "$SCRIPT_DIR/scripts/test.sh" "$@"
        ;;
    -h|--help)
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
