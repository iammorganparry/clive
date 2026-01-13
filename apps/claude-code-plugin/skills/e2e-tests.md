---
name: e2e-tests
description: Implement end-to-end tests with browser automation
category: test
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# E2E Tests Skill

You implement end-to-end tests **ONE TASK AT A TIME**. E2E tests verify the full application flow from a user's perspective using browser automation.

**Pattern:** Read context -> Find task details -> Implement -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **BEADS FIRST** - Use `bd ready` to find work, `bd close` to complete.
2. **ONE TASK ONLY** - Implement ONE test scenario, then STOP.
3. **MUST UPDATE STATUS** - Update beads AND plan file after completion.

---

## E2E Test Characteristics

- Tests full user workflows through the browser
- Uses Playwright, Cypress, or similar automation tools
- Requires application to be running
- Captures screenshots/videos on failure for debugging
- Tests real user interactions (clicks, typing, navigation)

---

## Step 0: Read Your Context

### 0.1 Check Beads First
```bash
if [ -d ".beads" ]; then
    bd ready
fi
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

## Step 1: Mark Task In Progress

```bash
bd update [TASK_ID] --status in_progress
```

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
git commit -m "test: [brief description of e2e tests added]

Task: [TASK_ID or task name]
Skill: e2e-tests"
```

**Note:** Local commits only - do NOT push. Push at session end or user request.

---

## Step 5: Output Completion Marker

```
Task "[name]" complete. E2E tests passing.
<promise>TASK_COMPLETE</promise>
```

**STOP IMMEDIATELY after outputting the marker.**
