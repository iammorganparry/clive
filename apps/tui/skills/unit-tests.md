---
name: unit-tests
description: Implement unit tests that catch bugs, not just coverage - test boundaries, failure modes, and stress logic
category: test
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__create_comment
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Unit Tests Skill

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

### 2.0 TEST PHILOSOPHY (READ THIS FIRST)

**Tests exist to catch bugs BEFORE they reach production, not to hit coverage metrics.**

Every test you write should answer: **"What bug would this catch?"**

If you can't answer that question, don't write the test.

#### What Makes a Valuable Test

1. **Tests edge cases that humans miss** - Boundaries, nulls, empty states, maximum values
2. **Tests failure modes** - What happens when things go wrong?
3. **Tests assumptions** - What does the code assume that might be violated?
4. **Tests complex logic paths** - Conditionals, loops, state transitions
5. **Tests integration points** - Where data crosses boundaries

#### What NOT to Test (Anti-patterns)

```typescript
// ❌ BAD: Testing language features
it("should return undefined when property doesn't exist", () => {
  const obj = {};
  expect(obj.foo).toBeUndefined(); // JavaScript already guarantees this
});

// ❌ BAD: Testing basic shapes/types (TypeScript handles this)
it("should return an object with name property", () => {
  const result = getUser();
  expect(result).toHaveProperty("name"); // TypeScript already enforces this
});

// ❌ BAD: Testing implementation details
it("should call logger.info exactly 3 times", () => {
  // Who cares? Test the behavior, not the implementation
});

// ❌ BAD: Tautological tests
it("should return what it returns", () => {
  const result = calculate(5);
  expect(result).toBe(calculate(5)); // This can never fail!
});

// ❌ BAD: Coverage-driven placeholder tests
it("should handle the else branch", () => {
  // This test exists only to hit a coverage line
});
```

### 2.1 Identify Bug-Prone Areas First

**Before writing tests, analyze the code for likely bugs:**

```typescript
// Example: Analyzing a function for test cases
function calculateDiscount(price: number, quantity: number, memberLevel: string): number {
  // Bug-prone areas to test:
  // 1. BOUNDARIES: price=0, quantity=0, negative values
  // 2. EDGE CASES: memberLevel not recognized, empty string
  // 3. MATH ERRORS: floating point precision, rounding
  // 4. OVERFLOW: huge price * huge quantity
  // 5. TYPE COERCION: what if price is "100" (string)?
}
```

**Ask these questions:**
- What inputs would break this?
- What happens at boundary values (0, -1, MAX_INT, empty string, null)?
- What if the caller passes unexpected types?
- What if external dependencies fail?
- What race conditions could occur?
- What state combinations are invalid?

### 2.2 Write Tests That Stress Logic

```typescript
// ✅ GOOD: Testing boundaries that catch real bugs
describe("calculateDiscount", () => {
  // Boundary: zero values
  it("returns 0 when price is 0 regardless of quantity", () => {
    expect(calculateDiscount(0, 100, "gold")).toBe(0);
  });

  it("returns 0 when quantity is 0 regardless of price", () => {
    expect(calculateDiscount(100, 0, "gold")).toBe(0);
  });

  // Edge case: negative values (should these be allowed?)
  it("throws error for negative price", () => {
    expect(() => calculateDiscount(-10, 5, "gold")).toThrow("Price cannot be negative");
  });

  // Edge case: unknown member level
  it("applies no discount for unrecognized member level", () => {
    expect(calculateDiscount(100, 1, "platinum")).toBe(100); // No discount
    expect(calculateDiscount(100, 1, "")).toBe(100);
    expect(calculateDiscount(100, 1, "GOLD")).toBe(100); // Case sensitivity bug?
  });

  // Math precision bugs
  it("handles floating point prices without precision errors", () => {
    // 0.1 + 0.2 !== 0.3 in JavaScript
    expect(calculateDiscount(0.1, 1, "none")).toBeCloseTo(0.1, 10);
  });

  // Overflow protection
  it("handles maximum safe integer values", () => {
    expect(() => calculateDiscount(Number.MAX_SAFE_INTEGER, 2, "none")).toThrow();
  });
});
```

### 2.3 Test Failure Modes (The Happy Path Isn't Enough)

```typescript
// ✅ GOOD: Testing what happens when things go wrong
describe("fetchUserProfile", () => {
  it("returns cached data when API fails", async () => {
    mockApi.get.mockRejectedValue(new Error("Network error"));
    const result = await fetchUserProfile("123");
    expect(result).toEqual(cachedUser); // Falls back gracefully
  });

  it("throws specific error when user not found", async () => {
    mockApi.get.mockRejectedValue({ status: 404 });
    await expect(fetchUserProfile("invalid")).rejects.toThrow(UserNotFoundError);
  });

  it("handles timeout without crashing", async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {})); // Never resolves
    await expect(fetchUserProfile("123", { timeout: 100 })).rejects.toThrow("Timeout");
  });

  it("retries on 503 before failing", async () => {
    mockApi.get
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue({ data: user });

    const result = await fetchUserProfile("123");
    expect(result).toEqual(user);
    expect(mockApi.get).toHaveBeenCalledTimes(3);
  });
});
```

