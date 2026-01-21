# Quick Debug Reference

## Enable Debug Logging

```bash
clive --debug
```

## View Debug Logs

```bash
# Real-time
tail -f ~/.clive/tui-debug.log

# View all
cat ~/.clive/tui-debug.log

# Search for specific events
grep "AskUserQuestion" ~/.clive/tui-debug.log
grep "sendToolResult" ~/.clive/tui-debug.log
grep "ERROR" ~/.clive/tui-debug.log
```

## Common Debug Scenarios

### Agent Hanging After Question

Look for this sequence in the logs:

1. Question detected:
   ```
   [CliManager] AskUserQuestion tool detected
   ```

2. User answered:
   ```
   [useAppState] handleQuestionAnswer called
   ```

3. Tool result sent:
   ```
   [CliManager] Tool result sent successfully
   ```

If the sequence stops before step 3, the issue is in the TUI.
If it stops after step 3, the issue is in the Claude CLI or API.

### CLI Execution Issues

Look for:
```
[CliManager] Starting execution
[CliManager] Execution completed successfully
```

Any errors between these indicate CLI problems.

### State Machine Issues

Look for:
```
[useAppState] Sending ANSWER event to state machine
```

Check if the state transitions properly from `waiting_for_answer` to `executing`.

## Help

For full documentation, see [DEBUG.md](./DEBUG.md)

To show help in TUI: Press `?` key
