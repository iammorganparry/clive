#!/bin/bash
# Question test command - tests AskUserQuestion tool functionality
# Usage: ./question.sh [--streaming]

set -e

# Resolve symlinks to get the real script directory
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

# Defaults
STREAMING=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --streaming)
            STREAMING=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Create temp file for the prompt
TEMP_PROMPT=$(mktemp)
mv "$TEMP_PROMPT" "${TEMP_PROMPT}.md"
TEMP_PROMPT="${TEMP_PROMPT}.md"
trap "rm -f $TEMP_PROMPT" EXIT

# Write test prompt to temp file
cat > "$TEMP_PROMPT" <<'EOF'
Please use the AskUserQuestion tool to ask me the following questions:

1. First, ask a single question: "What is your favorite programming language?" with options:
   - TypeScript
   - Go
   - Python
   - Rust

2. After I answer, ask two questions together:
   - "What is your preferred database?" with options: PostgreSQL, MySQL, MongoDB
   - "What is your preferred hosting platform?" with options: AWS, GCP, Azure, Railway

Use proper AskUserQuestion tool format with headers, questions, and options.

After I answer both questions, say "Test complete!" and stop.
EOF

if [ "$STREAMING" = true ]; then
    # Streaming mode for TUI
    echo "Starting AskUserQuestion test (streaming mode)..." >&2

    # Ensure .claude directory exists
    mkdir -p .claude

    # Write prompt path for TUI to read and send via stdin
    echo "$TEMP_PROMPT" > .claude/.question-prompt-path

    # Build Claude args for streaming
    CLAUDE_ARGS=(-p --verbose --output-format stream-json --input-format stream-json --add-dir "$(dirname "$TEMP_PROMPT")" --add-dir "$(pwd)" --dangerously-skip-permissions)

    # Run claude with streaming
    claude "${CLAUDE_ARGS[@]}" 2>>"$HOME/.clive/claude-stderr.log"
else
    # Non-streaming mode
    echo "Starting AskUserQuestion test (non-streaming mode)..."

    # Run claude with the temp prompt file
    claude -p --add-dir "$(dirname "$TEMP_PROMPT")" --dangerously-skip-permissions \
        "Read and execute the instructions in: $TEMP_PROMPT"
fi

echo ""
echo "Question test complete."
