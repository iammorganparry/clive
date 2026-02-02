# Common Error Patterns

Reference guide for diagnosing and fixing common workflow errors.

## Configuration Errors

### Edge Count Issues

**Error:** `Action has incorrect number of edges`

**Cause:** The workflow DAG has invalid edge connections. Each action type has expected incoming/outgoing edge counts.

**Fix:**
1. Get the workflow JSON: `trigify-cli workflow get <id>`
2. Check the `edges` array for the affected action
3. Ensure proper edge connections between actions

### DAG Cycle Detection

**Error:** `Workflow contains a cycle`

**Cause:** The workflow graph has circular dependencies where actions reference each other in a loop.

**Fix:**
1. Review the workflow edges to find the cycle
2. Remove or redirect edges to break the cycle
3. Ensure data flows in one direction (trigger → actions → completion)

### Invalid Edge Types

**Error:** `Invalid edge type for action`

**Cause:** Using wrong conditional edge type. Valid types:
- `if` / `else` - For boolean conditions
- `match` - For multi-value matching
- `loop` - For loop iteration edges
- `completed` - For action completion

**Fix:** Change the edge `type` to the appropriate value for the action kind.

### Missing Trigger

**Error:** `Workflow must have exactly one trigger`

**Cause:** Workflow is missing a trigger action or has multiple triggers.

**Fix:** Ensure exactly one action with `kind: "trigger"` exists in the actions array.

---

## Integration Errors

### Missing Integration

**Error:** `Integration not connected` or `No integration found for <type>`

**Cause:** The workflow uses an action (e.g., Slack, HubSpot) but the integration is not connected.

**Fix:**
1. Check integrations: `trigify-cli integration list`
2. Connect the required integration through the Trigify dashboard

### Invalid API Credentials

**Error:** `Authentication failed` or `Invalid API key`

**Cause:** Integration credentials expired or were revoked.

**Fix:**
1. Reconnect the integration through the dashboard
2. Re-authorize OAuth-based integrations

### Rate Limiting

**Error:** `Rate limit exceeded` or `429 Too Many Requests`

**Cause:** Too many API calls to an external service in a short period.

**Fix:**
1. Add delays between actions if processing many items
2. Reduce batch size for loop actions
3. Wait and retry - usually temporary

---

## Runtime Errors

### Action Timeout

**Error:** `Action timed out` or step has no `endedAt` with FAILED status

**Cause:** An action took too long to complete (default timeout varies by action type).

**Fix:**
1. Check if external API is responding slowly
2. Simplify the action input/processing
3. Split complex operations into multiple steps

### Null Reference

**Error:** `Cannot read property 'X' of undefined` or `TypeError`

**Cause:** Action input references data that doesn't exist in the workflow context.

**Fix:**
1. Check the action's `input` field for `!ref()` expressions
2. Verify referenced data exists in the trigger event or previous step outputs
3. Add null checks or default values

### API Error Responses

**Error:** `API returned error: <message>`

**Cause:** External service returned an error (4xx or 5xx).

**Fix:**
1. Check the specific error message in the step log
2. Verify input data is valid for the API
3. Check service status pages for outages

---

## Data Errors

### Missing Required Fields

**Error:** `Missing required field: <field>`

**Cause:** An action's required input field is not provided.

**Fix:**
1. Get the workflow JSON and check the action's `inputs` object
2. Add the missing required field
3. Use `!ref()` to map data from trigger or previous steps

### Type Mismatch

**Error:** `Expected <type> but got <type>`

**Cause:** Input data type doesn't match what the action expects.

**Fix:**
1. Check the expected type in the action schema
2. Transform the data appropriately before passing to the action
3. For numeric values, ensure they're not passed as strings

### Empty Collection in Loop

**Error:** `Loop action requires a collection reference`

**Cause:** Loop action received an empty or undefined collection.

**Fix:**
1. Check the loop's collection input `!ref()` expression
2. Verify the source step outputs a valid array
3. Add a conditional to skip the loop if collection is empty

---

## Workflow State Errors

### Workflow Disabled

**Status:** CANCELED (immediately after trigger)

**Cause:** Workflow is disabled but received a trigger event.

**Fix:**
1. Enable the workflow: `trigify-cli workflow update <id> --enabled true`

### Missing Saved Search

**Error:** `Saved search not found`

**Cause:** The workflow's trigger references a deleted saved search.

**Fix:**
1. Get the workflow and check `savedSearchId` in trigger config
2. Either restore the saved search or update the workflow with a new one

---

## Debugging Tips

### Reading the Steps Log

1. **Find the failing step** - Look for `status: "FAILED"` entries
2. **Check the input** - The `input` field shows exactly what was passed to the action
3. **Examine the error** - The `error` object contains `message`, `name`, and sometimes `stack`
4. **Compare with successful runs** - If the workflow worked before, compare inputs

### Common Input Issues

```javascript
// Bad: Reference doesn't exist
"!ref($.step_1.output.data)"  // step_1 might not have 'data' in output

// Good: Use optional chaining in your mental model
// Check the actual step output before referencing nested properties

// Bad: Wrong step ID
"!ref($.slack_notify.output)"  // Step IDs are often generated, not action names

// Good: Use the actual stepId from the workflow JSON
"!ref($.action_abc123.output)"
```

### Iteration Context in Loops

For steps inside loops, the `iteration` field indicates which item failed:
```json
{
  "stepId": "notify_user",
  "iteration": 5,
  "totalItems": 10,
  "error": { "message": "User email is invalid" }
}
```
This means item 5 of 10 failed - check that specific item's data.
