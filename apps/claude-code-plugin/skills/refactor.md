---
name: refactor
description: Restructure code without changing behavior
category: refactor
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__create_comment
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Refactor Skill

You refactor code **ONE TASK AT A TIME**. Refactoring changes code structure without changing external behavior.

**Pattern:** Read context -> Understand current state -> Refactor -> Verify behavior unchanged -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **MARK IN PROGRESS IMMEDIATELY** - Update tracker status to "In Progress" before refactoring.
3. **ONE TASK ONLY** - Refactor ONE scope, then STOP.
4. **MARK DONE AT COMPLETION** - Update tracker status to "Done" after refactoring verified.
5. **BOTH STATUS TRANSITIONS REQUIRED** - Must call status update at START and at COMPLETION.
6. **NO BEHAVIOR CHANGES** - Only change structure, not functionality.

---

## Step 0: Verify Task Information

**Before refactoring anything, ensure you have task details:**

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

### 0.5.2 Read the Plan File
Get refactoring goals and target files from the plan.

### 0.5.3 Understand Current Behavior
Before refactoring, document what the code currently does:
- Read the target files thoroughly
- Identify inputs, outputs, and side effects
- Note all callers of the code being refactored

### 0.4 Discover Project Standards

**Before making changes, understand the project's conventions:**

```bash
# Check for linting configuration
ls -la .eslintrc* eslint.config.* .prettierrc* biome.json 2>/dev/null

# Check for TypeScript strictness
grep -E "(strict|noImplicitAny|strictNullChecks)" tsconfig.json 2>/dev/null

# Look for existing style guides or conventions
ls -la CONTRIBUTING.md STYLE_GUIDE.md .editorconfig 2>/dev/null
```

**Document what you find:**
- Linter: [eslint/biome/none]
- TypeScript strict mode: [yes/no]
- Formatting: [prettier/biome/editorconfig/none]
- Any documented conventions in CONTRIBUTING.md

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

## Step 2: Refactor Code

### 2.1 Common Refactoring Patterns

**Extract Function:**
```typescript
// Before
function processUser(user: User) {
  // validation logic here
  // processing logic here
}

// After
function validateUser(user: User): boolean { ... }
function processUser(user: User) {
  if (!validateUser(user)) return;
  // processing logic
}
```

**Extract Class/Module:**
```typescript
// Before: God class doing everything
class UserService {
  validate() { ... }
  save() { ... }
  sendEmail() { ... }
}

// After: Separated concerns
class UserValidator { ... }
class UserRepository { ... }
class UserNotifier { ... }
```

**Dependency Injection:**
```typescript
// Before: Hard-coded dependency
class OrderService {
  private db = new DatabaseClient();
}

// After: Injected dependency
class OrderService {
  constructor(private db: DatabaseClient) {}
}
```

### 2.2 Quality Rules

- **Small steps** - Make one change at a time, verify it works
- **Preserve API** - External callers should not need changes
- **Update imports** - Ensure all imports still resolve
- **No new features** - Refactoring is NOT adding functionality
- **DRY** - Eliminate duplication (see DRY Principles below)
- **Type safety** - No `any` or unnarrowed `unknown` (see Type Safety below)

---

## DRY Principles (Don't Repeat Yourself)

### Identify Duplication First

Before refactoring, scan for duplicated patterns:

```bash
# Look for similar code blocks in the target area
grep -rn "pattern-to-find" --include="*.ts" src/
```

### Common DRY Violations to Fix

| Pattern | Solution |
|---------|----------|
| Repeated validation logic | Extract to shared validator |
| Duplicated API calls | Create service abstraction |
| Copy-pasted error handling | Create error handler utility |
| Repeated type definitions | Export shared types |
| Similar component logic | Extract custom hook or HOC |

### When NOT to DRY

- **Incidental duplication** - Code that looks similar but serves different purposes
- **Test code** - Tests should be explicit, some repetition is acceptable
- **Configuration** - Premature abstraction can hurt readability

---

## Type Safety Requirements

### Strict Rules (NON-NEGOTIABLE)

1. **NO `any` type** - Find proper types or create them
2. **NO `unknown` without narrowing** - Always narrow before use
3. **NO type assertions (`as`)** - Unless absolutely necessary with comment
4. **Prefer `satisfies`** - Over type assertions when validating shape

### Fixing Common Type Issues

