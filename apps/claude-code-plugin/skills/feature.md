---
name: feature
description: Implement new features according to specifications
category: feature
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__create_comment
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Feature Implementation Skill

You implement features **ONE TASK AT A TIME** following a 4-phase workflow:

**Context & Discovery → Implementation → Testing → Review → STOP**

## CRITICAL RULES (NON-NEGOTIABLE)

1. **FOLLOW THE 4 PHASES** - Do not skip phases or reorder them
2. **MARK IN PROGRESS IMMEDIATELY** - Update tracker status before implementation (Phase 1)
3. **ONE TASK ONLY** - Implement one feature, then STOP
4. **TESTING IS MANDATORY** - Phase 3 requires writing new tests for the feature
5. **REVIEW BEFORE COMPLETION** - Phase 4 checks for duplication and quality issues
6. **MARK DONE AT COMPLETION** - Update tracker status after all phases complete (Phase 4)

---

## Phase 1: Context & Discovery

**Goal:** Understand the task context, existing codebase, and design patterns before making changes.

### 1.1 Verify Task Information

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

**If you cannot determine your task:**
- Output: `ERROR: Unable to determine task. Please check build configuration.`
- STOP - do not proceed without a valid task

### 1.2 Read Previous Work Context

**Read the scratchpad:**
- The prompt above contains scratchpad notes from previous iterations
- Understand what's been completed and what patterns were established
- Check `.claude/epics/{epic-id}/progress.txt` for build history

**Detect tracker:**
```bash
# Read tracker preference
TRACKER=$(cat ~/.clive/config.json 2>/dev/null | jq -r '.issue_tracker // "beads"')
echo "Using tracker: $TRACKER"

if [ "$TRACKER" = "beads" ] && [ -d ".beads" ]; then
    bd ready
fi
```

### 1.3 Understand Existing Architecture

**Before writing new code, understand the codebase:**
- Read similar existing implementations
- Note coding conventions and patterns used
- Find related types, interfaces, utilities
- Understand how this feature fits into the existing architecture
- Identify the files you'll need to modify

**Example exploration:**
```bash
# Find similar implementations
grep -rn "similar-pattern" --include="*.ts" src/

# Read related files
cat src/path/to/similar-feature.ts
```

### 1.4 Mark Task In Progress (REQUIRED - DO NOT SKIP)

**You MUST update the tracker status before starting implementation. This is NON-NEGOTIABLE.**

**For Beads:**
```bash
bd update [TASK_ID] --status in_progress
```

**For Linear:**
Call `mcp__linear__update_issue` with:
- `id`: The task ID
- `state`: "In Progress"
- `assignee`: "me"

**Verify the call succeeded before proceeding to implementation.**

**Output:** Clear understanding of what needs to be done and how it fits into the existing codebase.

---

## Phase 2: Implementation

**Goal:** Build the solution following established patterns.

### 2.1 Start with Types/Interfaces

If the feature needs new types, define them first:

```typescript
// Define the shape of your feature's data
interface UserSettings {
  theme: 'light' | 'dark';
  notifications: boolean;
}
```

### 2.2 Implement Core Logic

Build the feature incrementally:
1. Core function/component
2. Integration with existing code
3. Exports and public API

### 2.3 Follow Project Patterns

- Match existing code style
- Use established patterns (dependency injection, error handling, etc.)
- Follow naming conventions
- Use existing utilities rather than creating new ones

### 2.4 Quality Rules

- **NO over-engineering** - implement what's needed, nothing more
- **NO dead code** - every line should serve a purpose
- **Proper exports** - ensure new code is accessible where needed
- **Type safety** - use proper TypeScript types (no `any`)

### 2.5 Discovered Work Protocol

**If you discover work outside the current task's scope:**
- Bugs in existing code
- Missing tests
- Code that needs refactoring
- Documentation gaps
- Technical debt

**DO NOT do this work inline.** Instead:

**For Beads:**
```bash
bd create --title="[Brief description]" \
  --type=task \
  --priority=2 \
  --labels "skill:[appropriate-skill],category:[category],discovered:true"
```

**For Linear:**
Call `mcp__linear__create_issue` with:
- `title`: Brief description
- `labels`: `["skill:[skill]", "category:[category]", "discovered:true"]`
- `parentId`: The current parent issue ID

Then continue with your current task - do not switch focus.

**Output:** Working implementation that follows project standards.

---

## Phase 3: Testing

**Goal:** Build confidence in the implementation through meaningful tests.

### 3.1 Identify What Needs Testing

**DO test:**
- Business logic that makes decisions
- Error handling and edge cases
- Data transformations
- API integrations
- User-facing functionality
- State management

**DON'T test:**
- Trivial getters/setters
- Pass-through functions with no logic
- Third-party library behavior
- Framework internals

### 3.2 Write Confidence-Building Tests

**For this feature:**
- Tests that verify the feature works as intended
- Tests that cover error cases and edge conditions
- Tests that would fail if the feature breaks

**Testing Philosophy:**
- Test **outcomes** (what), not **implementation** (how)
- Tests should fail if the feature breaks
- Tests should pass if implementation changes but behavior doesn't
- Avoid testing implementation details (internal state, private methods)

