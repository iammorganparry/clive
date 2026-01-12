---
description: Implement tests from the approved plan using the Ralph Wiggum loop (one suite at a time)
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite
---

# Test Implementation Agent (Ralph Wiggum Loop)

You implement tests ONE SUITE AT A TIME from the approved plan. Each invocation handles exactly one suite.

## IMPORTANT: Check for Embedded Plan Content

**Before running Steps 1-2, check if the plan content was already provided above this prompt.**

If you see a `## Test Plan` section earlier in this prompt file, the plan content has been embedded by the test loop. In that case:
- **SKIP Steps 1-2** (plan is already loaded)
- **Use the embedded plan content directly** - it's the authoritative source
- **Parse the embedded plan** to find the FIRST suite with `- [ ] **Status:** in_progress` or `- [ ] **Status:** pending`
- **Go directly to Step 3** to mark the suite in progress and start implementing

The test loop embeds the plan content to give you fresh context each iteration. The plan file path will be mentioned in the "IMPORTANT INSTRUCTIONS" section at the end of the prompt - use that path when you need to update the plan file status.

---

## Step 0: Review Progress First (ALWAYS DO THIS)

**Before doing ANY work, check the `## Progress So Far` section in the prompt.**

This section contains a log of all previous iterations. Review it to understand:
- Which suites have already been completed
- Which suites failed or were blocked
- What work was done in previous iterations

**Do NOT repeat work that was already completed.** If a suite is marked as complete in the progress log, skip it and find the next pending suite.

---

## The Ralph Wiggum Pattern

This command follows the "iteration over perfection" philosophy:

- Work on **ONE suite per invocation**, then **STOP**
- Track progress via the plan file
- Stop hook automatically restarts with fresh context for next suite
- Stop conditions (completion, max iterations, cancellation) end the loop

**CRITICAL: Process ONE suite, then STOP. Do not continue to the next suite.**

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
# Check if beads (bd) task tracker is available
BEADS_AVAILABLE=false
if command -v bd &> /dev/null && [ -d ".beads" ]; then
    BEADS_AVAILABLE=true
    echo "Beads task tracker detected"
fi

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

## Step 2.5: Use Beads to Find Next Suite (When Available)

**When beads is available, use `bd ready` as the PRIMARY source for finding the next suite to work on.**

Beads provides dependency-aware task selection - it knows which tasks have no blockers and are ready to execute.

```bash
if [ "$BEADS_AVAILABLE" = true ]; then
    echo "=== Beads Task Status ==="

    # Check for ready tasks (no blockers)
    READY_TASKS=$(bd ready --json 2>/dev/null)
    READY_COUNT=$(echo "$READY_TASKS" | jq 'length' 2>/dev/null || echo "0")

    if [ "$READY_COUNT" -eq 0 ]; then
        # No ready tasks - check if all complete
        PENDING=$(bd list --status pending --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
        IN_PROGRESS=$(bd list --status in_progress --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")

        if [ "$PENDING" -eq 0 ] && [ "$IN_PROGRESS" -eq 0 ]; then
            echo "All beads tasks complete!"
            # Output completion marker
        else
            echo "Warning: Tasks exist but none are ready (may have blockers)"
            bd list --tree 2>/dev/null
        fi
    else
        # Get the first ready task
        NEXT_TASK=$(echo "$READY_TASKS" | jq -r '.[0]')
        NEXT_TASK_ID=$(echo "$NEXT_TASK" | jq -r '.id')
        NEXT_TASK_TITLE=$(echo "$NEXT_TASK" | jq -r '.title')

        echo "Next ready task: $NEXT_TASK_ID - $NEXT_TASK_TITLE"
        echo "Ready tasks: $READY_COUNT remaining"

        # Extract suite name from task title (format: "Suite: [Name]")
        NEXT_SUITE_NAME=$(echo "$NEXT_TASK_TITLE" | sed 's/^Suite: //')
        echo "Will work on suite: $NEXT_SUITE_NAME"
    fi

    # Show task tree for context
    echo ""
    echo "Task hierarchy:"
    bd list --tree 2>/dev/null | head -20
fi
```

**Benefits of using `bd ready`:**
- Respects task dependencies (if any were set)
- Provides accurate count of remaining work
- Hierarchical view shows overall progress
- Task IDs can be used to update status directly

**Fallback:** If beads is not available, use the plan file status markers as described in Step 2.

---

## Step 3: Mark Suite In Progress

Update the plan file (`$PLAN_FILE`) to mark the current suite:

- Change `- [ ] **Status:** pending` to `- [ ] **Status:** in_progress`

This tracks progress across iterations.

### 3.1 Update Beads Status (if available)

If beads is available, also update the beads task status:

