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

### 1.2 Read Acceptance Criteria and Definition of Done

**CRITICAL: Read task requirements FIRST before any implementation.**

**Your task includes:**
- **Acceptance Criteria** - Specific, testable requirements that define "done"
- **Definition of Done** - Checklist including tests, code quality, documentation
- **Technical Notes** - Codebase patterns, file references, testing strategy, skill justification

**Where to find them:**
- **For Linear**: Call `mcp__linear__get_issue` with the task ID to fetch full description
- **For Beads**: Task description in the prompt contains AC and DoD
- **In plan file**: Check `.claude/plans/*.md` for detailed user story and technical notes

**Parse the requirements:**
```
User Story:
As a [role]
I want [capability]
So that [benefit]

Acceptance Criteria:
1. [Specific testable criterion]
2. [Specific testable criterion]
3. [Specific testable criterion]

Definition of Done:
- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing
- [ ] Code reviewed
- [ ] Documentation updated
- [ ] Build succeeds

Technical Notes:
- Files affected: [paths with line numbers]
- Existing patterns: [references to similar code]
- Code examples: [snippets showing approach]
- Testing strategy: [based on codebase patterns]
```

**Important:**
- **Acceptance criteria are your requirements** - Every criterion must be verifiable in Phase 4
- **DoD is your quality checklist** - Testing is PART OF DoD, not a separate task
- **Technical notes guide your implementation** - Follow existing patterns referenced there

### 1.3 Read Previous Work Context

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

### 1.4 Detect Worktree Context

**Check if you're working in a git worktree:**
```bash
# Check for worktree state files (created by build.sh)
if [ -f ".claude/.worktree-path" ]; then
    WORKTREE_PATH=$(cat .claude/.worktree-path)
    WORKTREE_BRANCH=$(cat .claude/.worktree-branch 2>/dev/null)
    MAIN_REPO=$(cat .claude/.worktree-origin 2>/dev/null)
    echo "🌲 Working in worktree: $WORKTREE_PATH"
    echo "   Branch: $WORKTREE_BRANCH"
    echo "   Main repo: $MAIN_REPO"
fi
```

**If in a worktree:**
- All commits are isolated on the worktree branch
- Changes don't affect the main repo until merged
- Document the worktree path in your scratchpad
- Remember to note which branch you're on in commit messages

### 1.5 Understand Existing Architecture

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

### 1.6 Mark Task In Progress (REQUIRED - DO NOT SKIP)

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

### 2.5 Error Documentation (Global Learnings)

**If you encounter an error during implementation:**

1. **Check global learnings first:**
   - Review `.claude/learnings/error-patterns.md` for known solutions
   - Check `.claude/learnings/gotchas.md` for codebase quirks

2. **If error is new or recurring, document it globally:**
   ```bash
   cat >> .claude/learnings/error-patterns.md << 'EOF'

   ### [Brief Error Description]
   **Symptom:** [What you see - error message, behavior]
   **Root Cause:** [Why it happens - after investigation]
   **Solution:** [How you fixed it - concrete steps]
   **Prevention:** [How to avoid in future - pattern/practice]
   **First Seen:** $(date '+%Y-%m-%d') - Epic: $EPIC_FILTER - Iteration: $ITERATION
   **Occurrences:** 1
   **Related Files:** [Files affected]

   ---
   EOF
   ```

3. **If error already documented, update it:**
   - Increment frequency count
   - Add current epic/iteration to "Occurrences" list
   - Update "Last Seen" date

4. **For codebase quirks (not errors but surprising behavior):**
   ```bash
   cat >> .claude/learnings/gotchas.md << 'EOF'

   ### [Gotcha Name]
   **What Happens:** [Surprising behavior]
   **Why:** [Root cause or design decision]
   **How to Handle:** [Correct approach]
   **Files Affected:** [Where this applies]
   **Discovered:** $(date '+%Y-%m-%d') - Epic: $EPIC_FILTER - Iteration: $ITERATION

   ---
   EOF
   ```

**Remember:** Global learnings help ALL future agents avoid the same issues.

### 2.6 Discovered Work Protocol

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

## Phase 3: Testing (Part of Definition of Done)

**Goal:** Fulfill the testing requirements from the Definition of Done and verify acceptance criteria.

### 3.1 Review DoD Testing Requirements

**Your task's Definition of Done specifies testing requirements. Common items:**
- Unit tests written and passing
- Integration tests written and passing
- E2E tests written and passing (if applicable)
- Error scenarios tested
- Edge cases covered

