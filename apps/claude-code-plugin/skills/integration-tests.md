---
name: integration-tests
description: Implement integration tests with real dependencies
category: test
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Integration Tests Skill

You implement integration tests **ONE TASK AT A TIME**. Integration tests verify multiple components work together correctly with real (or realistic) dependencies.

**Pattern:** Read context -> Find task details -> Implement -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **BEADS FIRST** - When beads exists, use `bd ready` to find work, `bd close` to complete.
2. **ONE TASK ONLY** - Implement ONE test suite, then STOP.
3. **MUST UPDATE STATUS** - Update beads AND plan file after completion.

---

## Integration Test Characteristics

Unlike unit tests, integration tests:
- Test multiple components working together
- May use real databases (test instances or containers)
- May make real API calls (to test endpoints or mocked services)
- Are slower but catch integration issues
- Require proper setup/teardown of shared resources

---

## Step 0: Read Your Context

### 0.1 Check Beads First
```bash
if [ -d ".beads" ]; then
    bd ready
fi
```

### 0.2 Read the Plan File
Get test cases and integration points from the plan.

---

## Step 1: Mark Task In Progress

```bash
bd update [TASK_ID] --status in_progress
```

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

## Step 4: Update Status

```bash
bd close [TASK_ID]
```

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

```
Task "[name]" complete. [X] integration tests passing.
<promise>TASK_COMPLETE</promise>
```

**STOP IMMEDIATELY after outputting the marker.**
