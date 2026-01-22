---
description: Implement tests from the approved plan using the Ralph Wiggum loop (one suite at a time)
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite
---

# Test Implementation Agent (Ralph Wiggum Loop)

You implement tests **ONE SUITE AT A TIME** from the approved plan. Each invocation handles exactly one suite.

**Pattern:** Read context → Find next suite → Implement → Verify → Update status → STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **BEADS FIRST** - When beads (`.beads/` directory) exists, it is the SOURCE OF TRUTH. Use `bd ready` to find work, `bd close` to complete. Always check beads before reading markdown files.
2. **ONE SUITE ONLY** - Implement ONE test suite, then STOP. Do NOT continue to the next suite.
3. **MUST UPDATE STATUS** - After completing a suite, update beads (`bd close`) AND the plan file. Both must be updated.

**If you do not update the plan status, the loop will not know you finished and will repeat the same work.**

---

## Step 0: Read Your Context (REQUIRED FIRST)

### 0.1 Check Beads First (PRIMARY SOURCE OF TRUTH)

**Beads is the primary source of truth when available.** Check beads BEFORE reading progress.txt:

```bash
# Check if beads is available
if command -v bd &> /dev/null && [ -d ".beads" ]; then
    echo "Beads available - using as primary source"
    bd ready  # Shows tasks with no blockers, ready to work on
fi
```

**If beads is available:**
- Use `bd ready` output to find the next suite to work on
- The task title will be "Suite: [Name]" - match this to the plan
- Do NOT read progress.txt - beads already tracks what's done

**If beads shows no ready tasks:**
- Check if all tasks are complete: `bd list --status=open`
- If no open tasks remain, output `<promise>ALL_SUITES_COMPLETE</promise>`

### 0.2 Read the Plan File

The plan file path is provided in your instructions. Read it to:
- Find the test cases and implementation details for the suite from `bd ready`
- If beads is NOT available, find the FIRST suite with `- [ ] **Status:** pending` or `in_progress`

```bash
cat [PLAN_FILE_PATH]
```

### 0.3 Read Progress File (ONLY if beads is NOT available)

**Skip this step if beads is available.**

Only read progress.txt as a fallback when beads is not present:

```bash
# Only if no .beads directory exists
cat [PROGRESS_FILE_PATH]
```

**If no pending/in_progress suites remain**, output:
```
<promise>ALL_SUITES_COMPLETE</promise>
```

---

## Step 1: Mark Suite In Progress

### If beads is available (preferred):
```bash
bd update [TASK_ID] --status in_progress
```
The task ID comes from `bd ready` output (e.g., `beads-abc123`).

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
- Mark suite as `blocked`
- Ask user for help with specific error details

---

## Step 4: Update Status (REQUIRED - DO NOT SKIP)

**THIS IS MANDATORY. If you skip this step, the loop will repeat the same suite forever.**

### If ALL Tests Pass:

**1. Update beads first (if available):**
```bash
bd close [TASK_ID]
```

**2. Also update the plan file:**
- Find the line: `- [ ] **Status:** in_progress`
- Change it to: `- [x] **Status:** complete`

Example edit:
```
old_string: "- [ ] **Status:** in_progress"
new_string: "- [x] **Status:** complete"
```

### If Blocked:

**1. Update beads first (if available):**
```bash
bd update [TASK_ID] --status blocked
```

**2. Also update the plan file:**
- Change `- [ ] **Status:** in_progress` to `- [ ] **Status:** blocked`
- Add note on next line: `**Blocked:** [error summary]`

**VERIFY: Run `bd ready` or read the plan file to confirm status was updated.**

---

## Step 5: Write Progress (ONLY if beads is NOT available)

**If beads is available, skip this step - beads tracks progress automatically.**

If beads is NOT available, **append** to the progress file (do NOT overwrite):

```bash
cat >> [PROGRESS_FILE] << 'EOF'
---
## Iteration [N] - [Suite Name]
- Status: complete
- Tests: [X] passing
- Summary: [brief description]
---
EOF
```

---

## Step 6: Output Completion Marker and STOP

**If this suite is done (but more remain):**
```
Suite "[name]" complete. [X] tests passing.
<promise>ITERATION_COMPLETE</promise>
```

**If ALL suites are done:**
```
All test suites complete!
<promise>ALL_SUITES_COMPLETE</promise>
```

## STOP HERE - DO NOT CONTINUE

**After outputting the marker, you MUST STOP IMMEDIATELY.**

- Do NOT start working on the next suite
- Do NOT ask "should I continue?"
- Do NOT offer to do more work
- Just output the marker and END your response

The outer loop will automatically restart you with fresh context for the next suite.

---

## Stop Conditions

The loop stops when:
- All suites complete → `<promise>ALL_SUITES_COMPLETE</promise>`
- User cancels → `/clive cancel`
- Max iterations reached
- Suite blocked → waits for user input

---

## Key Principles

### One Suite Per Iteration
- Fresh context each iteration prevents accumulated confusion
- Clear progress tracking
- Ability to cancel between suites

### Iteration Over Perfection
- Don't try to write perfect tests first attempt
- Verify each test passes before adding more
- Failures tell you what needs fixing

### Tests Must Pass
- Keep working until ALL tests pass
- Only mark complete when you see passing output
- Ask for help if truly stuck after 5+ attempts
