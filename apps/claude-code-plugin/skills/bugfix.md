---
name: bugfix
description: Fix bugs with proper root cause analysis
category: bugfix
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__update_issue, mcp__linear__get_issue
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Bug Fix Skill

You fix bugs **ONE TASK AT A TIME** with proper root cause analysis. Each invocation handles exactly one bug.

**Pattern:** Reproduce -> Find root cause -> Fix -> Add regression test -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **ONE TASK ONLY** - Fix ONE bug, then STOP.
3. **MUST UPDATE STATUS** - Update tracker AND plan file after completion.
4. **ADD REGRESSION TEST** - Prevent the bug from returning.

---

## Step 0: Read Your Context

### 0.1 Detect Tracker and Check Ready Work
```bash
# Read tracker preference
TRACKER=$(cat ~/.clive/config.json 2>/dev/null | jq -r '.issue_tracker // "beads"')
echo "Using tracker: $TRACKER"

if [ "$TRACKER" = "beads" ] && [ -d ".beads" ]; then
    bd ready
fi
# For Linear: The TUI passes the current task info via $TASK_ID environment variable
```

### 0.2 Read the Plan File
Get bug description, reproduction steps, and expected behavior from the plan.

---

## Step 1: Mark Task In Progress

**For Beads:**
```bash
bd update [TASK_ID] --status in_progress
```

**For Linear:**
Use `mcp__linear__update_issue` with:
- `id`: The task ID
- `state`: "In Progress" (or equivalent workflow state)
- `assignee`: "me"

---

## Step 2: Reproduce the Bug

### 2.1 Verify Bug Exists

Before fixing, confirm you can reproduce the bug:
```bash
# Run existing tests to see if they catch it
npm test

# Or manually trigger the bug
```

**If you cannot reproduce:** Ask for more details before proceeding.

### 2.2 Document Reproduction Steps

Note exactly how to trigger the bug for future reference.

---

## Step 3: Find Root Cause

### 3.1 Trace the Code Path

Read the code involved in the bug:
```bash
# Find relevant files
grep -r "functionName" --include="*.ts" .

# Read the implementation
cat path/to/file.ts
```

### 3.2 Identify the Actual Problem

Common root causes:
- **Logic error** - Wrong condition, missing case
- **Type error** - Null/undefined not handled
- **Race condition** - Async operations not awaited
- **Missing validation** - Bad input not caught
- **State mutation** - Unexpected side effects

### 3.3 Understand Impact

Before fixing, understand:
- What other code depends on this?
- Could the fix break something else?
- Is this a symptom of a deeper issue?

---

## Step 4: Fix the Bug

### 4.1 Minimal Fix

Make the smallest change that fixes the bug:

```typescript
// Before (bug)
function getUser(id: string) {
  return users.find(u => u.id === id).name; // Crashes if not found!
}

// After (fix)
function getUser(id: string) {
  const user = users.find(u => u.id === id);
  if (!user) return null;
  return user.name;
}
```

### 4.2 Quality Rules

- **Minimal changes** - Fix the bug, nothing more
- **No refactoring** - Create a separate task for that
- **Document why** - Add a comment if the fix isn't obvious
- **Handle edge cases** - If this bug exists, similar ones might too

---

## Step 5: Add Regression Test

**REQUIRED: Every bug fix MUST include a test that would have caught it.**

```typescript
it("should handle user not found", () => {
  const result = getUser("nonexistent-id");
  expect(result).toBeNull();
});
```

This test ensures the bug never returns.

---

## Step 6: Verify Fix Works

### Run All Tests
```bash
npm test
```

### Specifically Run the New Test
```bash
npm test -- --grep "should handle user not found"
```

### Build Check
```bash
npm run build
```

**ALL tests must pass before marking complete.**

---

## Discovered Work Protocol

**During bug investigation, you may discover work outside the current task's scope:**

- Other bugs in the same area
- Missing tests (beyond the regression test)
- Code that needs refactoring to prevent future bugs
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
- **Continue with your current bug fix** - do not switch focus
- The new task will be picked up in a future iteration

---

## Step 7: Update Status

**For Beads:**
```bash
bd close [TASK_ID]
```

**For Linear:**
Use `mcp__linear__update_issue` with:
- `id`: The task ID
- `state`: "Done" (or equivalent completed workflow state)

Update plan: `- [x] **Status:** complete`

---

## Step 7.5: Commit Changes (REQUIRED)

**Create a local commit for this task before marking complete:**

```bash
git add -A
git commit -m "fix: [brief description of bug fixed]

Task: [TASK_ID or task name]
Skill: bugfix"
```

**Note:** Local commits only - do NOT push. Push at session end or user request.

---

## Step 7.6: Update Scratchpad (REQUIRED)

**Before outputting the completion marker, update the scratchpad for the next agent:**

```bash
cat >> .claude/scratchpad.md << 'SCRATCHPAD'

## [Task Title]
**Completed:** [timestamp]

### Root Cause
- [What caused the bug]

### Fix Applied
- [How it was fixed]

### Files Modified
- [Files changed]

### Notes for Next Agent
- [Related areas that might have similar issues]
- [Regression test added]
- [Edge cases discovered]

SCRATCHPAD
```

---

## Step 8: Output Completion Marker

```
Task "[name]" complete. Bug fixed with regression test.
<promise>TASK_COMPLETE</promise>
```

**STOP IMMEDIATELY after outputting the marker.**

---

## Common Pitfalls

- **Fixing symptoms** - Find the root cause, not just the visible error
- **Over-engineering** - Simple fix is usually best
- **Missing regression test** - ALWAYS add a test
- **Breaking other things** - Run full test suite
- **Scope creep** - Don't "clean up" surrounding code
