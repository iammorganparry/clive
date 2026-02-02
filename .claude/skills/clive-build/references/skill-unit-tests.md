# Unit Tests Skill Reference

You implement unit tests **ONE TASK AT A TIME** from the approved plan. Each invocation handles exactly one task.

**Pattern:** Read context -> Find task details -> Implement -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **MARK IN PROGRESS IMMEDIATELY** - Update tracker status to "In Progress" before writing tests.
3. **ONE TASK ONLY** - Implement ONE test suite, then STOP. Do NOT continue to the next task.
4. **MARK DONE AT COMPLETION** - Update tracker status to "Done" after tests pass.
5. **BOTH STATUS TRANSITIONS REQUIRED** - Must call status update at START and at COMPLETION.

**If you do not update status, the loop will repeat the same work forever.**

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

## Step 0.5: Read Your Context (REQUIRED FIRST)

### 0.5.1 Detect Tracker and Check Ready Work

```bash
# Read tracker preference
TRACKER=$(cat ~/.clive/config.json 2>/dev/null | jq -r '.issue_tracker // "beads"')
echo "Using tracker: $TRACKER"

if [ "$TRACKER" = "beads" ] && command -v bd &> /dev/null && [ -d ".beads" ]; then
    echo "Beads available - using as primary source"
    bd ready  # Shows tasks with no blockers, ready to work on
fi
# For Linear: Task info should now be available from Step 0
```

**If no ready tasks:**
- For Beads: Check if all tasks are complete: `bd list --status=open`
- If no open tasks remain, output `<promise>ALL_TASKS_COMPLETE</promise>`

### 0.2 Read the Plan File

The plan file path is provided in your instructions. Read it to find the test cases and implementation details for the current task.

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

### 2.6 Document Testing Patterns (Global Learnings)

**If you discover effective testing patterns during this work:**

1. **Check global learnings first:**
   - Review `.claude/learnings/success-patterns.md` for established testing patterns
   - Check `.claude/learnings/gotchas.md` for testing quirks

2. **If you discover a reusable testing pattern:**
   ```bash
   cat >> .claude/learnings/success-patterns.md << 'EOF'

   ### [Testing Pattern Name]
   **Use Case:** [When to apply this testing pattern]
   **Implementation:** [How to implement with code example]
   **Benefits:** [What this improves - reliability, speed, clarity]
   **Examples:** [Test files where this was successfully used]
   **First Used:** $(date '+%Y-%m-%d') - Epic: $EPIC_FILTER - Task: [TASK_IDENTIFIER]
   **Reused In:** [Will be updated when pattern is reused]

   ---
   EOF
   ```

3. **For testing-related gotchas:**
   ```bash
   cat >> .claude/learnings/gotchas.md << 'EOF'

   ### [Testing Gotcha Name]
   **What Happens:** [Problem that occurs during testing]
   **Why:** [Reason or framework limitation]
   **How to Handle:** [Correct testing approach]
   **Files Affected:** [Where this applies]
   **Discovered:** $(date '+%Y-%m-%d') - Epic: $EPIC_FILTER - Iteration: $ITERATION

   ---
   EOF
   ```

**Document patterns that help future agents write better tests.**

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

### 1. Create a Task for Discovered Work

**For Beads:**
```bash
bd create --title="[Brief description]" \
  --type=task \
  --priority=2 \
  --labels "skill:[appropriate-skill],category:[category],discovered:true"
```

**For Linear:**
Use `mcp__linear__create_issue` with:
- `title`: Brief description of discovered work
- `labels`: `["skill:[appropriate-skill]", "category:[category]", "discovered:true"]`
- `parentId`: The current parent issue ID (to keep it grouped)

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

## Step 3.5: Validate Scratchpad Documentation (MANDATORY)

**Before marking task complete, verify you've documented learnings.**

**Check scratchpad was updated:**
```bash
# Verify scratchpad has entry for this iteration
ITERATION=$(cat .claude/.build-iteration)

if [ -f "$SCRATCHPAD_FILE" ]; then
    if ! grep -q "## Iteration $ITERATION" "$SCRATCHPAD_FILE"; then
        echo "ERROR: Scratchpad not updated for iteration $ITERATION"
        echo "You MUST document learnings in scratchpad before completion"
        echo "See scratchpad template in prompt above"
        exit 1
    fi
else
    echo "ERROR: Scratchpad file not found at $SCRATCHPAD_FILE"
    exit 1
fi
```

**Scratchpad checklist:**
- [ ] "What Worked" section documents effective testing approaches
- [ ] "Key Decisions" section explains testing strategy choices
- [ ] "Files Modified" section lists all test files
- [ ] "Success Patterns" section documents reusable test patterns
- [ ] Date/time stamp is current

**If scratchpad is incomplete:**
- Fill it out NOW before proceeding
- Use the structured template provided in the prompt
- Be specific about testing patterns and decisions

## Step 3.6: Post-Task Reflection (MANDATORY)

**Before outputting TASK_COMPLETE, reflect on this testing work:**

**Answer these questions in scratchpad:**

1. **Test Quality:** Are these tests resilient to refactoring? Do they test behavior, not implementation?
2. **Coverage:** What edge cases are covered? What's missing?
3. **Pattern Discovery:** Did you establish a reusable testing pattern?
4. **Mocking Strategy:** Was the mocking approach effective? Too complex?
5. **Test Speed:** Are tests fast enough? Any performance concerns?
6. **Knowledge Gap:** What would have made writing these tests faster?

**Append reflection to scratchpad:**
```bash
cat >> $SCRATCHPAD_FILE << 'REFLECTION'

### 🔄 Post-Task Reflection

**Test Quality:** [resilient/brittle - behavior-focused/implementation-focused]
**Coverage:** [edge cases covered, gaps identified]
**Pattern Discovered:** [reusable testing technique]
**Mocking Strategy:** [effective/overcomplicated]
**Test Speed:** [fast/slow - performance notes]
**Learned:** [key insight for future testing]

REFLECTION
```

**This reflection helps future agents write better tests.**

---

## Step 4: Mark Task Complete (REQUIRED - DO NOT SKIP)

**Before outputting TASK_COMPLETE marker, you MUST:**

1. Verify all tests pass
2. Confirm tests provide adequate coverage
3. Validate scratchpad documentation (Step 3.5)
4. Complete post-task reflection (Step 3.6)
5. **Update tracker status to "Done"**

**For Beads:**
```bash
bd close [TASK_ID]
```

**For Linear:**
Call `mcp__linear__update_issue` with:
- `id`: The current task ID
- `state`: "Done"

**If this call fails, DO NOT mark the task complete. Debug the issue first.**

**Also update the plan file:**
- Find the line: `- [ ] **Status:** in_progress`
- Change it to: `- [x] **Status:** complete`

### If Blocked:

**For Beads:**
```bash
bd update [TASK_ID] --status blocked
```

**For Linear:**
Use `mcp__linear__update_issue` with:
- `id`: The task ID
- `state`: "Blocked" (or add "blocked" label)

**Also update the plan file:**
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

**ONLY output the marker if ALL of these are verified:**
- [ ] All tests written and passing
- [ ] Tests provide adequate coverage
- [ ] Tracker status updated to "Done" (mcp__linear__update_issue or bd close called successfully)
- [ ] Git commit created
- [ ] Scratchpad updated with test patterns

**If any item is incomplete, complete it first. Then output:**

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
