---
description: Implement tests from the approved plan using the Ralph Wiggum loop (one suite at a time)
model: claude-sonnet-4-20250514
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Test Implementation Agent (Ralph Wiggum Loop)

You implement tests ONE SUITE AT A TIME from the approved plan. Each invocation handles exactly one suite.

## The Ralph Wiggum Pattern

This command follows the "iteration over perfection" philosophy:

- Work on ONE suite per invocation
- Track progress via the plan file
- Loop automatically continues to the next suite
- Stop conditions (completion, max iterations, cancellation) end the loop

---

## Stop Conditions

The test loop will automatically stop when ANY of these conditions are met:

| Condition | Trigger | What Happens |
|-----------|---------|--------------|
| **All Complete** | All suites marked `complete` or `failed` | Outputs `<promise>ALL_SUITES_COMPLETE</promise>` and exits |
| **User Cancellation** | User runs `/clive cancel` | Stops at next iteration boundary |
| **Max Iterations** | Iteration count >= `CLIVE_MAX_ITERATIONS` | Stops to prevent runaway execution |
| **Plan Not Found** | Plan file deleted or moved | Stops with error message |
| **No Remaining Work** | 0 pending + 0 in_progress suites | Exits cleanly |

### Max Iterations

**Default:** 50 iterations

**Configure via argument (recommended):**
```bash
# Set higher limit for large test suites
/clive test --max-iterations 100

# Set lower limit for faster feedback
/clive test --max-iterations 20

# Combine with specific plan file
/clive test .claude/test-plan-feature-auth.md --max-iterations 75
```

**Or via environment variable (fallback):**
```bash
export CLIVE_MAX_ITERATIONS=100
```

**Priority:** `--max-iterations` argument > `CLIVE_MAX_ITERATIONS` env var > default (50)

**Why max iterations?**
- Prevents infinite loops if plan parsing fails
- Provides a safety net for unexpected edge cases
- Allows user to set bounds based on project size

### Cancellation

To stop the loop at any time:
```bash
/clive cancel
```

This creates `.claude/.cancel-test-loop` which is checked before each iteration.

---

## Step 1: Parse Arguments and Resolve Plan File

**Arguments format:** `/clive test [plan-path] [--max-iterations N]`

```bash
# Parse arguments
PLAN_FILE=""
MAX_ITERATIONS=""

# Parse $ARGUMENTS for plan path and --max-iterations
for arg in $ARGUMENTS; do
    case "$arg" in
        --max-iterations)
            # Next arg will be the value
            NEXT_IS_MAX=1
            ;;
        *)
            if [ -n "$NEXT_IS_MAX" ]; then
                MAX_ITERATIONS="$arg"
                unset NEXT_IS_MAX
            elif [ -z "$PLAN_FILE" ] && [[ "$arg" != --* ]]; then
                PLAN_FILE="$arg"
            fi
            ;;
    esac
done

# Store max iterations if provided (for stop-hook to read)
if [ -n "$MAX_ITERATIONS" ]; then
    echo "$MAX_ITERATIONS" > .claude/.test-max-iterations
    echo "Max iterations set to: $MAX_ITERATIONS"
fi

# Resolve plan file if not specified
if [ -z "$PLAN_FILE" ]; then
    if [ -f ".claude/test-plan-latest.md" ]; then
        # Resolve symlink to actual file
        PLAN_FILE=$(readlink .claude/test-plan-latest.md 2>/dev/null || echo ".claude/test-plan-latest.md")
        PLAN_FILE=".claude/$PLAN_FILE"
        echo "Using latest plan: $PLAN_FILE"
    elif [ -f ".claude/test-plan.md" ]; then
        PLAN_FILE=".claude/test-plan.md"
        echo "Using default plan: $PLAN_FILE"
    else
        # Try to find any test plan
        PLAN_FILE=$(ls -t .claude/test-plan-*.md 2>/dev/null | head -1)
        if [ -n "$PLAN_FILE" ]; then
            echo "Found plan: $PLAN_FILE"
        fi
    fi
else
    echo "Using specified plan: $PLAN_FILE"
fi

# Verify plan exists
if [ ! -f "$PLAN_FILE" ]; then
    echo "Error: No test plan found."
    echo ""
    echo "Available plans:"
    ls -la .claude/test-plan-*.md 2>/dev/null || echo "  None found"
    echo ""
    echo "Run '/clive plan' first to create a test plan."
    echo "Or specify a plan: '/clive test .claude/test-plan-main.md'"
    exit 1
fi

# Store the plan path for the stop-hook to use
echo "$PLAN_FILE" > .claude/.test-plan-path
```

---

## Step 2: Read the Plan

```bash
cat "$PLAN_FILE"
```

Parse the plan and find the **FIRST** suite matching one of these conditions:

1. `- [ ] **Status:** in_progress` (resume incomplete work)
2. `- [ ] **Status:** pending` (start next suite)

**If no pending/in_progress suites remain:**

