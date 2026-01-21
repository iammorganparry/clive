# Automatic Permission Approval for AskUserQuestion

## Overview

The Clive TUI implements automatic permission approval for the `AskUserQuestion` tool to work around a known bug in claude-code CLI where AskUserQuestion cannot be auto-approved through any declarative permission configuration.

## The Problem

When claude-code encounters an `AskUserQuestion` tool use, it sends a permission request even with permission bypass modes enabled:

- `--dangerously-skip-permissions` → Still prompts
- `--permission-mode bypassPermissions` → Still prompts
- `--permission-mode dontAsk` → Auto-denies all permissions
- `--allowedTools "AskUserQuestion"` → Ignored, still prompts

**Affected GitHub Issues:**
- [#10400](https://github.com/anthropics/claude-code/issues/10400): AskUserQuestion returns empty response with bypass permissions
- [#16712](https://github.com/anthropics/claude-code/issues/16712): CLI injects synthetic messages causing tool_result rejection

## The Solution

The TUI's `spawner.go` automatically detects permission requests from claude-code and sends approval responses programmatically via stdin.

### How It Works

1. **Detection**: When claude-code sends a permission request, it appears as a `user` event with `is_error: true`:
   ```json
   {
     "type": "user",
     "message": {
       "role": "user",
       "content": [{
         "type": "tool_result",
         "content": "Answer questions?",
         "is_error": true,
         "tool_use_id": "toolu_xxx"
       }]
     }
   }
   ```

2. **Approval**: The TUI automatically sends an approval response via stdin:
   ```json
   {
     "type": "user",
     "message": {
       "role": "user",
       "content": [{
         "type": "tool_result",
         "tool_use_id": "toolu_xxx",
         "content": "",
         "is_error": false
       }]
     }
   }
   ```

3. **Continuation**: After approval, the user can provide their actual answer through the TUI's question panel.

## Implementation

### Code Location

**File**: `apps/tui-go/internal/process/spawner.go` (lines 1114-1165)

**Key function**: `processStreamingLine()` case `"user"`

### Logic Flow

```go
case "user":
    // Check if this is a permission request (tool_result with is_error=true)
    if block["type"] == "tool_result" {
        toolUseID := block["tool_use_id"]
        isError := block["is_error"]
        promptText := block["content"]

        if isError && toolUseID != "" {
            // Send approval via stdin
            approval := map[string]interface{}{
                "type": "user",
                "message": map[string]interface{}{
                    "role": "user",
                    "content": []map[string]interface{}{
                        {
                            "type":        "tool_result",
                            "tool_use_id": toolUseID,
                            "content":     "",
                            "is_error":    false,
                        },
                    },
                },
            }

            approvalJSON, _ := json.Marshal(approval)
            handle.stdin.Write(append(approvalJSON, '\n'))
        }
    }
```

### Scripts Using This Feature

All streaming scripts benefit from automatic permission approval:

1. **question.sh** - Test script for AskUserQuestion
   - Uses `--allow-dangerously-skip-permissions --dangerously-skip-permissions`
   - Sends prompt via stdin using `--input-format stream-json`

2. **plan.sh** - Planning agent
   - Uses `--permission-mode plan` (read-only)
   - Can ask clarifying questions during planning via AskUserQuestion

3. **build.sh** - Build loop agent
   - Uses `--dangerously-skip-permissions` for full access
   - Can ask for clarification during implementation

## Testing

### Unit Tests

**File**: `apps/tui-go/internal/process/permission_approval_test.go`

Key test cases:
- `TestPermissionApproval_DetectsAndApproves` - Verifies approval is sent
- `TestPermissionApproval_MultiplePermissionRequests` - Multiple questions
- `TestPermissionApproval_ConcurrentPermissionRequests` - Thread safety
- `TestPermissionApproval_IntegrationWithAskUserQuestion` - End-to-end flow

### Integration Test

Run the `/question` command in the TUI:

```bash
clive
# In TUI:
/question
```

Expected behavior:
- Question panel appears with first question
- Answer and submit
- Question panel appears with second set of questions
- Answer and submit
- "Test complete!" message appears
- No "Answer questions?" permission errors

### Verify in Logs

Check debug logs for permission approval activity:

```bash
tail -f ~/.clive/logs/*/conversation-*.ndjson | grep "PERMISSION REQUEST"
```

Expected output:
```
PERMISSION REQUEST detected: Answer questions? (tool_use_id=toolu_xxx), sent approval via stdin
```

## Regression Prevention

### Critical Tests

1. **permission_approval_test.go** - Unit tests protect the core logic
2. **Integration test** - `/question` command must complete without errors
3. **Build/Plan tests** - Ensure AskUserQuestion works in all contexts

### CI/CD Integration

✅ **COMPLETED**: Automated regression tests added to CI pipeline (`.github/workflows/ci.yml`):

1. **Go Test Job**: Runs all Go tests in `apps/tui-go`
2. **Permission Approval Tests**: Specifically runs `TestPermissionApproval*` tests
3. **Regression Detection**: Fails build if any permission approval tests fail
4. **Clear Feedback**: Provides explicit error messages if regression detected

The CI pipeline runs on:
- All pull requests
- Pushes to main branch
- Merge group events

This ensures no future changes can break the permission approval feature without being caught in PR reviews.

## Known Limitations

1. **Stdin-based only**: This workaround only works when stdin is available for bidirectional communication (streaming mode)
2. **Format dependency**: Relies on the specific JSON format claude-code uses for permission requests
3. **Upstream bug**: This is a workaround, not a fix. The underlying claude-code bug still exists

## Future Improvements

1. **Monitor upstream fixes**: Watch GitHub issues #10400 and #16712 for official fixes
2. **Fallback handling**: Add graceful degradation if approval format changes
3. **Permission logging**: Enhanced logging for debugging permission flows
4. **Test automation**: Add CI/CD regression tests for permission approval

## References

- [claude-code Headless Documentation](https://code.claude.com/docs/en/headless)
- [Claude Code Permission System (Medium)](https://kotrotsos.medium.com/claude-code-internals-part-8-the-permission-system-624bd7bb66b7)
- [GitHub Issue #10400](https://github.com/anthropics/claude-code/issues/10400)
- [GitHub Issue #16712](https://github.com/anthropics/claude-code/issues/16712)
