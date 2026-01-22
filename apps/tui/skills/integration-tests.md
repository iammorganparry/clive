---
name: integration-tests
description: Implement integration tests with real dependencies
category: test
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__create_comment
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Integration Tests Skill

You implement integration tests **ONE TASK AT A TIME**. Integration tests verify multiple components work together correctly with real (or realistic) dependencies.

**Pattern:** Read context -> Find task details -> Implement -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **MARK IN PROGRESS IMMEDIATELY** - Update tracker status to "In Progress" before writing tests.
3. **ONE TASK ONLY** - Implement ONE test suite, then STOP.
4. **MARK DONE AT COMPLETION** - Update tracker status to "Done" after tests pass.
5. **BOTH STATUS TRANSITIONS REQUIRED** - Must call status update at START and at COMPLETION.

---

## Integration Test Characteristics

Unlike unit tests, integration tests:
- Test multiple components working together
- May use real databases (test instances or containers)
- May make real API calls (to test endpoints or mocked services)
- Are slower but catch integration issues
- Require proper setup/teardown of shared resources

---

## Step 0: Verify Task Information

**Before implementing tests, ensure you have task details:**

**For Linear tracker:**
- If you see instructions to fetch from Linear in the prompt above, do that FIRST
- Call `mcp__linear__list_issues` as instructed to find your task
- **If authentication fails:**
  - Output: `ERROR: Linear MCP is not authenticated. Please cancel this build (press 'c'), run 'claude' to authenticate with Linear MCP, then restart with /build`
  - Output: `<promise>TASK_COMPLETE</promise>`
  - STOP immediately
- Extract the task `id`, `identifier`, and `title` from the results

**For Beads tracker:**
- Task info is embedded in the prompt (look for "Task ID:" and "Task:" lines)
- If not found, the build iteration wasn't set up correctly

**If you cannot determine your task for other reasons:**
- Output: `ERROR: Unable to determine task. Please check build configuration.`
- STOP - do not proceed without a valid task

---

## Step 0.5: Read Your Context

### 0.5.1 Detect Tracker and Check Ready Work
```bash
# Read tracker preference
TRACKER=$(cat ~/.clive/config.json 2>/dev/null | jq -r '.issue_tracker // "beads"')
echo "Using tracker: $TRACKER"

if [ "$TRACKER" = "beads" ] && [ -d ".beads" ]; then
    bd ready
fi
# For Linear: Task info should now be available from Step 0
```

### 0.2 Read the Plan File
Get test cases and integration points from the plan.

---

## Step 1: Mark Task In Progress (REQUIRED - DO NOT SKIP)

**You MUST update the tracker status before writing tests. This is NON-NEGOTIABLE.**

**For Beads:**
```bash
bd update [TASK_ID] --status in_progress
```

**For Linear:**
Call `mcp__linear__update_issue` with these EXACT parameters:
- `id`: The task ID (from environment $TASK_ID or passed in prompt)
- `state`: "In Progress"
- `assignee`: "me"

**Verify the call succeeded before proceeding to test implementation.**
- `assignee`: "me"

Update plan file: `- [ ] **Status:** in_progress`

---

## Step 2: Implement Integration Tests

### 2.1 Setup Test Environment

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("API Integration", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await seedTestData(testDb);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });
});
```

### 2.2 Test Real Interactions

```typescript
it("should create user and retrieve from API", async () => {
  const response = await fetch("/api/users", {
    method: "POST",
    body: JSON.stringify({ name: "Test User" })
  });

  expect(response.status).toBe(201);
  const user = await response.json();

  // Verify data persisted correctly
  const retrieved = await fetch(`/api/users/${user.id}`);
  expect(await retrieved.json()).toMatchObject({ name: "Test User" });
});
```

### 2.3 Quality Rules

- **Use real dependencies** where practical (test DB, test API)
- **Isolate test data** - each test creates/cleans its own data
- **Handle async properly** - await all operations
- **Clean up resources** - always teardown in afterAll/afterEach

---

## Step 3: Verify Tests Pass

Run integration tests (may require specific command):

```bash
npm run test:integration
# or: npm test -- --config vitest.integration.config.ts
```

### If Tests Fail

1. Check test database/service is running
2. Verify environment variables are set
3. Isolate with `.only()`
4. Check for race conditions or timing issues

---

## Discovered Work Protocol

**During implementation, you may discover work outside the current task's scope:**

- A bug in the integration layer
- Missing unit tests for components
- API endpoints that need refactoring
- Documentation gaps
- Technical debt

**DO NOT do this work inline.** Instead:

### 1. Create a Beads Task for Discovered Work

```bash
bd create --title="[Brief description]" \
  --type=task \
  --priority=2 \
  --labels "skill:[appropriate-skill],category:[category],discovered:true"
```

### 2. Note It and Continue

After creating the task:
- Briefly note what you discovered in your progress output
- **Continue with your current task** - do not switch focus
- The new task will be picked up in a future iteration

---

## Step 4: Mark Task Complete (REQUIRED - DO NOT SKIP)

**Before outputting TASK_COMPLETE marker, you MUST:**

1. Verify all integration tests pass
2. Confirm components integrate correctly
3. **Update tracker status to "Done"**

**For Beads:**
```bash
bd close [TASK_ID]
```

**For Linear:**
Call `mcp__linear__update_issue` with:
- `id`: The current task ID
- `state`: "Done"

**If this call fails, DO NOT mark the task complete. Debug the issue first.**

Update plan: `- [x] **Status:** complete`

---

## Step 4.5: Commit Changes (REQUIRED)

**Create a local commit for this task before marking complete:**

```bash
git add -A
git commit -m "test: [brief description of integration tests added]

Task: [TASK_ID or task name]
Skill: integration-tests"
```

**Note:** Local commits only - do NOT push. Push at session end or user request.

---

## Step 4.6: Update Scratchpad (REQUIRED)

**Before outputting the completion marker, update the scratchpad for the next agent:**

```bash
cat >> .claude/scratchpad.md << 'SCRATCHPAD'

## [Task Title]
**Completed:** [timestamp]

### Key Decisions
- [Integration test approach]
- [External services mocked/stubbed]

### Files Modified
- [Test files created/modified]

### Notes for Next Agent
- [Test fixtures available]
- [Setup/teardown patterns]
- [Service dependencies]

SCRATCHPAD
```

---

## Step 5: Output Completion Marker

**ONLY output the marker if ALL of these are verified:**
- [ ] All integration tests written and passing
- [ ] Components integrate correctly with dependencies
- [ ] Tracker status updated to "Done" (mcp__linear__update_issue or bd close called successfully)
- [ ] Git commit created
- [ ] Scratchpad updated with integration patterns

**If any item is incomplete, complete it first. Then output:**

```
Task "[name]" complete. [X] integration tests passing.
<promise>TASK_COMPLETE</promise>
```

**STOP IMMEDIATELY after outputting the marker.**
