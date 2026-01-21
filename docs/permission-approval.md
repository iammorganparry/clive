# Automatic Permission Approval

## Overview

The Clive TUI implements automatic permission approval to work around known bugs in claude-code CLI where certain tools (`AskUserQuestion`, etc.) send permission denials even when configured to bypass all permissions.

## The Problem

When claude-code encounters certain tool uses, it sends permission requests even with permission bypass modes enabled:

- `--dangerously-skip-permissions` → Still prompts for some tools
- `--permission-mode bypassPermissions` → Still prompts
- `--permission-mode dontAsk` → Auto-denies all permissions
- `--allowedTools "ToolName"` → Ignored, still prompts

**Affected Tools:**
- `AskUserQuestion` - Interactive questions
- Potentially other tools that trigger permission checks

**Note:** We previously had issues with `EnterPlanMode`/`ExitPlanMode` tools, but these have been removed in favor of letting claude-code's native plan mode handle workflow transitions.

**Root Cause:**
If permission denials accumulate in the conversation state without being properly handled, subsequent API calls fail with 400 errors:
```
API Error: 400 {"type":"error","error":{"type":"invalid_request_error",
"message":"messages.X.content.0: unexpected `tool_use_id` found in `tool_result` blocks"}}
```

**Affected GitHub Issues:**
- [#10400](https://github.com/anthropics/claude-code/issues/10400): AskUserQuestion returns empty response with bypass permissions
- [#16712](https://github.com/anthropics/claude-code/issues/16712): CLI injects synthetic messages causing tool_result rejection

## The Solution

The TUI's `spawner.go` automatically detects permission requests from claude-code and sends approval responses programmatically via stdin.

### How It Works

The solution detects and approves permission denials from tools, with a special exception for `AskUserQuestion`.

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

3. **Continuation**: After approval, claude-code continues execution.

### AskUserQuestion Exception

**Important**: `AskUserQuestion` is NOT auto-approved. When a permission denial is detected for AskUserQuestion:

1. We check if the `tool_use_id` is in our `handledQuestionIDs` map (populated when we detect AskUserQuestion calls)
2. If it's an AskUserQuestion, we skip auto-approval and return nil
3. The TUI's question panel collects the user's actual answer
4. The user's answer is sent as the tool_result (not our empty approval)

This prevents the following error:
```
API Error: 400 unexpected `tool_use_id` found in `tool_result` blocks
```

Which occurred when:
1. AskUserQuestion permission denied
2. We auto-approved with empty tool_result
3. User answered via TUI, sending another tool_result
4. API error: two tool_results for one tool_use

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

        if isError && toolUseID != "" {
            // Check if this is AskUserQuestion - if so, don't auto-approve
            streamStateMu.Lock()
            isAskUserQuestion := handledQuestionIDs[toolUseID]
            streamStateMu.Unlock()

            if isAskUserQuestion {
                // Skip auto-approval for AskUserQuestion
                return nil
            }

            // Send approval via stdin for other tools
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

All streaming scripts use `--allow-dangerously-skip-permissions --dangerously-skip-permissions` and benefit from automatic permission approval:

1. **question.sh** - Test script for AskUserQuestion
   - Tests the permission approval system
   - Sends prompt via stdin using `--input-format stream-json`

2. **plan.sh** - Planning agent
   - Uses `--permission-mode plan` (read-only) + `--dangerously-skip-permissions`
   - Auto-approves AskUserQuestion and ExitPlanMode permission denials

3. **build.sh** - Build loop agent
   - Full permissions with `--dangerously-skip-permissions`
   - Auto-approves any tool permission denials during implementation

4. **build-iteration.sh** - Single build iteration
   - Full permissions with `--dangerously-skip-permissions`
   - Uses `--input-format stream-json` for bidirectional communication

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
