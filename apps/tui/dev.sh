#!/usr/bin/env bash
# Development launcher that passes the current directory as workspace context

# Get the current working directory (where the user ran this script from)
WORKSPACE=$(pwd)

echo "🚀 Starting Clive TUI in development mode"
echo "📁 Workspace: $WORKSPACE"
echo ""

# Run the dev server with workspace argument
bun run --watch src/main.tsx --debug --workspace="$WORKSPACE"
