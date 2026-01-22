---
name: e2e-tests
description: Implement end-to-end tests with browser automation
category: test
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__create_comment
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# E2E Tests Skill

You implement end-to-end tests **ONE TASK AT A TIME**. E2E tests verify the full application flow from a user's perspective using browser automation.

**Pattern:** Read context -> Find task details -> Implement -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **MARK IN PROGRESS IMMEDIATELY** - Update tracker status to "In Progress" before writing tests.
3. **ONE TASK ONLY** - Implement ONE test scenario, then STOP.
4. **MARK DONE AT COMPLETION** - Update tracker status to "Done" after tests pass.
5. **BOTH STATUS TRANSITIONS REQUIRED** - Must call status update at START and at COMPLETION.

---

## E2E Test Characteristics

- Tests full user workflows through the browser
- Uses Playwright, Cypress, or similar automation tools
- Requires application to be running
- Captures screenshots/videos on failure for debugging
- Tests real user interactions (clicks, typing, navigation)

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
Get test scenarios and user flows from the plan.

### 0.3 Verify E2E Setup
```bash
# Check for Playwright
grep "playwright" package.json

# Check for Cypress
grep "cypress" package.json

# Ensure app can be started
npm run dev --help || npm run start --help
```

---

## Step 1: Mark Task In Progress (REQUIRED - DO NOT SKIP)

**You MUST update the tracker status before starting work. This is NON-NEGOTIABLE.**

**For Beads:**
```bash
bd update [TASK_ID] --status in_progress
```

**For Linear:**
Call `mcp__linear__update_issue` with these EXACT parameters:
- `id`: The task ID (from environment $TASK_ID or passed in prompt)
- `state`: "In Progress"
- `assignee`: "me"

**Verify the call succeeded before proceeding to implementation.**

---

## Step 2: Implement E2E Tests

### Playwright Example

```typescript
import { test, expect } from "@playwright/test";

test.describe("User Login Flow", () => {
  test("should login with valid credentials", async ({ page }) => {
    await page.goto("/login");

    await page.fill('[name="email"]', "test@example.com");
    await page.fill('[name="password"]', "password123");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL("/dashboard");
    await expect(page.locator("h1")).toContainText("Welcome");
  });

  test("should show error for invalid credentials", async ({ page }) => {
    await page.goto("/login");

    await page.fill('[name="email"]', "wrong@example.com");
    await page.fill('[name="password"]', "wrongpassword");
    await page.click('button[type="submit"]');

    await expect(page.locator(".error")).toBeVisible();
    await expect(page.locator(".error")).toContainText("Invalid credentials");
  });
});
```

### Cypress Example

```typescript
describe("User Login Flow", () => {
  it("should login with valid credentials", () => {
    cy.visit("/login");

    cy.get('[name="email"]').type("test@example.com");
    cy.get('[name="password"]').type("password123");
    cy.get('button[type="submit"]').click();

    cy.url().should("include", "/dashboard");
    cy.get("h1").should("contain", "Welcome");
  });
});
```

### Quality Rules

- **Use realistic user flows** - test what users actually do
- **Use stable selectors** - prefer data-testid, role, or text over CSS classes
- **Handle async** - wait for elements, not arbitrary timeouts
- **Isolate tests** - each test should work independently

---

## Step 3: Verify Tests Pass

```bash
# Playwright
npx playwright test [test-file]

# Cypress
npx cypress run --spec [test-file]
```

### If Tests Fail

1. **Check screenshots/videos** in test output
2. **Check console errors** in browser dev tools capture
3. **Run in headed mode** to see what's happening:
   ```bash
   npx playwright test --headed
   npx cypress open
   ```
4. **Verify app is running** before tests

---

## Discovered Work Protocol

**During implementation, you may discover work outside the current task's scope:**

- UI bugs visible during testing
- Missing API endpoints
- Accessibility issues
- Performance problems
- Documentation gaps

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

1. Verify all E2E tests pass
2. Confirm tests cover the specified user flow
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
git commit -m "test: [brief description of e2e tests added]

Task: [TASK_ID or task name]
Skill: e2e-tests"
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
- [E2E test approach]
- [Page objects/selectors used]

### Files Modified
- [Test files created/modified]

### Notes for Next Agent
- [Test data setup]
- [Page object patterns]
- [Flaky areas to watch]

SCRATCHPAD
```

---

## Step 5: Output Completion Marker

**Final checklist before outputting marker:**

- [ ] All E2E tests passing
- [ ] Tracker status updated to "Done" (mcp__linear__update_issue or bd close called successfully)
- [ ] Git commit created
- [ ] Scratchpad updated

```
Task "[name]" complete. E2E tests passing.
<promise>TASK_COMPLETE</promise>
```

**STOP IMMEDIATELY after outputting the marker.**