```
<promise>ALL_SUITES_COMPLETE</promise>

All test suites have been implemented!

Summary:
- Total suites: [N]
- Completed: [N]
- Failed: [N]

Plan file: [PLAN_FILE]
Run your test suite to verify: [test command]
```

---

## Step 3: Mark Suite In Progress

Update the plan file (`$PLAN_FILE`) to mark the current suite:

- Change `- [ ] **Status:** pending` to `- [ ] **Status:** in_progress`

This tracks progress across iterations.

---

## Step 4: Implement Tests (Iterative Approach)

### 4.1 Check if Test File Exists

```bash
cat [target-path] 2>/dev/null || echo "FILE_NOT_FOUND"
```

### 4.2 If FILE_NOT_FOUND (Creating New Test File)

**CRITICAL: Start with ONE test case first!**

1. **Write the simplest test first** to verify setup works:

```typescript
import { describe, it, expect } from "vitest"; // or jest/mocha

describe("[Component/Function Name]", () => {
  it("should [most basic behavior]", () => {
    // Minimal test to verify imports and setup work
  });
});
```

2. **Run immediately** to verify setup:

```bash
npm test -- [test-file-path]
# or
yarn test [test-file-path]
# or
npx vitest run [test-file-path]
```

3. **If it fails**, fix the issue before adding more tests (max 3 fix attempts)

4. **After first test passes**, add remaining tests in logical groups

### 4.3 If File Exists (Updating/Adding Tests)

1. Read existing tests to understand structure
2. Use targeted edits to add/update test cases
3. Follow the existing file's patterns and conventions

### 4.4 Test Implementation Rules

**MANDATORY Quality Requirements:**

- NO placeholder tests: `expect(true).toBe(true)` is FORBIDDEN
- NO empty test bodies: `it('should work', () => {})` is FORBIDDEN
- Every test MUST verify actual behavior from source code
- Match function signatures EXACTLY
- Use proper TypeScript types for mocks
- Import from existing mock factories when available

**Test Pattern:**

```typescript
it("should [specific behavior]", async () => {
  // Arrange - set up test data and mocks
  const input = {
    /* realistic test data */
  };

  // Act - call the function/method being tested
  const result = await functionUnderTest(input);

  // Assert - verify expected behavior
  expect(result).toEqual(expectedOutput);
});
```

---

## Step 5: Verify Tests Pass

Run the specific test file:

```bash
# Detect and use the right test runner
if grep -q "vitest" package.json; then
  npx vitest run [test-file-path]
elif grep -q "jest" package.json; then
  npx jest [test-file-path]
else
  npm test -- [test-file-path]
fi
```

**If tests fail:**

1. Read the error message carefully
2. Fix the specific issue (don't rewrite everything)
3. Run tests again
4. Maximum 3 fix attempts per suite

---

## Step 6: Update Plan Status

### If Tests Pass:

Update the plan file (`$PLAN_FILE`):

- Change `- [ ] **Status:** in_progress` to `- [x] **Status:** complete`
- Check off completed test cases

### If Tests Fail After 3 Attempts:

Update the plan file (`$PLAN_FILE`):

- Change `- [ ] **Status:** in_progress` to `- [x] **Status:** failed`
- Add failure note: `**Failure Reason:** [brief description]`

---

## Step 7: Report Progress

Output a brief progress report:

```
Suite "[name]" complete. [X] tests passing.

Progress: [completed]/[total] suites
- Completed: [list]
- Remaining: [list]

Plan: [PLAN_FILE]
```

The loop will automatically continue to the next suite. Use `/clive cancel` to stop early if needed.

---

## Completion Detection

When ALL suites are marked as `complete` or `failed`, output the completion promise:

```
<promise>ALL_SUITES_COMPLETE</promise>

Test implementation finished!

Final Results:
- Completed: [N] suites
- Failed: [N] suites
- Skipped: [N] suites

Plan: [PLAN_FILE]

Next steps:
1. Run full test suite: [command]
2. Review any failed suites
3. Check coverage if applicable
```

---

## Error Handling

**If plan file doesn't exist:**

```
Error: No test plan found.

Available plans:
[list any .claude/test-plan-*.md files]

Run '/clive plan' first to create a test plan.
Or specify a plan: '/clive test .claude/test-plan-main.md'
```

**If test framework cannot be detected:**

```
Warning: Could not detect test framework. Please specify in the plan or configure package.json.

Common frameworks: vitest, jest, mocha, playwright, cypress
```

---

## Usage Examples

```bash
# Use the latest plan (symlink)
/clive test

# Use a specific plan file
/clive test .claude/test-plan-feature-auth.md

# Set max iterations
/clive test --max-iterations 100

# Combine plan file with max iterations
/clive test .claude/test-plan-feature-auth.md --max-iterations 25

# Use an absolute path
/clive test /path/to/custom-plan.md
```

---

## Philosophy: Iteration Over Perfection

- Don't try to write perfect tests on the first attempt
- Verify each test passes before adding more
- Failures are data - they tell you what needs fixing
- One suite at a time prevents overwhelming failures
- Progress is tracked in the plan file for visibility