**Good test (tests behavior):**
```typescript
it("should calculate order total including tax", () => {
  const order = { items: [{ price: 100 }], taxRate: 0.1 };
  const total = calculateTotal(order);
  expect(total).toBe(110);
});
```

**Bad test (tests implementation):**
```typescript
it("should call calculateSubtotal and calculateTax", () => {
  const calculateSubtotalSpy = jest.spyOn(utils, "calculateSubtotal");
  calculateTotal(order);
  expect(calculateSubtotalSpy).toHaveBeenCalled();
});
```

The first test verifies the outcome. The second test would break if we refactored the internal implementation.

### 3.3 Run All Tests

```bash
# Run tests
npm test

# Build check
npm run build
# or: npm run typecheck, tsc --noEmit
```

**All tests must pass before proceeding to Phase 4.**

**Output:** Test suite that provides confidence the implementation is correct.

---

## Phase 4: Review

**Goal:** Ensure code quality and identify improvement opportunities.

### 4.1 Check for Code Duplication

**Process:**
1. Look at the code you just wrote
2. Search for similar patterns in the codebase:
   ```bash
   grep -rn "similar-pattern" --include="*.ts" src/
   ```
3. If you find 3+ instances of similar code, create a discovered work task

**For Beads:**
```bash
bd create --title="Refactor: Extract common [pattern] logic" \
  --type=task \
  --priority=2 \
  --labels "skill:refactor,category:refactor,discovered:true"
```

**For Linear:**
```
mcp__linear__create_issue
  title: "Refactor: Extract common [pattern] logic"
  labels: ["skill:refactor", "category:refactor", "discovered:true"]
  parentId: [current parent issue ID]
```

**Do NOT fix duplication inline** - This is out of scope for the current task.

### 4.2 Identify Refactoring Opportunities

**Common patterns to flag:**
- Functions longer than 50 lines
- More than 5 parameters
- Deeply nested conditionals (3+ levels)
- Unclear variable names
- Complex boolean conditions
- God classes/functions doing too much

**Process:**
1. Note the refactoring opportunity
2. Create a discovered work task (using same commands as 4.1)
3. Continue with current task completion

### 4.3 Verify Quality Standards

```bash
# TypeScript check
tsc --noEmit  # Must pass with ZERO errors

# Linting
npm run lint  # Must pass with ZERO warnings

# Build
npm run build  # Must succeed
```

**Quality checklist:**
- [ ] No `any` types introduced
- [ ] No unnarrowed `unknown` types
- [ ] All tests pass
- [ ] Build succeeds
- [ ] Lint passes with zero warnings

### 4.4 Complete the Task (REQUIRED - DO NOT SKIP)

**Before outputting TASK_COMPLETE marker, you MUST:**

1. Verify all acceptance criteria are met
2. Confirm build/tests pass
3. **Update tracker status to "Done"**

**For Beads:**
```bash
bd close [TASK_ID]
```

**For Linear:**

1. **First, add a completion comment:**
   Call `mcp__linear__create_comment` with:
   - `issueId`: The current task ID
   - `body`: A summary including:
     - What was implemented
     - Files changed
     - Developer notes, gotchas, or important decisions
     - Testing approach

   Example comment:
   ```
   ✅ Completed: [Brief summary]

   Changes:
   - Implemented X in file Y
   - Updated Z to handle edge case A

   Developer Notes:
   - Used pattern X because Y
   - Future consideration: Z

   Testing: All tests pass, added N new tests
   ```

2. **Then, mark the task Done:**
   Call `mcp__linear__update_issue` with:
   - `id`: The current task ID
   - `state`: "Done"

**If either call fails, DO NOT mark the task complete. Debug the issue first.**

### 4.5 Commit Changes (REQUIRED)

```bash
git add -A
git commit -m "feat: [brief description of feature implemented]

Task: [TASK_ID or task name]
Skill: feature"
```

**Note:** Local commits only - do NOT push.

### 4.6 Update Scratchpad (REQUIRED)

```bash
cat >> [scratchpad-file] << 'SCRATCHPAD'

## [Task Title]
**Completed:** [timestamp]

### Key Decisions
- [Architectural or implementation decision and why]

### Files Modified
- [List key files changed]

### Notes for Next Agent
- [Dependencies created]
- [Patterns established]
- [Gotchas discovered]
- [Related work that might be affected]

SCRATCHPAD
```

**Output:** High-quality code ready for production, with improvement opportunities documented for future work.

---

## Final Checklist

**ONLY output the completion marker if ALL of these are verified:**
- [ ] Feature implemented and meets requirements
- [ ] Build passes without errors
- [ ] Tests pass (and new tests added for the feature)
- [ ] Tracker status updated to "Done"
- [ ] Git commit created
- [ ] Scratchpad updated with notes for next agent

**If any item is incomplete, complete it first. Then output:**

```
Task "[name]" complete. Feature implemented and verified.
<promise>TASK_COMPLETE</promise>
```

**STOP IMMEDIATELY after outputting the marker.**

---

## Common Pitfalls

- **Scope creep** - Don't add features not in the task
- **Breaking changes** - Ensure backwards compatibility if needed
- **Missing exports** - New code must be importable
- **Forgetting types** - Add proper TypeScript types
- **Ignoring tests** - Phase 3 is mandatory, not optional
- **Skipping review** - Phase 4 catches quality issues before they merge