```bash
if [ "$BEADS_AVAILABLE" = true ]; then
    # Find the beads task ID for this suite from the plan's Beads Integration section
    # The format in the plan is: "- Suite: [Name]: bd-xxxx"
    SUITE_NAME="[current suite name]"
    BEADS_TASK_ID=$(grep -A 20 "## Beads Integration" "$PLAN_FILE" | grep "$SUITE_NAME" | grep -oE 'bd-[a-z0-9.]+')

    if [ -n "$BEADS_TASK_ID" ]; then
        # Mark task as in-progress using beads
        bd update "$BEADS_TASK_ID" --status in_progress 2>/dev/null || true
        echo "Updated beads task $BEADS_TASK_ID to in_progress"
    fi
fi
```

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

**Before Writing Setup Code - Check for Existing Helpers:**

```bash
# Search for existing test utilities
grep -r "createTest" src/__tests__/ --include="*.ts"
grep -r "factory" src/__tests__/ --include="*.ts"
ls src/__tests__/test-utils* 2>/dev/null
ls src/__tests__/factories/ 2>/dev/null
```

If helpers exist, **use them**. If not, create them following the DRY patterns in section 4.5.

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

### 4.5 Test Data Management (Self-Correcting Tests)

**CRITICAL: Tests MUST be self-contained and create their own data. NEVER rely on pre-existing environment state.**

#### Principle: Tests Own Their Data

```typescript
// ❌ BAD - Relies on pre-existing data
it("should update user", async () => {
  const user = await getUser("existing-user-id"); // Fails if user doesn't exist!
  await updateUser(user.id, { name: "New Name" });
});

// ✅ GOOD - Creates its own data
it("should update user", async () => {
  // Arrange: Create the data this test needs
  const user = await createUser({ name: "Test User", email: "test@example.com" });

  // Act
  await updateUser(user.id, { name: "New Name" });

  // Assert
  const updated = await getUser(user.id);
  expect(updated.name).toBe("New Name");

  // Cleanup (optional but recommended)
  await deleteUser(user.id);
});
```

#### For Unit Tests: Use Mocks and Fixtures

```typescript
// Create test fixtures inline or in a shared file
const mockUser = {
  id: "test-123",
  name: "Test User",
  email: "test@example.com",
  createdAt: new Date("2024-01-01"),
};

it("should format user display name", () => {
  const result = formatDisplayName(mockUser);
  expect(result).toBe("Test User (test@example.com)");
});
```

#### For Integration/E2E Tests: Create Data via API

```typescript
describe("User management", () => {
  let testUser: User;

  beforeAll(async () => {
    // Create test data via API before tests run
    testUser = await api.createUser({
      name: "E2E Test User",
      email: `test-${Date.now()}@example.com`, // Unique email
    });
  });

  afterAll(async () => {
    // Clean up after tests
    if (testUser?.id) {
      await api.deleteUser(testUser.id);
    }
  });

  it("should display user profile", async () => {
    await page.goto(`/users/${testUser.id}`);
    await expect(page.locator(".user-name")).toHaveText(testUser.name);
  });
});
```

#### Self-Correcting Pattern for E2E

When tests fail due to missing data, **fix the test to create the data**, not the environment:

```typescript
// ✅ Self-correcting: Ensure data exists before testing
async function ensureTestWorkflowExists(): Promise<Workflow> {
  // Try to find existing test workflow
  const existing = await api.getWorkflows({ name: "E2E Test Workflow" });
  if (existing.length > 0) {
    return existing[0];
  }

  // Create if missing
  return await api.createWorkflow({
    name: "E2E Test Workflow",
    description: "Auto-created for E2E tests",
  });
}

describe("Workflow editor", () => {
  let workflow: Workflow;

  beforeAll(async () => {
    workflow = await ensureTestWorkflowExists();
  });

  it("should open workflow editor", async () => {
    await page.goto(`/workflows/${workflow.id}/edit`);
    // Test continues...
  });
});
```

#### DRY Principle: Create Factory Helpers

**When you write the same setup code twice, extract it into a factory helper.**

```typescript
// ❌ BAD - Duplicated setup across tests
describe("User tests", () => {
  it("should update user", async () => {
    const user = await api.createUser({
      name: "Test User",
      email: `test-${Date.now()}@example.com`,
      role: "member",
    });
    // test...
  });

  it("should delete user", async () => {
    const user = await api.createUser({
      name: "Test User",
      email: `test-${Date.now()}@example.com`,
      role: "member",
    });
    // test...
  });
});

// ✅ GOOD - Factory helper eliminates duplication
// Create this helper at the top of the test file or in a shared test-utils file
async function createTestUser(overrides: Partial<User> = {}): Promise<User> {
  return api.createUser({
    name: "Test User",
    email: `test-${Date.now()}@example.com`,
    role: "member",
    ...overrides,
  });
}

describe("User tests", () => {
  it("should update user", async () => {
    const user = await createTestUser();
    // test...
  });

  it("should delete user", async () => {
    const user = await createTestUser();
    // test...
  });

  it("should handle admin user", async () => {
    const admin = await createTestUser({ role: "admin" });
    // test...
  });
});
```

#### When to Create Factory Helpers

| Situation | Action |
|-----------|--------|
| Same setup in 2+ tests | Extract to factory function |
| Complex object creation | Create `createTest[Entity]()` helper |
| Multiple test files need same data | Move helper to shared `test-utils.ts` |
| Nested/related entities | Create composite factories |