**Check the task description or plan file for specific testing strategy:**
- Technical notes often include testing patterns from the codebase
- Testing strategy may reference existing test files to follow

### 3.2 Write Tests Based on Acceptance Criteria

**Each acceptance criterion should be verifiable through tests:**

**Example:**
```
Acceptance Criteria:
1. User sees error message when login fails
2. Form validation shows inline errors
3. User can export data as CSV

Tests to write:
- Unit test: Login failure shows error component
- Integration test: Form submission validates and displays errors
- E2E test: Export button downloads CSV file
```

**Testing Philosophy:**
- Test **outcomes** (what), not **implementation** (how)
- Tests should fail if acceptance criteria are not met
- Tests should pass if implementation changes but behavior doesn't
- Follow testing patterns referenced in technical notes

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

### 4.3 Verify All Acceptance Criteria (CRITICAL)

**Before marking task complete, verify EVERY acceptance criterion from Phase 1:**

**Example verification:**
```
✓ Acceptance Criteria Check:

1. "User sees error message when login fails"
   ✓ Verified: LoginForm shows ErrorMessage component on auth failure
   ✓ Test: unit test "shows error on failed login" passes
   ✓ Manual: Tested in Extension Development Host

2. "Form validation shows inline errors"
   ✓ Verified: ValidationError components render below invalid fields
   ✓ Test: integration test "displays validation errors" passes
   ✓ Manual: Confirmed in UI

3. "User can export data as CSV"
   ✓ Verified: Export button triggers CSV download
   ✓ Test: E2E test "exports CSV file" passes
   ✓ Manual: Downloaded file contains correct data

All acceptance criteria met ✓
```

**If ANY criterion is not met, DO NOT mark complete. Fix the issue first.**

### 4.4 Verify Definition of Done

**Check off every item from the task's Definition of Done:**

```
Definition of Done verification:
- [✓] All acceptance criteria met (verified above)
- [✓] Unit tests written and passing
- [✓] Integration tests written and passing
- [✓] Code reviewed (self-review in Phase 4.1-4.2)
- [✓] Documentation updated (if applicable)
- [✓] No linting errors
- [✓] No type errors
- [✓] Build succeeds
```

**Run quality checks:**
```bash
# TypeScript check
tsc --noEmit  # Must pass with ZERO errors

# Linting
npm run lint  # Must pass with ZERO warnings

# Build
npm run build  # Must succeed

# All tests
npm test  # Must pass with ZERO failures
```

**If ANY DoD item is incomplete, DO NOT mark complete. Finish it first.**

### 4.5 Validate Scratchpad Documentation (MANDATORY)

**Before marking task complete, verify you've documented learnings.**

**Check scratchpad was updated:**
```bash
# Verify scratchpad has entry for this iteration
ITERATION=$(cat .claude/.build-iteration)
EPIC_ID=$(basename "$(dirname "$SCRATCHPAD_FILE")" 2>/dev/null || echo "unknown")

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
- [ ] "What Worked" section has at least 1 item
- [ ] "Key Decisions" section documents major choices
- [ ] "Files Modified" section lists all changed files
- [ ] "Gotchas" section warns about pitfalls (if any)
- [ ] Date/time stamp is current

**If scratchpad is incomplete:**
- Fill it out NOW before proceeding
- Use the structured template provided in the prompt
- Be specific - generic notes don't help future agents

### 4.6 Post-Task Reflection (MANDATORY)

**Before outputting TASK_COMPLETE, reflect on this task:**

**Answer these questions in scratchpad:**

1. **Effectiveness:** What was the most effective technique/tool you used?
2. **Efficiency:** What slowed you down? How could next iteration be faster?
3. **Quality:** Did tests adequately cover the implementation?
4. **Patterns:** What reusable pattern emerged from this work?
5. **Improvements:** What would you do differently next time?
6. **Knowledge Gap:** What did you learn that you wish you knew before starting?

**Append reflection to scratchpad:**
```bash
cat >> $SCRATCHPAD_FILE << 'REFLECTION'

### 🔄 Post-Task Reflection

**Most Effective:** [technique/tool]
**Slowed By:** [bottleneck]
**Test Coverage:** [adequate/needs improvement]
**Reusable Pattern:** [pattern discovered]
**Would Do Differently:** [improvement]
**Learned:** [key insight]

REFLECTION
```

**If you discovered a reusable pattern, document it globally:**

```bash
# Only if the pattern is truly reusable across different contexts
cat >> .claude/learnings/success-patterns.md << 'EOF'

