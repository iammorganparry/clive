---
name: workflow-debug
description: Debug failing workflows by analyzing execution logs, identifying error patterns, and suggesting fixes. Use when the user asks "Why did my workflow fail?", "Debug my workflow", "What's wrong with my workflow?", or "Fix my failing workflow".
---

# Workflow Debug

Debug failing workflows by analyzing execution logs, identifying the root cause, and suggesting or applying fixes.

## Debugging Workflow

Follow this process when a user needs help debugging a failing workflow:

### Step 1: Identify the Workflow

Ask the user which workflow is failing. Get the workflow name or ID if not provided.

```bash
# List user's workflows
trigify-cli workflow list
```

### Step 2: Get Recent Execution Logs

Use the CLI to fetch execution logs for the failing workflow:

```bash
# Get execution history for a workflow
trigify-cli workflow executions <workflow-id> --status FAILED --limit 5

# Get detailed execution log
trigify-cli workflow execution <execution-id>
```

### Step 3: Analyze the Execution Log

The execution log contains crucial debugging information:

**Key Fields to Examine:**
- `status` - Overall execution status (RUNNING, COMPLETED, FAILED, TIMED_OUT, CANCELED)
- `error` - Top-level error message if the workflow failed
- `error_stack` - Stack trace for the failure
- `steps_log` - Array of step-by-step execution details

**Steps Log Analysis:**
Each entry in `steps_log` represents an action execution:
```json
{
  "status": "FAILED",
  "stepId": "send_slack_message",
  "operation": "slack",
  "stepName": "Notify Sales",
  "input": { "channel": "#sales", "message": "..." },
  "error": { "message": "Channel not found", "name": "SlackAPIError" },
  "startedAt": "2024-01-15T10:30:00Z",
  "endedAt": "2024-01-15T10:30:01Z",
  "durationMs": 1234
}
```

See [references/execution-log-schema.md](references/execution-log-schema.md) for complete schema documentation.

### Step 4: Match Error Pattern

Compare the error against known patterns in [references/error-patterns.md](references/error-patterns.md):

**Common Categories:**
1. **Configuration Errors** - Invalid workflow structure, edge issues, DAG cycles
2. **Integration Errors** - Missing API keys, disconnected integrations, rate limits
3. **Runtime Errors** - API failures, timeouts, data format issues
4. **Data Errors** - Missing fields, type mismatches, null references

### Step 5: Suggest Fix

Based on the error pattern:

1. **For Configuration Errors:** Get the workflow JSON and identify the structural issue
   ```bash
   trigify-cli workflow get <workflow-id>
   ```

2. **For Integration Errors:** Check the integration status
   ```bash
   trigify-cli integration list
   ```

3. **For Runtime Errors:** Often require code changes to action handlers or retry logic

4. **For Data Errors:** Check the trigger event data and action input mappings

### Step 6: Apply Fix (if requested)

Update the workflow configuration:
```bash
# Update workflow JSON
trigify-cli workflow update <workflow-id> --workflow-stdin <<< '<fixed-workflow-json>'

# Enable/disable workflow
trigify-cli workflow update <workflow-id> --enabled true
```

## Quick Reference

### CLI Commands for Debugging

| Command | Purpose |
|---------|---------|
| `trigify-cli workflow list` | List all workflows |
| `trigify-cli workflow get <id>` | Get workflow configuration |
| `trigify-cli workflow executions <id>` | List execution history |
| `trigify-cli workflow execution <exec-id>` | Get detailed execution log |
| `trigify-cli workflow update <id> ...` | Update workflow |
| `trigify-cli integration list` | List connected integrations |

### Status Values

| Status | Meaning |
|--------|---------|
| `RUNNING` | Workflow is currently executing |
| `COMPLETED` | Workflow finished successfully |
| `FAILED` | Workflow encountered an error |
| `TIMED_OUT` | Workflow exceeded time limit |
| `CANCELED` | Workflow was manually or automatically canceled |

## Resources

- [references/error-patterns.md](references/error-patterns.md) - Common errors and their solutions
- [references/execution-log-schema.md](references/execution-log-schema.md) - Complete schema documentation
