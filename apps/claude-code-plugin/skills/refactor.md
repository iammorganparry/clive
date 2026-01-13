---
name: refactor
description: Restructure code without changing behavior
category: refactor
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Refactor Skill

You refactor code **ONE TASK AT A TIME**. Refactoring changes code structure without changing external behavior.

**Pattern:** Read context -> Understand current state -> Refactor -> Verify behavior unchanged -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **BEADS FIRST** - Use `bd ready` to find work, `bd close` to complete.
2. **ONE TASK ONLY** - Refactor ONE scope, then STOP.
3. **MUST UPDATE STATUS** - Update beads AND plan file after completion.
4. **NO BEHAVIOR CHANGES** - Only change structure, not functionality.

---

## Step 0: Read Your Context

### 0.1 Check Beads First
```bash
if [ -d ".beads" ]; then
    bd ready
fi
```

### 0.2 Read the Plan File
Get refactoring goals and target files from the plan.

### 0.3 Understand Current Behavior
Before refactoring, document what the code currently does:
- Read the target files thoroughly
- Identify inputs, outputs, and side effects
- Note all callers of the code being refactored

---

## Step 1: Mark Task In Progress

```bash
bd update [TASK_ID] --status in_progress
```

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

---

## Step 3: Verify Behavior Unchanged

### Run All Tests
```bash
npm test
```

**ALL tests must pass. If tests fail:**
1. The refactoring broke something - fix it
2. The tests were testing implementation details - note this, may need test updates

### Build Check
```bash
npm run build
```

### Check for Unused Exports
```bash
# Look for import errors after refactoring
npm run typecheck
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

## Step 4: Update Status

```bash
bd close [TASK_ID]
```

Update plan: `- [x] **Status:** complete`

---

## Step 5: Output Completion Marker

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
