#!/usr/bin/env bash
# Clive TUI Launcher
# Quick script to run the TypeScript TUI for development/testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Launching Clive TUI..."
echo ""
echo "Keyboard shortcuts:"
echo "  q / Esc    - Quit"
echo "  ?          - Help"
echo "  Ctrl+C     - Interrupt"
echo ""
echo "Commands:"
echo "  /plan <prompt>  - Create a plan"
echo "  /build <prompt> - Execute build"
echo "  /clear          - Clear output"
echo "  /cancel         - Stop execution"
echo "  /help           - Show help"
echo ""
echo "---"
echo ""

exec bun run src/main.tsx
