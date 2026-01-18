---
name: unit-tests
description: Implement unit tests using the project's test framework
category: test
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Unit Tests Skill

You implement unit tests **ONE TASK AT A TIME** from the approved plan. Each invocation handles exactly one task.

**Pattern:** Read context -> Find task details -> Implement -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **BEADS FIRST** - When beads (`.beads/` directory) exists, it is the SOURCE OF TRUTH. Use `bd ready` to find work, `bd close` to complete.
2. **ONE TASK ONLY** - Implement ONE test suite, then STOP. Do NOT continue to the next task.
3. **MUST UPDATE STATUS** - After completing a task, update beads (`bd close`) AND the plan file.

**If you do not update status, the loop will repeat the same work forever.**

---

## Step 0: Read Your Context (REQUIRED FIRST)

### 0.1 Check Beads First (PRIMARY SOURCE OF TRUTH)

**Beads is the primary source of truth when available:**

```bash
if command -v bd &> /dev/null && [ -d ".beads" ]; then
    echo "Beads available - using as primary source"
    bd ready  # Shows tasks with no blockers, ready to work on
fi
```

**If beads shows no ready tasks:**
- Check if all tasks are complete: `bd list --status=open`
- If no open tasks remain, output `<promise>ALL_TASKS_COMPLETE</promise>`

### 0.2 Read the Plan File

The plan file path is provided in your instructions. Read it to find the test cases and implementation details for the current task.

---

## Step 1: Mark Task In Progress

### If beads is available (preferred):
```bash
bd update [TASK_ID] --status in_progress
```

### Also update the plan file:
- Change `- [ ] **Status:** pending` to `- [ ] **Status:** in_progress`

---

## Step 2: Implement Tests

### 2.1 Start Simple

**Start with ONE test case** to verify setup works:

```typescript
import { describe, it, expect } from "vitest";

describe("[Component]", () => {
  it("should [basic behavior]", () => {
    // Minimal test to verify imports work
  });
});
```

### 2.2 Run Immediately

```bash
npm test -- [test-file-path]
# or: yarn test, npx vitest run, etc.
```

**Discover the correct test command** from package.json if unsure.

### 2.3 Add Remaining Tests

After first test passes, add the remaining tests from the plan.

### 2.4 Quality Rules

- **NO placeholder tests:** `expect(true).toBe(true)` is FORBIDDEN
- **NO empty test bodies**
- Every test MUST verify actual behavior
- Match function signatures EXACTLY
- Use existing mock factories when available

### 2.5 Test Data Management

Tests MUST be self-contained and create their own data:

```typescript
// GOOD - Creates its own data
it("should update user", async () => {
  const user = await createTestUser({ name: "Test" });
  await updateUser(user.id, { name: "Updated" });
  expect((await getUser(user.id)).name).toBe("Updated");
});

// BAD - Relies on pre-existing data
it("should update user", async () => {
  const user = await getUser("existing-id"); // Fails if missing!
});
```

---

## Step 3: Verify Tests Pass (REQUIRED)

**You MUST run tests and see them pass before marking complete.**

### What "Complete" Means

- You executed the test command
- The test runner reports ALL tests passing
- You see output confirming success

### If Tests Fail

1. **Isolate with .only()** - Don't run full suite to debug one test
2. Fix the issue
3. Re-run until it passes
4. Remove .only() and run full suite

```javascript
// Isolate failing test
it.only('should handle error', () => { ... });
```

### After 5+ Failed Attempts

If truly stuck:
- Mark task as `blocked`
- Ask user for help with specific error details

---

## Discovered Work Protocol

**During implementation, you may discover work outside the current task's scope:**

- A bug that needs fixing but isn't part of this test task
- Missing tests for related functionality
- Code that needs refactoring to be testable
- Documentation gaps
- Technical debt

**DO NOT do this work inline.** Instead:

### 1. Create a Beads Task for Discovered Work

```bash
# Create a task with appropriate skill label
bd create --title="[Brief description]" \
  --type=task \
  --priority=2 \
  --labels "skill:[appropriate-skill],category:[category],discovered:true"

# Examples:
bd create --title="Fix null check in auth middleware" --type=bug --priority=1 --labels "skill:bugfix,category:bugfix,discovered:true"
bd create --title="Add tests for error handling in UserService" --type=task --priority=2 --labels "skill:unit-tests,category:test,discovered:true"
bd create --title="Refactor tangled dependencies in auth module" --type=task --priority=3 --labels "skill:refactor,category:refactor,discovered:true"
```

### 2. Note It and Continue

After creating the task:
- Briefly note what you discovered in your progress output
- **Continue with your current task** - do not switch focus
- The new task will be picked up in a future iteration

### Why This Matters

- **Focus**: Keeps you on task, prevents scope creep
- **Tracking**: Discovered work is captured, not lost
- **Prioritization**: User can reorder tasks as needed
- **Context**: Fresh context for each task = better quality

---

## Step 4: Update Status (REQUIRED - DO NOT SKIP)

**THIS IS MANDATORY. If you skip this step, the loop will repeat forever.**

### If ALL Tests Pass:

**1. Update beads first (if available):**
```bash
bd close [TASK_ID]
```

**2. Also update the plan file:**
- Find the line: `- [ ] **Status:** in_progress`
- Change it to: `- [x] **Status:** complete`

### If Blocked:

**1. Update beads (if available):**
```bash
bd update [TASK_ID] --status blocked
```

**2. Also update the plan file:**
- Change status to `blocked`
- Add note: `**Blocked:** [error summary]`

---

## Step 4.5: Commit Changes (REQUIRED)

**Create a local commit for this task before marking complete:**

```bash
# Stage the changes from this task
git add -A

# Commit with descriptive message
git commit -m "test: [brief description of tests added]

Task: [TASK_ID or task name]
Skill: unit-tests"
```

**Why commit per task:**
- Granular rollback if something goes wrong
- Clear history of what each task accomplished
- Easier code review
- Safe checkpoint before next task

**Note:** Do NOT push yet - local commits only. Push happens at session end or user request.

---

## Step 4.6: Update Scratchpad (REQUIRED)

**Before outputting the completion marker, update the scratchpad for the next agent:**

```bash
cat >> .claude/scratchpad.md << 'SCRATCHPAD'

## [Task Title]
**Completed:** [timestamp]

### Key Decisions
- [Testing approach and why]
- [Mock strategy used]

### Files Modified
- [Test files created/modified]

### Notes for Next Agent
- [Test patterns established]
- [Mock factories available]
- [Edge cases covered]
- [Related code that tests depend on]

SCRATCHPAD
```

---

## Step 5: Output Completion Marker and STOP

**If this task is done (but more remain):**
```
Task "[name]" complete. [X] tests passing.
<promise>TASK_COMPLETE</promise>
```

**If ALL tasks are done:**
```
All tasks complete!
<promise>ALL_TASKS_COMPLETE</promise>
```

## STOP HERE - DO NOT CONTINUE

**After outputting the marker, you MUST STOP IMMEDIATELY.**

- Do NOT start working on the next task
- Do NOT ask "should I continue?"
- Do NOT offer to do more work

The outer loop will automatically restart you with fresh context for the next task.

---

## Key Principles

### One Task Per Iteration
- Fresh context each iteration prevents accumulated confusion
- Clear progress tracking
- Ability to cancel between tasks

### Iteration Over Perfection
- Don't try to write perfect tests first attempt
- Verify each test passes before adding more
- Failures tell you what needs fixing

### Tests Must Pass
- Keep working until ALL tests pass
- Only mark complete when you see passing output
- Ask for help if truly stuck after 5+ attempts