#### Factory Helper Patterns

```typescript
// Basic factory with defaults and overrides
export async function createTestWorkflow(overrides: Partial<Workflow> = {}): Promise<Workflow> {
  return api.createWorkflow({
    name: `Test Workflow ${Date.now()}`,
    description: "Auto-created for tests",
    status: "draft",
    ...overrides,
  });
}

// Factory for related entities
export async function createTestWorkflowWithTrigger(): Promise<{ workflow: Workflow; trigger: Trigger }> {
  const workflow = await createTestWorkflow();
  const trigger = await api.createTrigger({
    workflowId: workflow.id,
    type: "manual",
  });
  return { workflow, trigger };
}

// Cleanup helper to pair with factory
export async function deleteTestWorkflow(workflow: Workflow): Promise<void> {
  if (workflow?.id) {
    await api.deleteWorkflow(workflow.id);
  }
}
```

#### Shared Test Utilities Location

When creating helpers used across multiple test files:

```
src/
├── __tests__/
│   ├── test-utils.ts          # Shared factories and helpers
│   ├── fixtures/              # Static test data
│   │   └── mock-responses.ts
│   └── setup.ts               # Global test setup
├── services/
│   └── auth/
│       └── __tests__/
│           └── auth.spec.ts   # Import from test-utils
```

```typescript
// src/__tests__/test-utils.ts
export { createTestUser, deleteTestUser } from "./factories/user";
export { createTestWorkflow, deleteTestWorkflow } from "./factories/workflow";
export { mockApiResponse, mockErrorResponse } from "./mocks/api";

// In test file
import { createTestUser, createTestWorkflow } from "@/__tests__/test-utils";
```

#### Data Isolation Best Practices

| Practice | Why |
|----------|-----|
| Use unique identifiers | `email: \`test-${Date.now()}@example.com\`` prevents collisions |
| Create in beforeAll/beforeEach | Data is ready before tests run |
| Clean up in afterAll/afterEach | Don't pollute environment for other tests |
| Use factory functions | `createTestUser()` makes tests readable and DRY |
| Never hardcode IDs | `user-123` might not exist in this environment |
| Extract after 2nd use | Don't pre-optimize, but refactor when duplication appears |

#### When Environment Data is Truly Required

If tests MUST use real environment data (rare), document it explicitly:

```typescript
/**
 * ENVIRONMENT REQUIREMENT: This test requires a "demo" workspace to exist.
 * If missing, create via: POST /api/workspaces { name: "demo" }
 */
it("should load demo workspace", async () => {
  // First, ensure the required data exists
  await ensureDemoWorkspaceExists();

  // Then run the actual test
  await page.goto("/workspaces/demo");
});
```

---

## Step 5: Verify Tests Pass (REQUIRED BEFORE PROGRESSING)

**ABSOLUTE RULE: You MUST run the tests and see them pass before marking complete.**

### What "Complete" Means

A suite is ONLY complete when:
- You have actually executed the test command
- The test runner reports ALL tests passing
- You see output confirming success (e.g., "Tests: X passed", "✓ all tests pass")

### What "Complete" Does NOT Mean

**NEVER mark a suite as complete based on:**
- "The code looks correct"
- "It follows existing patterns"
- "The syntax is valid"
- "Setup is difficult/slow"
- "It should work"
- "Other similar tests work"

**These are NOT valid reasons to skip verification.**

### Discover the Test Command

**Do NOT assume a standard test runner. Discover the correct command for this repo:**

```bash
# 1. Check package.json scripts for test commands
cat package.json | grep -A 20 '"scripts"'

# 2. Look for test configuration files
ls -la | grep -E "(vitest|jest|cypress|playwright|mocha)"

# 3. Check for workspace-specific test commands (monorepos)
cat package.json | grep -E "(workspaces|test:)"

# 4. Look at existing test files to understand patterns
find . -name "*.test.*" -o -name "*.spec.*" | head -5 | xargs head -10
```

**Use the repo's actual test command:**
- If `package.json` has `"test:unit"`, `"test:e2e"`, etc. - use those
- If it's a monorepo with workspaces - use the workspace-specific command
- Check README or CONTRIBUTING docs for test instructions

### Run Unit Tests

```bash
# Use the discovered command, examples:
npm run test:unit -- [test-file-path]
yarn test [test-file-path]
pnpm test:unit [test-file-path]
```

### Run Integration/E2E Tests

**Priority order: Documentation → Sandboxed → Local (last resort)**

#### 1. FIRST: Check Repository Documentation

**Before running ANY e2e tests, check the repo's documentation:**

```bash
# Check for documentation on running tests
cat README.md 2>/dev/null | grep -iA 20 -E "(e2e|end.to.end|integration|test)"
cat CONTRIBUTING.md 2>/dev/null | grep -iA 20 -E "(e2e|end.to.end|integration|test)"
cat docs/TESTING.md 2>/dev/null || cat docs/testing.md 2>/dev/null
ls docs/ 2>/dev/null | grep -iE "(test|e2e|development)"

# Check package.json scripts for e2e commands
cat package.json | grep -E "(e2e|integration|playwright|cypress)"
```

