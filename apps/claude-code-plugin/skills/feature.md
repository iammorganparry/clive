---
name: feature
description: Implement new features according to plan specifications
category: feature
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__update_issue, mcp__linear__get_issue
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Feature Implementation Skill

You implement features **ONE TASK AT A TIME** from the approved plan. Each invocation handles exactly one feature task.

**Pattern:** Read context -> Understand requirements -> Implement -> Verify -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **ONE TASK ONLY** - Implement ONE feature task, then STOP.
3. **MUST UPDATE STATUS** - Update issue tracker AND plan file after completion.
4. **NO SCOPE CREEP** - Only implement what the task specifies.

---

## Step 0: Read Your Context

### 0.1 Detect Tracker and Check Ready Work
```bash
# Read tracker preference
TRACKER=$(cat ~/.clive/config.json 2>/dev/null | jq -r '.issue_tracker // "beads"')
echo "Using tracker: $TRACKER"

if [ "$TRACKER" = "beads" ] && [ -d ".beads" ]; then
    bd ready
fi
# For Linear: The TUI passes the current task info via $TASK_ID environment variable
```

### 0.2 Read the Plan File
Get feature requirements, acceptance criteria, and target files from the plan.

### 0.3 Understand Existing Patterns
Before writing new code, understand the codebase:
- Read similar existing implementations
- Note coding conventions and patterns used
- Find related types, interfaces, utilities

---

## Step 1: Mark Task In Progress

**For Beads:**
```bash
bd update [TASK_ID] --status in_progress
```

**For Linear:**
Use `mcp__linear__update_issue` with:
- `id`: The task ID
- `state`: "In Progress" (or equivalent workflow state)
- `assignee`: "me"

Update plan file: `- [ ] **Status:** in_progress`

---

## Step 2: Implement Feature

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
- **Type safety** - use proper TypeScript types

---

## Step 3: Verify Feature Works

### Build Check
```bash
npm run build
# or: npm run typecheck, tsc --noEmit
```

### Test Check
```bash
npm test
```

### Manual Verification (if applicable)
If the feature can be tested manually:
```bash
npm run dev
# Then test the feature in browser/CLI
```

### What "Complete" Means

- Build succeeds without errors
- All existing tests still pass
- Feature meets requirements from plan
- Code follows project patterns

---

## Discovered Work Protocol

**During implementation, you may discover work outside the current task's scope:**

- Bugs in existing code
- Missing tests
- Code that needs refactoring
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

---

## Step 4: Update Status

**For Beads:**
```bash
bd close [TASK_ID]
```

**For Linear:**
Use `mcp__linear__update_issue` with:
- `id`: The task ID
- `state`: "Done" (or equivalent completed workflow state)

Update plan: `- [x] **Status:** complete`

---

## Step 4.5: Commit Changes (REQUIRED)

**Create a local commit for this task before marking complete:**

```bash
git add -A
git commit -m "feat: [brief description of feature implemented]

Task: [TASK_ID or task name]
Skill: feature"
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

**What to include:**
- Architectural decisions and reasoning
- Patterns or conventions established
- Files modified that other tasks depend on
- Gotchas or edge cases discovered
- Dependencies between tasks

---

## Step 5: Output Completion Marker

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
- **Ignoring tests** - Run tests to catch regressions
