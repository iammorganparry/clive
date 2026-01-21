# Clive TUI Testing Guide

## Quick Start

```bash
cd apps/tui
bun run src/main.tsx
```

## Manual Testing Checklist

### ✅ Basic Rendering
- [ ] TUI launches without crashes
- [ ] Header displays "Clive TUI | IDLE"
- [ ] Output panel shows placeholder text
- [ ] Input bar is visible at bottom

### ✅ Keyboard Shortcuts
- [ ] Press `q` → Exits TUI
- [ ] Press `Esc` → Exits TUI
- [ ] Press `?` → Shows help message
- [ ] Press `Ctrl+C` → Interrupts running command

### ✅ Command Execution

#### Test /help Command
1. Type `/help` in input bar
2. Press Enter
3. Expected: Help text displays in output panel

#### Test /plan Command
1. Type `/plan Write a hello world function`
2. Press Enter
3. Expected:
   - Header changes to "Clive TUI | RUNNING"
   - System message: "Starting plan mode..."
   - Tool calls appear (e.g., "● Read", "● Grep")
   - Assistant messages with planning text
   - Header returns to "IDLE" when complete

#### Test /build Command
1. Type `/build Implement the hello world function`
2. Press Enter
3. Expected:
   - Header shows "RUNNING"
   - Tool calls execute (Read, Write, Edit, Bash)
   - File diffs display for Write/Edit operations
   - Metadata shows (duration, tokens, cost)
   - Completes with exit event

#### Test /clear Command
1. Execute a command to generate output
2. Type `/clear`
3. Expected: Output panel clears

#### Test /cancel Command
1. Start a long-running command (`/plan Create a complex system`)
2. Type `/cancel`
3. Expected:
   - Execution interrupts
   - System message: "Execution interrupted"
   - Header returns to "IDLE"

### ✅ Interactive Features

#### Test Message Sending (While Running)
1. Start `/plan Something that requires clarification`
2. While running, type a message (not starting with `/`)
3. Press Enter
4. Expected: Message sends to Claude, appears in output

#### Test AskUserQuestion (If Triggered)
1. Execute command that might ask questions
2. Expected:
   - Question panel appears with options
   - Can select answer
   - Answer submits to Claude
   - Execution continues

### ✅ Output Display

#### Verify Output Types Render Correctly
- [ ] `tool_call`: Yellow with ● prefix
- [ ] `tool_result`: Gray with ↳ prefix
- [ ] `assistant`: Blue text in highlighted box
- [ ] `system`: Gray with 💭 prefix
- [ ] `error`: Red text
- [ ] `file_diff`: Green/red +/- lines

#### Verify Metadata Display
- [ ] Duration shows (e.g., "⏱️ 1234ms")
- [ ] Token counts show (e.g., "🪙 ↓100/↑50")
- [ ] Cost shows with color coding (e.g., "💰 $0.0123")

### ✅ Long Output Handling
1. Execute command with lots of output
2. Verify:
   - [ ] Output scrolls automatically
   - [ ] Last 1000 lines kept (older lines removed)
   - [ ] No performance degradation

## Automated Tests

### Run Command Execution Test
```bash
bun run src/test-command-execution.tsx
```

Expected output:
```
Creating CliManager...
Setting up listeners...
Starting execution with test prompt...
[OUTPUT:assistant] 4
[OUTPUT:exit]
[COMPLETE] Execution finished
```

### Run Border Test (Negative Test)
```bash
bun run src/test-border.tsx
```

With `borderStyle` uncommented → Should crash (FFI error)
With `borderStyle` commented → Should render successfully

### Run Isolation Test
```bash
bun run src/test-isolate-crash.tsx
```

Expected: Renders with theme, XState, React Query, and components

## Known Issues

### ❌ OpenTUI Limitations
- **borderStyle prop**: Causes Bun FFI crash (workaround: removed from all components)
- **No native scrollbars**: Use virtual scrolling implementation
- **Limited text input features**: Basic input only (no selection, copy/paste)

### 🐛 Potential Issues to Watch

1. **Memory Leaks**: Long sessions with lots of output
   - Solution: Only keeping last 1000 lines

2. **stdin Conflicts**: Multiple processes reading stdin
   - Solution: Use raw mode carefully, cleanup on unmount

3. **Unicode Rendering**: Some characters may not display correctly
   - Solution: Test with your terminal emulator

## Performance Benchmarks

Target performance (to match Go TUI):
- [ ] Frame rendering: < 16ms (60 FPS)
- [ ] Keyboard latency: < 10ms
- [ ] CLI spawn time: < 500ms
- [ ] Event processing: < 1ms per event

## Debug Mode

To enable verbose logging:
```typescript
// In src/services/CliManager.ts
private enrichEvent(event: ClaudeCliEvent): OutputLine[] {
  console.log('[DEBUG] Event:', event); // Add this
  // ...
}
```

## Troubleshooting

### TUI Crashes on Launch
1. Check if borderStyle is used anywhere: `grep -r "borderStyle" src/`
2. Verify OpenTUI version: `^0.1.74`
3. Check Bun version: `bun --version` (1.3.6+)

### Commands Don't Execute
1. Verify Claude CLI is installed: `which claude`
2. Check API key is configured: `claude --version`
3. Look for errors in CliManager initialization

### Keyboard Input Not Working
1. Verify stdin raw mode is enabled (see App.tsx useEffect)
2. Check terminal supports raw mode
3. Try different terminal emulator

### No Output Displayed
1. Check if events are emitting: Add console.log in CliManager
2. Verify XState machine transitions
3. Check OutputPanel is receiving lines prop

## Success Criteria

Before considering TUI production-ready:
- [x] ✅ Launches without crashes
- [x] ✅ CliManager executes commands successfully
- [ ] `/plan` command works end-to-end
- [ ] `/build` command works end-to-end
- [ ] Keyboard shortcuts all functional
- [ ] Metadata displays correctly
- [ ] Question handling works
- [ ] Long sessions remain stable
- [ ] Performance meets benchmarks

## Next Steps

Once all tests pass:
1. Update `clive` binary wrapper to use TS TUI
2. Deploy alongside Go TUI (feature flag)
3. Collect user feedback
4. Deprecate Go TUI