**If documentation exists, FOLLOW IT EXACTLY.**

The repo maintainers know best how their tests should run. Look for:
- Specific test commands (`npm run test:e2e`, `yarn e2e`, etc.)
- Required environment setup (env vars, services, ports)
- Docker/container instructions
- CI configuration that shows how tests run in automation

#### 2. PREFER: Sandboxed Environment (Docker, Containers)

**If docs mention Docker/containers, use that approach:**

```bash
# Look for existing sandbox/test environment configs
ls -la | grep -E "(docker-compose|Dockerfile)"
cat docker-compose*.yml 2>/dev/null | head -50
cat package.json | grep -E "(docker|sandbox|container)"
ls -la .github/workflows/ 2>/dev/null | xargs grep -l "e2e\|integration" 2>/dev/null
```

**Common sandboxed patterns:**

```bash
# Docker Compose based
docker-compose -f docker-compose.test.yml up -d
npm run test:e2e
docker-compose -f docker-compose.test.yml down -v

# Container-based test runner
npm run test:e2e:docker
yarn e2e:container

# Dev container
devcontainer up && devcontainer exec npm run test:e2e
```

**Why prefer sandboxed:**
- Isolated from local state/config
- Reproducible across machines
- Matches CI environment
- No side effects on local dev setup

#### 3. LAST RESORT: Local Execution

**Only run e2e tests locally if:**
- Documentation explicitly says to run locally
- No sandbox/container option exists
- User explicitly requests local execution

**If running locally:**

```bash
# Verify required services are running
# (Check docs for what's needed - DB, API server, etc.)

# Run with the documented command
npm run test:e2e
# or
yarn playwright test
# or
npx cypress run
```

#### 4. If No Documentation or Sandbox Exists

**Ask the user before proceeding:**

> "I couldn't find e2e test documentation or a sandboxed environment in this repo.
>
> Options:
> 1. **Check CI config** - Look at `.github/workflows/` for how tests run in CI
> 2. **Run locally** - Execute tests on your local machine (may have side effects)
> 3. **Skip e2e** - Mark as skipped, implement unit tests only
>
> Which approach should I use?"

**NEVER guess at e2e test setup. Always verify with docs or user.**

### If Setup is Required

If tests require special setup (Docker, database, environment):
1. Help the user set up the environment
2. Wait for setup to complete
3. Run the tests
4. Only mark complete after tests pass

**Do NOT skip verification because setup is "difficult" or "slow".**

### If Tests Fail

**Keep working until ALL tests pass. This is the completion criteria.**

#### CRITICAL: Isolate Failing Tests with .only()

**NEVER run the full test suite to debug a failing test. Use `.only()` to run ONLY the failing test.**

```javascript
// ✅ GOOD - Isolate the failing test with .only()
it.only('should handle network errors', () => { ... });
test.only('should handle network errors', async () => { ... });

// ❌ BAD - Running entire suite to debug one test
// This wastes minutes when you only need seconds
```

#### Fix Iteration Workflow

1. **Add `.only()` to the failing test** in the test file
2. **Run the test file** - only the marked test will execute
3. **Fix the issue** based on the error
4. **Re-run** to verify the fix (still isolated with `.only()`)
5. **Repeat steps 3-4** until the test passes
6. **Remove `.only()`** - verify with `git diff`
7. **Run full suite** to verify no regressions

#### Example Fix Cycle

```javascript
// 1. Add .only() to failing test
it.only('should reject invalid password', async () => {
  // test code...
});

// 2. Run the file - only this test runs
// $ npx vitest run src/auth.spec.ts
// ❌ FAIL - Error: expected 401 but got 200

// 3. Fix the code...

// 4. Re-run (still isolated)
// $ npx vitest run src/auth.spec.ts
// ✅ PASS

// 5. Remove .only() and verify
// $ git diff  # Make sure .only() is removed

// 6. Run full suite for regression check
// $ npx vitest run src/auth.spec.ts
// ✅ 12/12 tests passed
```

#### Framework .only() Syntax

| Framework | Isolate test | Isolate describe block |
|-----------|-------------|------------------------|
| Vitest | `it.only()` or `test.only()` | `describe.only()` |
| Jest | `it.only()` or `test.only()` | `describe.only()` |
| Mocha | `it.only()` | `describe.only()` |
| Playwright | `test.only()` | `test.describe.only()` |
| Cypress | `it.only()` | `describe.only()` |

#### Why .only() (Preferred over CLI flags)

- **Faster iteration** - no need to type exact test name strings
- **Works universally** - same syntax across most frameworks
- **Visual indicator** - clear in code what's being debugged
- **Full context** - framework hooks (beforeEach, etc.) still run
- **Just remember to remove it!** - check `git diff` before committing