### 2.4 Test State Transitions and Invariants

```typescript
// ✅ GOOD: Testing state machine logic catches subtle bugs
describe("OrderStateMachine", () => {
  it("cannot transition from CANCELLED to SHIPPED", () => {
    const order = new Order();
    order.cancel();
    expect(() => order.ship()).toThrow("Cannot ship cancelled order");
  });

  it("cannot be cancelled after shipping", () => {
    const order = new Order();
    order.ship();
    expect(() => order.cancel()).toThrow("Cannot cancel shipped order");
  });

  it("maintains inventory invariant through transitions", () => {
    const inventory = new Inventory({ widget: 10 });
    const order = new Order({ item: "widget", quantity: 3 });

    order.reserve(inventory);
    expect(inventory.available("widget")).toBe(7);

    order.cancel();
    expect(inventory.available("widget")).toBe(10); // Restored!
  });
});
```

### 2.5 Test Async Edge Cases

```typescript
// ✅ GOOD: Testing race conditions and async bugs
describe("debounced search", () => {
  it("only executes final call when rapid-fired", async () => {
    const search = vi.fn();
    const debouncedSearch = debounce(search, 100);

    debouncedSearch("a");
    debouncedSearch("ab");
    debouncedSearch("abc");

    await vi.advanceTimersByTimeAsync(150);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("abc");
  });

  it("handles out-of-order async responses correctly", async () => {
    let resolvers: Function[] = [];
    mockApi.search.mockImplementation(() => new Promise(r => resolvers.push(r)));

    const result1Promise = search("slow");
    const result2Promise = search("fast");

    // Second request finishes first
    resolvers[1]({ results: ["fast-result"] });
    resolvers[0]({ results: ["slow-result"] });

    // Should show fast result, not stale slow result
    expect(await getCurrentResults()).toEqual(["fast-result"]);
  });
});
```

### 2.6 Run Tests After Each Addition

```bash
npm test -- [test-file-path]
# or: yarn test, npx vitest run, etc.
```

**Discover the correct test command** from package.json if unsure.

### 2.7 Quality Checklist (Before Moving On)

For each test, verify:

- [ ] **Bug-catching**: This test would catch a real bug (not just coverage)
- [ ] **Specific**: Tests ONE behavior, fails for ONE reason
- [ ] **Readable**: Another dev can understand what's being tested
- [ ] **Maintainable**: Tests behavior, not implementation details
- [ ] **Fast**: No unnecessary waits or slow operations
- [ ] **Isolated**: Doesn't depend on other tests or external state

**FORBIDDEN patterns:**
- `expect(true).toBe(true)` or similar placeholders
- Empty test bodies
- Tests that can never fail
- Tests that only verify types (TypeScript does this)
- Tests that mirror the implementation

### 2.8 Test Data Management

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

### 2.9 Document Testing Patterns (Global Learnings)

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

1. **Bug Prevention:** What specific bugs would these tests catch? Can you name them?
2. **Edge Cases:** Did you test boundaries (0, -1, empty, null, MAX)? What edges are untested?
3. **Failure Modes:** Did you test what happens when things go wrong (errors, timeouts, invalid state)?
4. **Confidence Level:** On a scale of 1-10, how confident are you this code won't break in production?
5. **Remaining Risk:** What could still go wrong that isn't tested?
6. **Test Weakness:** Which test is weakest? Why?

**Append reflection to scratchpad:**
```bash
cat >> $SCRATCHPAD_FILE << 'REFLECTION'

### 🔄 Post-Task Reflection

**Bugs These Tests Catch:**
- [Specific bug 1 that would be caught]
- [Specific bug 2 that would be caught]

**Edge Cases Tested:** [boundaries, nulls, empty states covered]
**Edge Cases NOT Tested:** [what's still risky]

**Failure Modes Tested:** [error paths, timeouts, invalid inputs]
**Failure Modes NOT Tested:** [remaining risk areas]

**Confidence Level:** [1-10] - [why this score]
**Weakest Test:** [which one and why]

**What Would Break This Code:** [scenarios still untested]

REFLECTION
```

**This reflection forces honest assessment of test quality, not just completion.**

---

## Step 4: Mark Task Complete (REQUIRED - DO NOT SKIP)

**Before outputting TASK_COMPLETE marker, you MUST:**

1. Verify all tests pass
2. Confirm each test catches a specific, nameable bug
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
- [ ] Each test catches a specific, nameable bug (not just coverage)
- [ ] Edge cases and failure modes are tested
- [ ] Tracker status updated to "Done" (mcp__linear__update_issue or bd close called successfully)
- [ ] Git commit created
- [ ] Scratchpad updated with bugs-caught reflection

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

### Tests Catch Bugs, Not Coverage Lines
- Every test should answer: "What bug would this catch?"
- If you can't identify the bug it prevents, don't write the test
- Coverage is a side effect of good testing, not the goal
- 5 tests that catch real bugs > 50 tests that just exist

### Bug Hunting Mindset
- Think like an attacker: What inputs would break this?
- Test boundaries: 0, -1, empty, null, MAX_INT
- Test failure modes: What happens when dependencies fail?
- Test state: What invalid state combinations are possible?
- Test time: Race conditions, timeouts, order of operations

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
