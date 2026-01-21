# Debug Logging Guide

## Overview

The TUI now includes comprehensive debug logging to help troubleshoot issues like the agent hanging when asking questions.

## Log File Location

Debug logs are written to: `~/.clive/tui-debug.log`

You can tail the log in real-time:
```bash
tail -f ~/.clive/tui-debug.log
```

Or view the entire log:
```bash
cat ~/.clive/tui-debug.log
```

## Enabling Debug Mode

Debug logging can be enabled in several ways:

### Method 1: Using the --debug flag (Recommended)

```bash
# Run clive with debug flag
clive --debug

# Or use the short form
clive -d
```

When using the `--debug` flag, you'll see a message showing the log file location:
```
Debug logging enabled. Log file: /Users/you/.clive/tui-debug.log

Tail logs in another terminal: tail -f ~/.clive/tui-debug.log
```

### Method 2: Using the dev script

```bash
# From the project root
yarn workspace @clive/tui dev

# Or directly with bun
cd apps/tui
DEBUG=true NODE_ENV=development bun run src/main.tsx
```

### Method 3: Setting environment variables

```bash
DEBUG=true clive
# or
NODE_ENV=development clive
```

## What Gets Logged

The debug logs track the complete flow of question handling:

### 1. **Startup**
- When the TUI initializes
- Log file location

### 2. **CLI Execution** (`CliManager`)
- Execution start with prompt details
- Tool use events (including `AskUserQuestion`)
- Question data extraction
- Tool result sending
- Execution completion or errors

### 3. **Question Handling** (`useAppState`)
- When `handleQuestionAnswer` is called
- The answers being sent
- Tool use ID being used
- State machine transitions

### 4. **Claude CLI Service** (`claude-cli-service.ts`)
- Raw stdout/stderr from Claude CLI process
- Parsed events (tool_use, tool_result, text, etc.)
- Tool result messages being sent via stdin
- Process spawn and close events

## Debugging the Hanging Issue

When the agent hangs after asking a question, check the log file for:

1. **Question Detection**:
   ```
   [CliManager] AskUserQuestion tool detected
   [CliManager] Question data extracted
   [CliManager] Question event pushed to outputs
   ```

2. **User Answer**:
   ```
   [useAppState] handleQuestionAnswer called
   [useAppState] Pending question toolUseID: <id>
   [useAppState] Sending answers JSON: {"answers":{...}}
   ```

3. **Tool Result Sent**:
   ```
   [CliManager] sendToolResult called
   [CliManager] Sending tool result to handle
   [CliManager] Tool result sent successfully
   ```

4. **Claude CLI Response**:
   ```
   [ClaudeCliService] Sending tool result for <id>
   [ClaudeCliService] stdout chunk: {...}
   ```

## Common Issues

### Issue: No "Tool result sent successfully" log
**Cause**: CliManager doesn't have an active handle
**Fix**: Check if the CLI process is still running

### Issue: Tool result sent but no response from CLI
**Cause**: Tool result format issue or CLI stuck
**Fix**: Check the `[ClaudeCliService] Sending tool result for <id>` log to see the exact format sent

### Issue: "Agent is thinking..." persists
**Cause**: CLI waiting for tool result or processing response
**Fix**: Check if tool_result was properly received by CLI in the logs

## Example Log Session

```
[2025-01-21T10:30:00.000Z] [main] Clive TUI starting up
[2025-01-21T10:30:01.000Z] [CliManager] Starting execution
  Data: {
    "promptLength": 150,
    "model": "sonnet",
    "mode": "plan"
  }
[2025-01-21T10:30:05.000Z] [CliManager] AskUserQuestion tool detected
  Data: {
    "toolId": "toolu_01ABC123",
    "input": { "questions": [...] }
  }
[2025-01-21T10:30:05.000Z] [CliManager] Question data extracted
  Data: {
    "toolUseID": "toolu_01ABC123",
    "questionCount": 1
  }
[2025-01-21T10:30:10.000Z] [useAppState] handleQuestionAnswer called
  Data: {
    "answers": { "Scope": "Core functionality only" }
  }
[2025-01-21T10:30:10.000Z] [CliManager] sendToolResult called
  Data: {
    "toolId": "toolu_01ABC123",
    "resultLength": 45
  }
[2025-01-21T10:30:10.000Z] [CliManager] Tool result sent successfully
  Data: { "toolId": "toolu_01ABC123" }
```

## Clearing the Log File

The log file can grow large over time. To clear it:

```bash
rm ~/.clive/tui-debug.log
```

Or use the programmatic method (if added to the UI):
```typescript
import { clearLogFile } from './utils/debug-logger';
clearLogFile();
```

## Disabling Debug Mode

To run without debug logging:

```bash
bun run src/main.tsx
```

(Without the DEBUG or NODE_ENV environment variables)
