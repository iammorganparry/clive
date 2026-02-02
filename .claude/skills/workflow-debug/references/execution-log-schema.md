# Execution Log Schema

Documentation for the `workflow_execution_log` database table and related structures.

## workflow_execution_log Table

The main execution log record created for each workflow run.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique log entry ID (CUID) |
| `run_id` | String | Inngest's unique run ID (unique constraint) |
| `workflow_function_id` | String | The Inngest function ID |
| `workflow_name` | String | Human-readable workflow name |
| `event_id` | String | ID of the triggering event |
| `event_name` | String | Name of the triggering event |
| `input_payload` | JSON | The complete event payload that triggered the workflow |
| `status` | Enum | Execution status (see Status Values below) |
| `started_at` | DateTime | When execution started |
| `ended_at` | DateTime | When execution completed (null if still running) |
| `duration_ms` | Int | Total execution time in milliseconds |
| `steps_log` | JSON | Array of StepLogEntry objects (see below) |
| `output_payload` | JSON | Final workflow output (if successful) |
| `error` | String | Top-level error message (if failed) |
| `error_stack` | String | Error stack trace (if failed) |
| `workflow_id` | String | FK to the workflow definition |
| `organisation_id` | String | FK to the organisation |
| `workflow_version_id` | String | FK to the specific workflow version executed |

### Status Values

```
RUNNING    - Workflow is currently executing
COMPLETED  - Workflow finished successfully
FAILED     - Workflow encountered an error
TIMED_OUT  - Workflow exceeded the maximum execution time
CANCELED   - Workflow was manually or automatically canceled
```

---

## StepLogEntry Structure

Each entry in the `steps_log` array represents a single action execution.

```typescript
interface StepLogEntry {
  // Execution status for this step
  status: "RUNNING" | "COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELED";

  // Unique identifier for this step (matches the action ID in workflow JSON)
  stepId: string;

  // The operation/action kind (e.g., "slack", "hubspot", "http")
  operation: string;

  // Human-readable step name (from action config)
  stepName?: string;

  // Alternative name field (sometimes used instead of stepName)
  name?: string;

  // The input data passed to this action
  input?: unknown;

  // The output data returned by this action (if successful)
  output?: unknown;

  // Error details (if failed)
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };

  // When this step started executing
  startedAt: string;  // ISO 8601 datetime

  // When this step finished (undefined if still running)
  endedAt?: string;   // ISO 8601 datetime

  // Execution duration in milliseconds
  durationMs?: number;

  // For steps inside batch loops: which iteration (1-based)
  iteration?: number;

  // For steps inside batch loops: total items in the loop
  totalItems?: number;
}
```

---

## Example Execution Log

### Successful Workflow Run

```json
{
  "id": "clxyz123abc",
  "run_id": "01HW...",
  "workflow_name": "New Post to Slack",
  "status": "COMPLETED",
  "started_at": "2024-01-15T10:30:00Z",
  "ended_at": "2024-01-15T10:30:05Z",
  "duration_ms": 5234,
  "input_payload": {
    "post": {
      "id": "post_123",
      "platform": "linkedin",
      "author": "John Doe",
      "content": "..."
    }
  },
  "steps_log": [
    {
      "status": "COMPLETED",
      "stepId": "trigger_new_post",
      "operation": "trigger",
      "stepName": "New Post Trigger",
      "output": { "post": { "..." } },
      "startedAt": "2024-01-15T10:30:00Z",
      "endedAt": "2024-01-15T10:30:00Z",
      "durationMs": 10
    },
    {
      "status": "COMPLETED",
      "stepId": "action_slack_notify",
      "operation": "slack",
      "stepName": "Notify Sales Channel",
      "input": {
        "channel": "#sales-alerts",
        "message": "New post from John Doe on LinkedIn"
      },
      "output": { "ts": "1705318205.123456" },
      "startedAt": "2024-01-15T10:30:01Z",
      "endedAt": "2024-01-15T10:30:05Z",
      "durationMs": 4000
    }
  ],
  "output_payload": { "success": true },
  "error": null,
  "error_stack": null
}
```

### Failed Workflow Run

```json
{
  "id": "clxyz456def",
  "run_id": "01HX...",
  "workflow_name": "New Post to Slack",
  "status": "FAILED",
  "started_at": "2024-01-15T11:00:00Z",
  "ended_at": "2024-01-15T11:00:02Z",
  "duration_ms": 2100,
  "input_payload": {
    "post": {
      "id": "post_456",
      "platform": "twitter",
      "author": "Jane Smith"
    }
  },
  "steps_log": [
    {
      "status": "COMPLETED",
      "stepId": "trigger_new_post",
      "operation": "trigger",
      "stepName": "New Post Trigger",
      "output": { "post": { "..." } },
      "startedAt": "2024-01-15T11:00:00Z",
      "endedAt": "2024-01-15T11:00:00Z",
      "durationMs": 10
    },
    {
      "status": "FAILED",
      "stepId": "action_slack_notify",
      "operation": "slack",
      "stepName": "Notify Sales Channel",
      "input": {
        "channel": "#nonexistent-channel",
        "message": "New post from Jane Smith"
      },
      "error": {
        "message": "channel_not_found",
        "name": "SlackAPIError"
      },
      "startedAt": "2024-01-15T11:00:01Z",
      "endedAt": "2024-01-15T11:00:02Z",
      "durationMs": 1000
    }
  ],
  "error": "Action failed: channel_not_found",
  "error_stack": "SlackAPIError: channel_not_found\n    at SlackAction.execute..."
}
```

### Workflow with Batch Loop

```json
{
  "id": "clxyz789ghi",
  "status": "FAILED",
  "steps_log": [
    {
      "status": "COMPLETED",
      "stepId": "trigger",
      "operation": "trigger",
      "startedAt": "2024-01-15T12:00:00Z",
      "endedAt": "2024-01-15T12:00:00Z"
    },
    {
      "status": "COMPLETED",
      "stepId": "loop_users",
      "operation": "builtin:loop",
      "stepName": "Process Each User",
      "output": { "collection": ["user1", "user2", "user3"], "totalItems": 3 },
      "startedAt": "2024-01-15T12:00:01Z",
      "endedAt": "2024-01-15T12:00:01Z"
    },
    {
      "status": "COMPLETED",
      "stepId": "send_email",
      "operation": "email",
      "iteration": 1,
      "totalItems": 3,
      "input": { "to": "user1@example.com" },
      "startedAt": "2024-01-15T12:00:02Z",
      "endedAt": "2024-01-15T12:00:03Z"
    },
    {
      "status": "FAILED",
      "stepId": "send_email",
      "operation": "email",
      "iteration": 2,
      "totalItems": 3,
      "input": { "to": "invalid-email" },
      "error": { "message": "Invalid email address format" },
      "startedAt": "2024-01-15T12:00:04Z",
      "endedAt": "2024-01-15T12:00:04Z"
    }
  ]
}
```

---

## Reading Steps Log for Debugging

### Finding the Failing Step

1. Look for entries with `status: "FAILED"`
2. Check the `error` object for details
3. Examine the `input` to see what data was passed
4. Use `iteration` to identify which loop item failed

### Tracking Data Flow

1. Start from the trigger - check `output` for the initial data
2. Follow each step's `output` → next step's `input`
3. Verify `!ref()` expressions resolve to expected values

### Timing Analysis

- `durationMs` shows how long each step took
- Long durations may indicate API slowness or timeouts
- Missing `endedAt` with FAILED status suggests unexpected termination
