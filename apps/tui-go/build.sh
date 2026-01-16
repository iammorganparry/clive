#!/bin/bash
# Build the CLIVE TUI
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building clive-tui..."
go build -o bin/clive-tui ./cmd/clive-tui

echo "✓ Built: $SCRIPT_DIR/bin/clive-tui"
