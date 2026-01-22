---
name: bugfix
description: Fix bugs with proper root cause analysis
category: bugfix
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__create_comment
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Bug Fix Skill

You fix bugs **ONE TASK AT A TIME** with proper root cause analysis. Each invocation handles exactly one bug.

**Pattern:** Reproduce -> Find root cause -> Fix -> Add regression test -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **MARK IN PROGRESS IMMEDIATELY** - Update tracker status to "In Progress" before any fix work.
3. **ONE TASK ONLY** - Fix ONE bug, then STOP.
4. **MARK DONE AT COMPLETION** - Update tracker status to "Done" after verification passes.
5. **BOTH STATUS TRANSITIONS REQUIRED** - Must call status update at START and at COMPLETION.
6. **ADD REGRESSION TEST** - Prevent the bug from returning.

---

## Step 0: Verify Task Information

**Before fixing anything, ensure you have task details:**

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

### 0.5.2 Read Acceptance Criteria and Definition of Done

**CRITICAL: Read task requirements FIRST before any fix work.**

**Your task includes:**
- **Acceptance Criteria** - Specific, testable requirements that define "fixed"
- **Definition of Done** - Checklist including regression tests, verification
- **Technical Notes** - Bug reproduction steps, root cause hints, related code

**Where to find them:**
- **For Linear**: Call `mcp__linear__get_issue` with the task ID to fetch full description
- **For Beads**: Task description in the prompt contains AC and DoD
- **In plan file**: Check `.claude/plans/*.md` for detailed bug description

**Parse the requirements:**
```
Bug Description:
[What's broken and impact]

Acceptance Criteria:
1. [Specific testable criterion - bug is fixed]
2. [Error no longer occurs]
3. [Expected behavior restored]

Definition of Done:
- [ ] All acceptance criteria met
- [ ] Regression test written and passing
- [ ] Bug no longer reproducible
- [ ] All existing tests still pass
- [ ] Build succeeds

Technical Notes:
- Reproduction steps: [how to trigger bug]
- Root cause hints: [suspected issue]
- Related code: [files to investigate]
```

**Important:**
- **Acceptance criteria define "fixed"** - Bug is only fixed when ALL criteria met
- **DoD includes regression test** - Test MUST be added to prevent recurrence
- **Technical notes guide investigation** - Follow reproduction steps provided

---

## Step 1: Mark Task In Progress (REQUIRED - DO NOT SKIP)

**You MUST update the tracker status before starting the fix. This is NON-NEGOTIABLE.**

**For Beads:**
```bash
bd update [TASK_ID] --status in_progress
```

**For Linear:**
Call `mcp__linear__update_issue` with these EXACT parameters:
- `id`: The task ID (from environment $TASK_ID or passed in prompt)
- `state`: "In Progress"
- `assignee`: "me"

**Verify the call succeeded before proceeding to investigation.**

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

## Step 6: Verify Fix and Acceptance Criteria

### 6.1 Verify All Acceptance Criteria (CRITICAL)

**Before marking task complete, verify EVERY acceptance criterion from Step 0.5.2:**

**Example verification:**
```
✓ Acceptance Criteria Check:

1. "Error no longer occurs when user ID not found"
   ✓ Verified: getUser() returns null instead of crashing
   ✓ Test: regression test "handles missing user" passes
   ✓ Manual: Tested with nonexistent ID - no crash

2. "Proper error handling for edge cases"
   ✓ Verified: Null check added before accessing user properties
   ✓ Test: edge case tests pass
   ✓ Manual: Confirmed graceful handling

3. "Existing functionality unaffected"
   ✓ Verified: Valid user IDs still work correctly
   ✓ Test: all existing tests still pass
   ✓ Manual: Tested happy path - works as before

All acceptance criteria met ✓
```

**If ANY criterion is not met, DO NOT mark complete. Fix remaining issues first.**

### 6.2 Verify Definition of Done

**Check off every item from the task's Definition of Done:**

```
Definition of Done verification:
- [✓] All acceptance criteria met (verified above)
- [✓] Regression test written and passing
- [✓] Bug no longer reproducible
- [✓] All existing tests still pass
- [✓] Build succeeds
- [✓] No new linting errors
```

**Run quality checks:**
```bash
# All tests including new regression test
npm test  # Must pass with ZERO failures

# Build check
npm run build  # Must succeed

# Lint check
npm run lint  # Must pass with ZERO new warnings
```

**If ANY DoD item is incomplete, DO NOT mark complete. Finish it first.**

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

## Step 7: Mark Task Complete (REQUIRED - DO NOT SKIP)

**Before outputting TASK_COMPLETE marker, you MUST:**

1. Verify bug is fixed and tests pass
2. Confirm regression test added
3. **Update tracker status to "Done"**

**For Beads:**
```bash
bd close [TASK_ID]
```

**For Linear:**

1. **First, add a completion comment:**
   Call `mcp__linear__create_comment` with:
   - `issueId`: The current task ID
   - `body`: A summary of the bug fix, including:
     - Root cause identified
     - Fix implemented
     - Regression test added
     - Files changed
     - Any developer notes or gotchas

   Example comment:
   ```
   🐛 Bug Fixed: [Brief summary]

   Root Cause: [What caused the bug]

   Fix:
   - [Specific changes made]

   Regression Test: [Test file and what it covers]

   Files Changed:
   - src/foo.ts
   - src/bar.test.ts

   Developer Notes: [Any important context for future devs]
   ```

2. **Then, mark the task Done:**
   Call `mcp__linear__update_issue` with:
   - `id`: The current task ID
   - `state`: "Done"

**If either call fails, DO NOT mark the task complete. Debug the issue first.**

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

**ONLY output the marker if ALL of these are verified:**
- [ ] ALL acceptance criteria verified and met (Step 6.1)
- [ ] ALL Definition of Done items checked off (Step 6.2)
- [ ] Bug fixed and root cause addressed
- [ ] Regression test added and passing
- [ ] All tests pass (existing + new)
- [ ] Tracker status updated to "Done" (mcp__linear__update_issue or bd close called successfully)
- [ ] Git commit created
- [ ] Scratchpad updated with notes for next agent

**If any item is incomplete, complete it first. Then output:**

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
