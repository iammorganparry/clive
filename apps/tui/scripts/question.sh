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
    # Use dangerously-skip-permissions to bypass all permission checks including AskUserQuestion
    CLAUDE_ARGS=(--verbose --output-format stream-json --input-format stream-json --add-dir "$(dirname "$TEMP_PROMPT")" --add-dir "$(pwd)" --allow-dangerously-skip-permissions --dangerously-skip-permissions)

    # Create JSON message for stdin using jq with file input (handles newlines correctly)
    # Use -c for compact output (single line) as required by stream-json format
    USER_MESSAGE=$(jq -Rsc '{type: "user", message: {role: "user", content: .}}' "$TEMP_PROMPT")

    # Run claude with streaming, sending prompt via stdin
    echo "$USER_MESSAGE" | claude "${CLAUDE_ARGS[@]}" 2>>"$HOME/.clive/claude-stderr.log"
else
    # Non-streaming mode
    echo "Starting AskUserQuestion test (non-streaming mode)..."

    # Run claude with the temp prompt file
    claude --add-dir "$(dirname "$TEMP_PROMPT")" --allow-dangerously-skip-permissions --dangerously-skip-permissions \
        "Read and execute the instructions in: $TEMP_PROMPT"
fi

echo ""
echo "Question test complete."
