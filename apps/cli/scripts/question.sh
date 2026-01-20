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

if [ "$STREAMING" = true ]; then
    # Streaming mode for TUI
    echo "Starting AskUserQuestion test (streaming mode)..." >&2

    # Build Claude args for streaming
    CLAUDE_ARGS=(-p --verbose --output-format stream-json --input-format stream-json)

    # Create a simple prompt that asks Claude to use AskUserQuestion
    PROMPT="Please use the AskUserQuestion tool to ask me the following questions:

1. A single question asking: \"What is your favorite programming language?\" with options: TypeScript, Go, Python, Rust
2. Then after I answer, ask a multi-question asking:
   - \"What is your preferred database?\" with options: PostgreSQL, MySQL, MongoDB
   - \"What is your preferred hosting platform?\" with options: AWS, GCP, Azure, Railway

Use proper AskUserQuestion tool format with headers, questions, and options.

After I answer both questions, say 'Test complete!' and exit."

    # Run claude with the test prompt
    claude "${CLAUDE_ARGS[@]}" "$PROMPT" 2>>"$HOME/.clive/claude-stderr.log"
else
    # Non-streaming mode
    echo "Starting AskUserQuestion test (non-streaming mode)..."

    PROMPT="Please use the AskUserQuestion tool to ask me: \"What is your favorite programming language?\" with options: TypeScript, Go, Python, Rust. Use proper AskUserQuestion format."

    claude -p "$PROMPT"
fi