**Instead of `any`:**
```typescript
// BAD
function process(data: any) { ... }

// GOOD - Define the shape
interface ProcessData {
  id: string;
  value: number;
}
function process(data: ProcessData) { ... }

// GOOD - Use generics for flexibility
function process<T extends { id: string }>(data: T) { ... }
```

**Instead of `unknown`:**
```typescript
// BAD - Unnarrowed unknown
function handle(err: unknown) {
  console.log(err.message); // Error!
}

// GOOD - Narrow first
function handle(err: unknown) {
  if (err instanceof Error) {
    console.log(err.message);
  }
}
```

---

## Lint & Style Compliance

### REQUIRED: Zero Warnings Policy

After refactoring, there must be **NO** lint errors or warnings.

```bash
# Run linter
npm run lint

# Auto-fix what's possible
npm run lint -- --fix

# Run formatter (if available)
npm run format
```

### Style Consistency Rules

- Match existing patterns in the codebase
- Use same naming conventions (camelCase, PascalCase, etc.)
- Follow existing file organization patterns
- Match existing import ordering
- Use same comment style as surrounding code

### If No Linter Configured

Check code manually for:
- Consistent indentation
- Consistent quotes (single/double)
- Consistent semicolons
- No unused variables
- No console.log statements (unless intentional)

---

## Step 3: Verify Refactoring

**ALL four checks must pass before marking complete.**

### 3.1 Type Safety Check
```bash
npx tsc --noEmit
# Must pass with ZERO errors
# Verify no `any` types were introduced
```

### 3.2 Lint Check
```bash
npm run lint
# Must pass with ZERO errors and ZERO warnings
```

### 3.3 Test Check
```bash
npm test
# All tests must pass
```

**If tests fail:**
1. The refactoring broke something - fix it
2. The tests were testing implementation details - note this, may need test updates

### 3.4 Build Check
```bash
npm run build
# Must build successfully
```

---

## Discovered Work Protocol

**During refactoring, you may discover work outside the current task's scope:**

- Bugs revealed by cleaner code
- Missing tests
- Additional refactoring opportunities
- Documentation that needs updating
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
- **Continue with your current refactoring task** - do not switch focus
- The new task will be picked up in a future iteration

---

## Step 4: Mark Task Complete (REQUIRED - DO NOT SKIP)

**Before outputting TASK_COMPLETE marker, you MUST:**

1. Verify all tests pass (npm test)
2. Confirm type checking passes (tsc --noEmit)
3. Confirm linting passes with zero warnings (npm run lint)
4. Confirm build succeeds (npm run build)
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

Update plan: `- [x] **Status:** complete`

---

## Step 4.5: Commit Changes (REQUIRED)

**Create a local commit for this task before marking complete:**

```bash
git add -A
git commit -m "refactor: [brief description of refactoring]

Task: [TASK_ID or task name]
Skill: refactor"
```

**Note:** Local commits only - do NOT push. Push at session end or user request.

---

## Step 4.6: Update Scratchpad (REQUIRED)

**Before outputting the completion marker, update the scratchpad for the next agent:**

```bash
cat >> .claude/scratchpad.md << 'SCRATCHPAD'

## [Task Title]
**Completed:** [timestamp]

### Refactoring Applied
- [What was refactored and why]

### Files Modified
- [Files changed]

### Notes for Next Agent
- [New patterns/abstractions introduced]
- [Migration steps if any]
- [Related code that uses refactored modules]

SCRATCHPAD
```

---

## Step 5: Output Completion Marker

**Final checklist before outputting marker:**

- [ ] All tests passing (npm test)
- [ ] Type checking passes (tsc --noEmit)
- [ ] Linting passes with zero warnings (npm run lint)
- [ ] Build succeeds (npm run build)
- [ ] Tracker status updated to "Done" (mcp__linear__update_issue or bd close called successfully)
- [ ] Git commit created
- [ ] Scratchpad updated

```
Task "[name]" complete. Code refactored, all tests passing.
<promise>TASK_COMPLETE</promise>
```

**STOP IMMEDIATELY after outputting the marker.**

---

## Common Pitfalls

- **Changing behavior** - Refactoring MUST NOT change what code does
- **Big bang refactors** - Make small incremental changes
- **Breaking callers** - Update all import sites
- **Forgetting tests** - Run tests after each change
- **Adding features** - Create a separate task for new functionality