### [Pattern Name]
**Use Case:** [When to apply this pattern - be specific about context]
**Implementation:** [Step-by-step how to implement - with code example if helpful]
**Benefits:** [Why this works well - measurable improvements]
**Examples:** [Where this was used successfully - file:line references]
**First Used:** $(date '+%Y-%m-%d') - Epic: $EPIC_FILTER - Task: [TASK_IDENTIFIER]
**Reused In:** [Will be updated when pattern is reused]

---
EOF
```

**Guidelines for global pattern documentation:**
- Only document patterns that are TRULY reusable (not task-specific)
- Include concrete examples and code references
- Be specific about when to apply (and when NOT to apply)
- Patterns should save future agents time and improve quality

**This reflection will guide the next agent's approach.**

### 4.7 Complete the Task (REQUIRED - DO NOT SKIP)

**Before outputting TASK_COMPLETE marker, you MUST:**

1. ✓ Verify all acceptance criteria are met (4.3)
2. ✓ Verify all Definition of Done items complete (4.4)
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

### 4.6 Commit Changes (REQUIRED)

```bash
git add -A
git commit -m "feat: [brief description of feature implemented]

Task: [TASK_ID or task name]
Skill: feature"
```

**Note:** Local commits only - do NOT push.

### 4.7 Update Scratchpad (REQUIRED)

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
- [ ] ALL acceptance criteria verified and met (Phase 4.3)
- [ ] ALL Definition of Done items checked off (Phase 4.4)
- [ ] Feature implemented following technical notes patterns
- [ ] Build passes without errors
- [ ] All tests pass (unit, integration, E2E as specified in DoD)
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

## Epic Completion & Worktree Cleanup

**When the current task is the LAST task in the epic:**

After completing the final task, check if the epic should be marked Done:

```bash
# Check if all sibling tasks under the epic are complete
EPIC_ID=$(echo "$TASK_ID" | sed 's/\.[0-9]*$//')  # Derive parent from task ID
REMAINING=$(bd ready --json 2>/dev/null | jq -r --arg epic "$EPIC_ID" '
  [.[] | select((.parent // (.id | split(".") | if length > 1 then .[:-1] | join(".") else "" end)) == $epic)] | length
')

if [ "$REMAINING" = "0" ]; then
    echo "✅ All tasks under epic $EPIC_ID are complete!"

    # Mark epic as Done
    bd close "$EPIC_ID"

    # Cleanup worktree if active
    if [ -f ".claude/.worktree-path" ]; then
        WORKTREE_PATH=$(cat .claude/.worktree-path)
        WORKTREE_BRANCH=$(cat .claude/.worktree-branch 2>/dev/null)
        MAIN_REPO=$(cat .claude/.worktree-origin 2>/dev/null)

        echo "🧹 Epic complete - cleaning up worktree"
        echo "   Worktree: $WORKTREE_PATH"
        echo "   Branch: $WORKTREE_BRANCH"

        # Return to main repo
        cd "$MAIN_REPO"

        # Push the branch before cleanup (so work isn't lost)
        git -C "$WORKTREE_PATH" push -u origin "$WORKTREE_BRANCH" 2>/dev/null || \
            echo "   Note: Could not push branch (may need manual push)"

        # Remove worktree
        git worktree remove "$WORKTREE_PATH" --force 2>/dev/null && \
            echo "✅ Worktree removed" || \
            echo "⚠️  Could not remove worktree (may need manual cleanup)"

        # Optionally delete local branch (keep remote for PR)
        # git branch -D "$WORKTREE_BRANCH" 2>/dev/null

        echo ""
        echo "📝 Next steps:"
        echo "   1. Create PR for branch: $WORKTREE_BRANCH"
        echo "   2. Review and merge"
        echo "   3. Delete remote branch after merge"
    fi
fi
```

**Important:**
- Always push the branch before removing the worktree
- The remote branch is preserved for PR creation
- Local branch deletion is optional (commented out by default)

---

## Common Pitfalls

- **Scope creep** - Don't add features not in the task
- **Breaking changes** - Ensure backwards compatibility if needed
- **Missing exports** - New code must be importable
- **Forgetting types** - Add proper TypeScript types
- **Ignoring tests** - Phase 3 is mandatory, not optional
- **Skipping review** - Phase 4 catches quality issues before they merge
- **Worktree cleanup** - Don't forget to push before removing worktree