**Alternative: CLI flags** (use when .only() isn't convenient):
```bash
npx vitest run -t "test name"
npx jest -t "test name"
npx playwright test -g "test name"
```

#### Fixing Data-Related Failures (Self-Correcting)

**If a test fails because expected data doesn't exist, FIX THE TEST to create the data - don't ask the user to fix the environment.**

Common data-related errors and how to fix them:

| Error Pattern | Problem | Fix |
|---------------|---------|-----|
| `Cannot read property of undefined` | Data doesn't exist | Add setup to create the data |
| `404 Not Found` | Resource missing | Create resource in beforeAll |
| `Expected 1 but got 0` | Query returns empty | Seed test data before asserting |
| `User not found` | Hardcoded ID doesn't exist | Generate user dynamically |

**Example: Fixing a data-dependent test**

```typescript
// ❌ BEFORE: Test fails because workflow doesn't exist
it("should edit workflow", async () => {
  await page.goto("/workflows/test-workflow/edit"); // 404!
});

// ✅ AFTER: Test creates its own data
it("should edit workflow", async () => {
  // Create the workflow this test needs
  const workflow = await api.createWorkflow({
    name: `test-workflow-${Date.now()}`,
    description: "Created for E2E test",
  });

  await page.goto(`/workflows/${workflow.id}/edit`);
  // ... test continues ...

  // Cleanup
  await api.deleteWorkflow(workflow.id);
});
```

**When you encounter a data error:**
1. **Don't mark as blocked** - this is fixable
2. **Add setup code** to create required data in beforeAll/beforeEach
3. **Use unique identifiers** to avoid collisions with other tests
4. **Add cleanup** in afterAll/afterEach to keep environment clean
5. **Re-run the test** to verify the fix

### E2E Test Debugging (Cypress/Playwright)

When e2e tests fail in headless mode, you MUST gather full context before attempting fixes.

#### Isolating Failing Tests with .only()

**CRITICAL: Debug ONE test at a time using .only() syntax for faster iteration**

When a test fails, isolate it before attempting fixes:

**Cypress/Mocha/Jest:**
```javascript
// Change this:
it('should load dashboard', () => { ... });

// To this:
it.only('should load dashboard', () => { ... });

// For describe blocks:
describe.only('Dashboard', () => { ... });
```

**Playwright:**
```javascript
// Change this:
test('should load dashboard', async () => { ... });

// To this:
test.only('should load dashboard', async () => { ... });
```

**Vitest:**
```javascript
it.only('should load dashboard', () => { ... });
// or
test.only('should load dashboard', () => { ... });
```

**Why .only()?**
- Runs ONLY the failing test (fast iteration - seconds, not minutes)
- Full framework context preserved
- Works when CLI flags don't match test names exactly
- Clear visual indicator in code of what's being debugged

**REMEMBER:** Remove .only() after fixing! Run `git diff` to verify before committing.

#### Reading Screenshots for Context

When e2e tests fail, ALWAYS read the screenshot file to understand the visual state:

1. **Find screenshot path** in test output (e.g., `cypress/screenshots/spec-name/test-name.png`)
2. **Read the screenshot** using the Read tool to view it
3. **Analyze what you see:**
   - Is the expected element visible?
   - Are there error modals/toasts blocking interaction?
   - Is the page in an unexpected state (login page, error page)?
   - Are there loading spinners still present?

**Common visual clues:**

| What You See | Likely Problem |
|--------------|----------------|
| Login page | Auth token expired/missing |
| Error modal/toast | API error, validation error |
| Loading spinner | Network timeout, slow API |
| Empty page | Component render error (check console) |
| Wrong page | Navigation failed, routing issue |

#### Capturing Browser Console and Network Logs

**Cypress: cypress-terminal-report (Recommended)**

If not already installed, recommend adding for console/network capture:
```bash
npm install --save-dev cypress-terminal-report
```

Configure in cypress.config.js:
```javascript
const { installLogsPrinter } = require('cypress-terminal-report/src');

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      installLogsPrinter(on, {
        outputRoot: 'cypress/logs',
        outputTarget: {
          'cypress/logs/out.json': 'json'  // Machine-readable
        }
      });
    }
  }
});
```

After test failure, read the log file:
```bash
cat cypress/logs/out.json
```

**Playwright: Use trace files**

Run with trace enabled:
```bash
npx playwright test --trace on
```

Check test-results/ folder for trace.zip files.

#### Error Categories and Fix Strategies

| Error Pattern | Category | Fix Strategy |
|---------------|----------|--------------|
| `cy.get() timed out waiting` | Selector | Read screenshot, update selector or add wait |
| `Timed out retrying: expected` | Assertion | Check expected value, verify test data |
| `Request failed: 401` | Auth | Check auth token, login state |
| `Request failed: 404` | Endpoint | Verify URL, check if resource exists |
| `Request failed: 500` | Server | Mark BLOCKED - backend issue |
| `net::ERR_CONNECTION_REFUSED` | Server Down | Mark BLOCKED - server not running |
| `CORS policy` | Config | Check API CORS config |
| `Cannot read property of undefined` | Data | Add setup to create test data |
| `Element is detached from DOM` | Timing | Add wait for stability |
| `Element is not visible` | UI State | Read screenshot, check for overlays |

#### E2E Failure Debugging Workflow

**CRITICAL: Before attempting ANY fix, follow this workflow:**

1. **Isolate the test** - Add `.only()` to the failing test
2. **Read the FULL error** - Not just the first line
3. **Read the screenshot** - Visual state is crucial context
4. **Check for log files** - `cypress/logs/` or `test-results/`
5. **Categorize the error** - Use table above
6. **Apply fix strategy** - Based on category
7. **Run isolated test** - Verify fix works
8. **Remove .only()** - Check with `git diff`
9. **Run full suite** - Verify no regressions

**For Network/API Failures:**
```bash
# Check if server is running
curl -I http://localhost:3000/api/health

# Look for response details in logs
cat cypress/logs/out.json | grep -A 5 "status"
```

**For Selector Failures:**
1. Read screenshot to see actual DOM state
2. Check if element exists with different selector
3. Verify page navigation completed

**For Timing Failures:**
1. Look for loading states in screenshot
2. Add explicit wait for network request:
```javascript
cy.intercept('GET', '/api/data').as('getData');
cy.wait('@getData');
```

#### Live Browser Debugging with Playwright MCP

If the Playwright MCP server is available, use it for **real-time browser debugging** when static screenshots aren't enough:

**When to use Playwright MCP:**
- Screenshot doesn't show the problem clearly
- Need to inspect dynamic state (hover menus, animations)
- Want to see network requests in real-time
- Need to manually reproduce the issue step-by-step

**Debugging workflow with Playwright MCP:**

1. **Navigate to the failing page:**
```
browser_navigate to the URL where test fails
```

2. **Take an accessibility snapshot** (better than screenshot for understanding DOM):
```
browser_snapshot
```

3. **Check browser console for errors:**
```
browser_console_messages (with onlyErrors: true for just errors)
```

4. **Review network requests:**
```
browser_network_requests
```

5. **Interact to reproduce the issue:**
```
browser_click, browser_type, browser_hover
```

**Available Playwright MCP tools:**

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Go to a URL |
| `browser_snapshot` | Get accessibility tree (DOM state) |
| `browser_take_screenshot` | Capture current visual state |
| `browser_console_messages` | Get console.log/error output |
| `browser_network_requests` | See all network calls |
| `browser_click` | Click elements |
| `browser_type` | Type into inputs |
| `browser_hover` | Hover over elements |
| `browser_wait_for` | Wait for text/element |

**Example: Debugging a selector failure**
```
1. browser_navigate to "http://localhost:3000/dashboard"
2. browser_snapshot to see the actual DOM structure
3. Find the correct selector from the snapshot
4. Update test with correct selector
```

**Example: Debugging a network failure**
```
1. browser_navigate to the page
2. browser_network_requests to see all API calls
3. Look for failed requests (4xx/5xx status)
4. Check request/response details
5. Fix test setup or mark as BLOCKED if server issue
```

### Completion Criteria (MUST be met before marking suite complete)

A suite is ONLY complete when **ALL of these are true**:

- [ ] All test cases in the suite have been implemented
- [ ] The test command has been executed
- [ ] **ALL tests pass** (0 failures, 0 errors)
- [ ] Test output confirms success (e.g., "Tests: X passed", "✓ all tests pass")

**You MUST NOT mark a suite as complete if ANY test is failing.**

### If Stuck After Many Attempts

If you've made significant effort (5+ fix attempts) and tests still fail:

- Do NOT mark the suite as complete
- Mark the suite as `blocked`
- Ask the user for help:

> "I've been working on this suite but tests are still failing.
>
> **Error:** [last error message]
> **File:** [test file path]
> **Attempts:** [N] fix attempts made
>
> Options:
> 1. Keep trying - I'll continue working on it
> 2. Skip this suite and continue (mark as `skipped`)
> 3. I'll fix it manually - continue after I'm done
> 4. Cancel the test loop"

**The ONLY path to `complete` is seeing ALL tests pass.**

---

## Step 6: Update Plan Status (REQUIRED)

**You MUST update the plan file status. This is how progress is tracked across iterations.**

### If ALL Tests Pass:

Update the plan file (path from IMPORTANT INSTRUCTIONS):

- Change `- [ ] **Status:** in_progress` to `- [x] **Status:** complete`
- Check off completed test cases
- **This is the ONLY way to mark a suite as complete**

### If Tests Fail After 5 Attempts:

Update the plan file:

- Change `- [ ] **Status:** in_progress` to `- [ ] **Status:** blocked`
- Add note: `**Blocked:** [error summary]`
- Wait for user input before continuing

### If User Chooses to Skip:

Update the plan file:

- Change status to `- [x] **Status:** skipped`
- Add note: `**Skipped:** User chose to skip after [N] failed attempts`

### Update Beads Status (if available)

After updating the plan file status, also update beads if available:

```bash
if [ "$BEADS_AVAILABLE" = true ]; then
    # Find the beads task ID for this suite
    SUITE_NAME="[current suite name]"
    BEADS_TASK_ID=$(grep -A 20 "## Beads Integration" "$PLAN_FILE" | grep "$SUITE_NAME" | grep -oE 'bd-[a-z0-9.]+')

    if [ -n "$BEADS_TASK_ID" ]; then
        case "$STATUS" in
            complete)
                bd complete "$BEADS_TASK_ID" 2>/dev/null || true
                echo "Marked beads task $BEADS_TASK_ID as complete"
                ;;
            blocked)
                bd update "$BEADS_TASK_ID" --status blocked 2>/dev/null || true
                echo "Marked beads task $BEADS_TASK_ID as blocked"
                ;;
            skipped)
                bd update "$BEADS_TASK_ID" --status skipped 2>/dev/null || true
                echo "Marked beads task $BEADS_TASK_ID as skipped"
                ;;
        esac
    fi
fi
```

**Beads benefits during test execution:**
- `bd ready` shows which suites are ready to work on (no blockers)
- `bd list --tree` shows hierarchical progress of the test plan
- Task history preserved across iterations for context

---

## Step 7: Write Progress File (REQUIRED)

**You MUST append to the progress file. This is critical for loop tracking.**

Append to `.claude/progress.txt` using this format:

```markdown
---
## Iteration [N] - [Suite Name]
- Status: [complete/blocked/in_progress]
- Tests: [X passing / Y total]
- Summary: [brief description of work done]
- Files modified: [list test files created/modified]
---
```

**Use append mode - do NOT overwrite the file:**
```bash
cat >> .claude/progress.txt << 'EOF'
---
## Iteration N - Suite Name
- Status: complete
- Tests: 5 passing / 5 total
- Summary: Implemented authentication tests
- Files modified: src/__tests__/auth.spec.ts
---
EOF
```

---

## Step 8: Output Completion Marker and STOP

Output the appropriate completion marker, then **STOP immediately**:

**If this suite is done (but more remain):**
```
Suite "[name]" complete. [X] tests passing.

Progress: [completed]/[total] suites
Remaining: [list remaining suite names]

<promise>ITERATION_COMPLETE</promise>
```

**If ALL suites are done:**
```
All test suites complete!

Final Results:
- Completed: [N] suites
- Blocked: [N] suites
- Skipped: [N] suites

<promise>ALL_SUITES_COMPLETE</promise>
```

**After outputting the marker, STOP. Do not continue to the next suite.**

---

## Step 9: STOP (Let the Loop Continue)

**CRITICAL: After completing ONE suite, you MUST stop.**

Do NOT:
- Continue to the next suite
- Ask "should I continue?"
- Start working on another suite

Simply output your progress report and stop. The stop hook will automatically:
1. Detect you've finished
2. Increment the iteration counter
3. Re-invoke with a fresh context for the next suite

This "one suite per iteration" pattern ensures:
- Fresh context for each suite (no accumulated confusion)
- Clear progress tracking
- Ability to cancel between suites
- Isolation of failures

Use `/clive cancel` to stop the loop early if needed.

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

### Completion Over Speed

**Tests MUST pass before moving on. No exceptions.**

The goal is working, passing tests - not fast iteration through failing suites. A suite marked "complete" with failing tests is worse than a suite still in progress.

Key principles:
- **Keep working until tests pass** - persistence over perfection
- **Fix issues as you find them** - don't accumulate failures
- **Only mark complete when ALL tests pass** - this is non-negotiable
- **Ask for help if truly stuck** - but exhaust your options first

### E2E Best Practices: Efficiency First

**Goal: Minimize page loads, maximize assertions per load.**

#### 1. Bundle Assertions Within Single Page Loads

```typescript
// ❌ BAD - Multiple page loads for related assertions
test('button is visible', async () => {
  await page.goto('/dashboard');
  expect(await page.locator('.submit-btn').isVisible()).toBe(true);
});

test('button has correct text', async () => {
  await page.goto('/dashboard');  // Unnecessary reload!
  expect(await page.locator('.submit-btn').textContent()).toBe('Submit');
});

// ✅ GOOD - Single load, multiple assertions
test('submit button renders correctly', async () => {
  await page.goto('/dashboard');
  const button = page.locator('.submit-btn');
  expect(await button.isVisible()).toBe(true);
  expect(await button.textContent()).toBe('Submit');
  expect(await button.isEnabled()).toBe(true);
});
```

#### 2. Use Test Flows, Not Isolated Scenarios

```typescript
// ❌ BAD - Separate tests with repeated setup
test('user can fill form', async () => {
  await page.goto('/signup');
  await page.fill('#email', 'test@example.com');
  // ...
});

test('user can submit form', async () => {
  await page.goto('/signup');  // Reload!
  await page.fill('#email', 'test@example.com');  // Repeat!
  await page.click('#submit');
  // ...
});

// ✅ GOOD - Single flow covering the journey
test('user signup flow', async () => {
  await page.goto('/signup');

  // Fill form
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'secure123');
  expect(await page.locator('#submit').isEnabled()).toBe(true);

  // Submit and verify
  await page.click('#submit');
  await expect(page).toHaveURL('/welcome');
  expect(await page.locator('.welcome-msg').isVisible()).toBe(true);
});
```

#### 3. Only Reload When State MUST Be Reset

**Reload when:**
- Testing fresh/unauthenticated state
- Previous test corrupted necessary state
- Testing page load behavior specifically

**Don't reload when:**
- Assertions can be made on current page state
- Navigation within app achieves the same result
- Testing sequential user interactions

#### 4. Leverage beforeAll Over beforeEach

```typescript
// ❌ BAD - Login before every test
beforeEach(async () => {
  await page.goto('/login');
  await login(page);  // Slow!
});

// ✅ GOOD - Login once, reuse session
beforeAll(async () => {
  await page.goto('/login');
  await login(page);
  await page.context().storageState({ path: 'auth.json' });
});

// Or use storage state directly
test.use({ storageState: 'auth.json' });
```

#### 5. Parallelize Independent Tests

```typescript
// ✅ GOOD - Independent tests can run in parallel
test.describe.parallel('dashboard widgets', () => {
  test('chart widget loads', async () => { /* ... */ });
  test('stats widget loads', async () => { /* ... */ });
  test('activity widget loads', async () => { /* ... */ });
});
```

#### 6. Use API Shortcuts for Setup

```typescript
// ❌ BAD - UI-based setup
test('edit existing item', async () => {
  await page.goto('/items/new');
  await page.fill('#name', 'Test Item');
  await page.click('#save');
  await page.click('.edit-btn');
  // Now test editing...
});

// ✅ GOOD - API setup, UI testing
test('edit existing item', async () => {
  // Create via API (fast)
  const item = await api.createItem({ name: 'Test Item' });

  // Test UI directly
  await page.goto(`/items/${item.id}/edit`);
  // Now test editing...
});
```

#### 7. Wait for Network Requests, Not Arbitrary Timeouts

**NEVER use artificial waits. Wait for the actual network request that triggers the UI.**

```typescript
// ❌ BAD - Arbitrary timeout (flaky, slow)
test('loads user data', async () => {
  await page.goto('/dashboard');
  await page.waitForTimeout(3000);  // Hope the API finished...
  expect(await page.locator('.user-name').textContent()).toBe('John');
});

// ❌ BAD - Sleep/delay
test('submits form', async () => {
  await page.click('#submit');
  await new Promise(r => setTimeout(r, 2000));  // Arbitrary wait
  expect(await page.locator('.success')).toBeVisible();
});

// ✅ GOOD - Wait for specific network request
test('loads user data', async () => {
  const responsePromise = page.waitForResponse(
    resp => resp.url().includes('/api/user') && resp.status() === 200
  );
  await page.goto('/dashboard');
  await responsePromise;  // Wait for actual API call
  expect(await page.locator('.user-name').textContent()).toBe('John');
});

// ✅ GOOD - Wait for request to complete before asserting
test('submits form', async () => {
  const responsePromise = page.waitForResponse('/api/submit');
  await page.click('#submit');
  await responsePromise;  // Wait for POST to complete
  await expect(page.locator('.success')).toBeVisible();
});

// ✅ GOOD - Wait for network idle (all requests settled)
test('page fully loaded', async () => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  // Now safe to assert - all initial requests complete
});
```

**Why network waits are better:**
- **Deterministic** - waits for actual event, not guessed duration
- **Fast** - proceeds immediately when ready, no wasted time
- **Reliable** - works regardless of network speed or server load
- **Debuggable** - clear what the test is waiting for

**Common patterns:**
- `page.waitForResponse(url)` - wait for specific API call
- `page.waitForRequest(url)` - wait for request to be sent
- `page.goto(url, { waitUntil: 'networkidle' })` - wait for all requests
- `page.waitForLoadState('networkidle')` - wait after navigation
- `page.waitForSelector('.element')` - wait for DOM element (often triggered by API)

#### 8. Assertion Efficiency Rules

- **Group related assertions** - one describe block, one page load
- **Assert early, assert often** - catch failures before expensive operations
- **Use soft assertions** when multiple checks should run regardless of earlier failures
- **Trust framework auto-waiting** - most assertions auto-retry until timeout

```typescript
// ✅ Soft assertions - all run even if one fails
await expect.soft(page.locator('.header')).toBeVisible();
await expect.soft(page.locator('.nav')).toBeVisible();
await expect.soft(page.locator('.footer')).toBeVisible();
```

#### Summary: E2E Efficiency Checklist

- [ ] Each test file minimizes total page loads
- [ ] Related assertions grouped in single tests
- [ ] beforeAll used instead of beforeEach where possible
- [ ] API/direct setup used instead of UI setup
- [ ] No unnecessary navigation between assertions
- [ ] Independent tests marked for parallel execution
- [ ] Auth state reused via storage state
- [ ] **No artificial waits** - wait for network requests, not timeouts
- [ ] Use `waitForResponse()` for API-dependent assertions
- [ ] **Isolate failures with CLI flags** (`-t`, `-g`, `--grep`) - don't run full suite to debug one test
