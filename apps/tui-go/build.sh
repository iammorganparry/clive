#!/bin/bash
# Build the CLIVE TUI
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Get git commit SHA (short version)
VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")

echo "Building clive (version: $VERSION)..."
go build -ldflags "-X github.com/clive/tui-go/internal/tui.Version=$VERSION" -o bin/clive ./cmd/clive-tui

echo "✓ Built: $SCRIPT_DIR/bin/clive (v$VERSION)"
