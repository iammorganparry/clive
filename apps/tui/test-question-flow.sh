#!/usr/bin/env bash
# Test script to trace question flow

echo "=== Testing Question Flow ==="
echo ""
echo "This will:"
echo "1. Clear the debug log"
echo "2. Start clive with --debug"
echo "3. Show you where to check the logs"
echo ""

# Clear old log
rm -f ~/.clive/tui-debug.log

echo "Starting clive with --debug..."
echo "In the TUI, run: /plan test question flow"
echo ""
echo "Then in another terminal, run:"
echo "  tail -f ~/.clive/tui-debug.log | grep -E '(Question|question|QUESTION|emit)'"
echo ""
echo "Look for these log entries in order:"
echo "  1. [CliManager] AskUserQuestion tool detected"
echo "  2. [CliManager] Question event pushed to outputs"
echo "  3. [CliManager] Emitting output event (with type: question)"
echo "  4. [useAppState] Received output event (with hasQuestion: true)"
echo "  5. [useAppState] Question detected, sending QUESTION event to state machine"
echo "  6. [useAppState] State machine: setQuestion action called"
echo "  7. [QuestionPanel] Component mounted"
echo ""
echo "If any of these are missing, that's where the flow breaks."
echo ""
read -p "Press Enter to start clive --debug..."

clive --debug
