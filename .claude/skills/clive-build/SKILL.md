---
name: clive-build
description: Task execution agent using Claude Tasks + Linear sync with global learnings capture. Use when the user needs to (1) Implement planned features from Linear, (2) Execute a build loop to complete multiple tasks, (3) Fix bugs or refactor code, (4) Automatically update Linear status. Uses Claude's TaskList() for execution tracking, syncs with Linear issues, reads global learnings (error patterns, success patterns, gotchas), executes using appropriate skill, validates scratchpad documentation, and captures knowledge for future iterations.
allowed-tools: Bash, Read, Glob, Grep, Edit, Write, TaskUpdate, TaskList, TaskGet, TaskCreate, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__list_issues, mcp__linear__create_comment, mcp__v0__*
denied-tools: TodoWrite, AskUserQuestion, EnterPlanMode, ExitPlanMode
model: opus
---

# Clive: Task Execution with Learnings

Execute tasks from Claude Tasks (linked to Linear) with automatic knowledge capture and pattern recognition.

## When to Use

Run `/clive:build` to:
- Execute next Claude Task (linked to Linear issue)
- Implement planned features or bug fixes
- Run continuous build loop
- Automatically capture learnings
- Sync status back to Linear

## Overview

This skill executes tasks ONE AT A TIME following this workflow:

1. **Fetch Next Task** - Use TaskList() to find pending Claude Tasks
2. **Read Context** - Load global learnings and epic scratchpad
3. **Execute Task** - Follow appropriate skill workflow (feature/bugfix/refactor/tests)
4. **Document Learnings** - Update scratchpad and global patterns (MANDATORY)
5. **Validate and Complete** - Verify documentation, update statuses, commit code

## Session Context

When launched from Clive TUI, the skill automatically reads context about the selected issue from `.claude/session-context.json`. This file contains:

```json
{
  "selectedAt": "2024-01-23T10:00:00Z",
  "mode": "build",
  "issue": {
    "id": "uuid",
    "identifier": "TRI-2119",
    "title": "Epic: Feature Name",
    "url": "https://linear.app/...",
    "state": "In Progress",
    "priority": 2,
    "labels": ["epic", "feature"]
  }
}
```

## Workflow

### Step 0: Load Session Context and Initialize Tasks

First, check for session context from Clive TUI and ensure Claude Tasks exist for the selected issue.

```typescript
// Read session context from Clive TUI
let sessionContext = null
try {
  const contextFile = Read('.claude/session-context.json')
  sessionContext = JSON.parse(contextFile)
  console.log(`
📋 Session Context from Clive TUI
Issue: ${sessionContext.issue.identifier} - ${sessionContext.issue.title}
Mode: ${sessionContext.mode}
`)
} catch (e) {
  // No session context - that's OK, will use existing Claude Tasks
  console.log('No session context found, checking for existing Claude Tasks...')
}

// If we have session context, ensure Claude Tasks exist for this issue
if (sessionContext?.issue) {
  const issueId = sessionContext.issue.id
  const issueIdentifier = sessionContext.issue.identifier

  // Check if Claude Tasks already exist for this issue
  const existingTasks = await TaskList()
  const hasTasksForIssue = existingTasks.some(t =>
    t.metadata?.linearIdentifier === issueIdentifier ||
    t.metadata?.linearIssueId === issueId ||
    t.metadata?.epic === issueId
  )

  // Load local progress file (persists completed tasks across sessions)
  let localProgress = { completedIssues: [] }
  const progressFile = `.claude/epics/${issueId}/progress.json`
  try {
    const progressContent = Read(progressFile)
    localProgress = JSON.parse(progressContent)
    console.log(`📁 Loaded local progress: ${localProgress.completedIssues.length} tasks completed`)
  } catch (e) {
    // No local progress file yet - will create on first completion
  }

  if (!hasTasksForIssue) {
    console.log(`No Claude Tasks found for ${issueIdentifier}. Fetching sub-issues from Linear...`)

    // Fetch the parent issue to get full details
    const parentIssue = await mcp__linear__get_issue({
      id: issueIdentifier
    })

    // Fetch sub-issues (children) of this issue
    const subIssues = await mcp__linear__list_issues({
      parentId: parentIssue.id,
      includeArchived: false
    })

    if (subIssues.length === 0) {
      // No sub-issues - this might be a leaf task, create a single task for it
      console.log(`No sub-issues found. Creating task for ${issueIdentifier} directly...`)

      const skillLabel = parentIssue.labels?.find(l => l.name?.startsWith('skill:'))
      const skill = skillLabel?.name?.replace('skill:', '') || 'feature'

      await TaskCreate({
        subject: parentIssue.title,
        description: `
Linear Issue: ${parentIssue.identifier} (${parentIssue.id})

${parentIssue.description || 'No description provided'}
`,
        activeForm: `Implementing ${parentIssue.title}`,
        metadata: {
          linearIssueId: parentIssue.id,
          linearIdentifier: parentIssue.identifier,
          skill: skill,
          scratchpadPath: `.claude/epics/${parentIssue.id}/scratchpad.md`
        }
      })

      console.log(`✅ Created task for: ${parentIssue.identifier}`)
    } else {
      console.log(`Found ${subIssues.length} sub-issues. Creating Claude Tasks...`)

      // Sort sub-issues by priority and creation date for correct order
      const sortedSubIssues = subIssues.sort((a, b) => {
        // Priority: 1=Urgent, 2=High, 3=Normal, 4=Low, 0=None
        const priorityA = a.priority || 5
        const priorityB = b.priority || 5
        if (priorityA !== priorityB) return priorityA - priorityB
        // Then by creation date
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      })

      // Track progress summary
      let skippedCompleted = 0
      let createdTasks = 0

      // Create Claude Tasks from sub-issues
      for (const subIssue of sortedSubIssues) {
        // Skip if already in local progress (faster than Linear API check)
        if (localProgress.completedIssues.includes(subIssue.id)) {
          console.log(`⏭️  Skipping (local cache): ${subIssue.identifier}`)
          skippedCompleted++
          continue
        }

        // Skip completed/canceled/done issues (check both type and name for robustness)
        const stateType = subIssue.state?.type?.toLowerCase() || ''
        const stateName = subIssue.state?.name?.toLowerCase() || ''
        const isCompleted = stateType === 'completed' || stateType === 'canceled' ||
                           stateName === 'done' || stateName === 'completed' ||
                           stateName === 'canceled' || stateName === 'cancelled'

        if (isCompleted) {
          console.log(`⏭️  Skipping completed: ${subIssue.identifier} (${subIssue.state?.name})`)
          skippedCompleted++
          continue
        }

        // Determine skill type from labels or default to 'feature'
        const skillLabel = subIssue.labels?.find(l => l.name?.startsWith('skill:'))
        const skill = skillLabel?.name?.replace('skill:', '') || 'feature'

        await TaskCreate({
          subject: subIssue.title,
          description: `
Linear Issue: ${subIssue.identifier} (${subIssue.id})

${subIssue.description || 'No description provided'}
`,
          activeForm: `Implementing ${subIssue.title}`,
          metadata: {
            linearIssueId: subIssue.id,
            linearIdentifier: subIssue.identifier,
            skill: skill,
            epic: parentIssue.id,
            epicIdentifier: parentIssue.identifier,
            scratchpadPath: `.claude/epics/${parentIssue.id}/scratchpad.md`
          }
        })

        createdTasks++
        console.log(`✅ Created task: ${subIssue.identifier} - ${subIssue.title}`)
      }

      console.log(`
📋 Task Summary for ${parentIssue.identifier}:
   ✅ Created ${createdTasks} pending tasks
   ⏭️  Skipped ${skippedCompleted} completed tasks
   📊 Total sub-issues: ${sortedSubIssues.length}

Progress is persisted in Linear - completed tasks will be skipped on future sessions.
`)
    }
  } else {
    console.log(`Found existing Claude Tasks for ${issueIdentifier}`)
  }
}
```

### Step 1: Fetch Next Task from Claude Tasks

#### 1.1 Get Next Task

```typescript
// Use Claude's native task system
const tasks = await TaskList()

// Find next available task
const nextTask = tasks.find(task =>
  task.status === 'pending' &&
  (!task.blockedBy || task.blockedBy.length === 0) &&
  !task.owner
)

if (!nextTask) {
  console.log("✅ All tasks complete!")
  console.log("To plan new work, use: /clive:plan")
  exit 10 // ALL_TASKS_COMPLETE exit code
}

// Claim the task
await TaskUpdate({
  taskId: nextTask.id,
  status: 'in_progress',
  owner: 'build-agent'
})
```

#### 1.2 Fetch Linear Details

```typescript
// Get Linear context from task metadata
const linearIssueId = nextTask.metadata.linearIssueId
const linearIdentifier = nextTask.metadata.linearIdentifier

// Fetch full Linear issue details
const linearDetails = await mcp__linear__get_issue({
  id: linearIssueId
})

console.log(`
Task: ${linearDetails.title}
Linear: ${linearIdentifier}
Status: ${linearDetails.state.name}
`)

// Update Linear status to "In Progress"
await mcp__linear__update_issue({
  id: linearIssueId,
  state: 'In Progress',
  assignee: 'me'
})
```

#### 1.3 Load Context

```typescript
// Get skill type from metadata
const skill = nextTask.metadata.skill // 'feature' | 'bugfix' | 'refactor' | 'unit-tests'

// Get scratchpad path from metadata
const scratchpadPath = nextTask.metadata.scratchpadPath
const epicId = nextTask.metadata.epic

// Initialize epic directory
Bash(`mkdir -p .claude/epics/${epicId}`)

// Load global learnings
const errorPatterns = Read('.claude/learnings/error-patterns.md')
const successPatterns = Read('.claude/learnings/success-patterns.md')
const gotchas = Read('.claude/learnings/gotchas.md')

// Load epic scratchpad
let epicContext = ""
if (fileExists(scratchpadPath)) {
  epicContext = Read(scratchpadPath)
} else {
  // Initialize scratchpad
  Write(scratchpadPath, `# Epic Scratchpad: ${linearDetails.title}\n\n`)
}

// Display context
console.log(`
## Global Learnings Available
- Error Patterns: ${countPatterns(errorPatterns)} documented
- Success Patterns: ${countPatterns(successPatterns)} documented
- Gotchas: ${countPatterns(gotchas)} documented

## Epic Context
${showRecentProgress(epicContext, 5)} // Last 5 iterations
`)
```

### Step 2: Read Task Requirements

Extract acceptance criteria and Definition of Done from Linear issue description:

```typescript
const description = linearDetails.description

// Parse structured sections
const userStory = extractSection(description, 'User Story:')
const acceptanceCriteria = extractSection(description, 'Acceptance Criteria:')
const definitionOfDone = extractSection(description, 'Definition of Done:')
const technicalNotes = extractSection(description, 'Technical Notes:')

console.log(`
## Task Requirements

${userStory}

## Acceptance Criteria
${acceptanceCriteria}

## Definition of Done
${definitionOfDone}

## Technical Notes
${technicalNotes}
`)
```

### Step 3: Execute Task Using Appropriate Skill

Based on the skill type determined from task metadata, load and follow the appropriate workflow:

#### Skill Selection

```typescript
const skillFile = {
  'feature': 'references/skill-feature.md',
  'bugfix': 'references/skill-bugfix.md',
  'refactor': 'references/skill-refactor.md',
  'unit-tests': 'references/skill-unit-tests.md'
}[skill]

// Read the skill workflow
const skillWorkflow = Read(skillFile)

console.log(`Following ${skill} workflow from ${skillFile}`)
```

**Skill Workflows:**

- **feature**: Implement new features according to specifications
  - 4-phase workflow: Context & Discovery → Implementation → Testing → Review
  - Focus on user value delivery with acceptance criteria verification
  - Includes Definition of Done checklist
  - Read `references/skill-feature.md` for full workflow

- **bugfix**: Fix bugs with proper root cause analysis
  - Pattern: Reproduce → Find root cause → Fix → Add regression test → Verify
  - Emphasis on prevention and error pattern documentation
  - Minimal fixes without over-engineering
  - Read `references/skill-bugfix.md` for full workflow

- **refactor**: Restructure code without changing behavior
  - Pattern: Read context → Understand → Refactor → Verify unchanged behavior
  - Zero warnings policy (lint, style, type errors)
  - Behavior preservation is critical
  - Read `references/skill-refactor.md` for full workflow

- **unit-tests**: Write unit tests for existing code
  - One-task-at-a-time testing approach
  - Test data management and quality rules
  - Pattern documentation for future tests
  - Read `references/skill-unit-tests.md` for full workflow

**After selecting skill, follow the complete workflow from the reference file.**

### Step 4: Document Learnings (MANDATORY)

**You MUST update the scratchpad before marking task complete.** This is NON-NEGOTIABLE.

#### 4.1 Update Scratchpad

Use the structured template:

```bash
cat >> $SCRATCHPAD_FILE << 'SCRATCHPAD'
---
## Iteration [N] - [Linear ID] [Task Title]
**Completed:** $(date '+%Y-%m-%d %H:%M')
**Status:** [Completed/Blocked/Partial]
**Claude Task ID:** [task-id]

### ✅ What Worked
- [Successful approach or technique]
- [Pattern that should be reused]
- [Tool/library that solved the problem well]

### ❌ What Didn't Work / Blockers
- [Approach that failed and why]
- [Blocker encountered and resolution]
- [Dead end to avoid]

### 🧠 Key Decisions & Rationale
- [Important decision]: [Why this choice was made]
- [Trade-off]: [What was gained vs what was sacrificed]

### 📝 Files Modified
- `path/to/file.ts` - [What changed and why]
- `path/to/test.ts` - [Test coverage added]

### ⚠️ Gotchas for Next Agent
- [Tricky part of codebase to watch out for]
- [Configuration quirk]
- [Test that's flaky]

### 🎯 Success Patterns
- [Reusable pattern discovered]
- [Effective workflow]

### 📊 Metrics
- Tests: [X passed / Y total]
- Build time: [duration]
- Lines changed: [+X -Y]

SCRATCHPAD
```

#### 4.2 Document to Global Learnings

See `references/learnings-system.md` for complete documentation guidelines.

**When to document to global learnings:**
- **Error Patterns**: Errors that might occur in other epics
- **Success Patterns**: Reusable techniques that work across contexts
- **Gotchas**: Codebase quirks that surprised you

**When NOT to document:**
- Task-specific details
- One-off issues
- Obvious behaviors
- Temporary workarounds

**Example: Document Error Pattern**

```bash
cat >> .claude/learnings/error-patterns.md << 'EOF'

### [Error Name/Description]
**Symptom:** [What you see]
**Root Cause:** [Why it happens]
**Solution:** [How to fix it]
**Prevention:** [How to avoid it]
**First Seen:** $(date '+%Y-%m-%d') - Epic: $EPIC_ID - Iteration: $N
**Occurrences:** 1
**Related Files:** [Files commonly affected]

---
EOF
```

#### 4.3 Post-Task Reflection (MANDATORY)

Before completing, reflect on the task:

```bash
cat >> $SCRATCHPAD_FILE << 'REFLECTION'

### 🔄 Post-Task Reflection

**Most Effective:** [technique/tool that worked best]
**Slowed By:** [bottleneck or challenge]
**Test Coverage:** [adequate/needs improvement]
**Reusable Pattern:** [pattern discovered that could be extracted]
**Would Do Differently:** [improvement for next time]
**Learned:** [key insight gained from this work]

REFLECTION
```

### Step 5: Validate and Complete

#### 5.1 Validate Scratchpad Documentation

**CRITICAL:** Verify scratchpad was updated before marking complete.

```bash
# Check scratchpad has entry for this task
ITERATION=$(cat .claude/.build-iteration 2>/dev/null || echo "1")
SCRATCHPAD_FILE=".claude/epics/${EPIC_ID}/scratchpad.md"

if [ ! -f "$SCRATCHPAD_FILE" ]; then
    echo "❌ ERROR: Scratchpad file not found at $SCRATCHPAD_FILE"
    echo "You MUST document learnings in scratchpad before completion"
    exit 1
fi

# Check for current iteration entry
if ! grep -q "## Iteration $ITERATION" "$SCRATCHPAD_FILE"; then
    echo "❌ ERROR: Scratchpad not updated for iteration $ITERATION"
    echo "You MUST document learnings in scratchpad before completion"
    echo "See scratchpad template in Step 4.1"
    exit 1
fi

echo "✅ Scratchpad validation passed"
```

**Scratchpad checklist:**
- [ ] "What Worked" section has at least 1 item
- [ ] "Key Decisions" section documents major choices
- [ ] "Files Modified" section lists all changed files
- [ ] "Post-Task Reflection" is complete
- [ ] Date/time stamp is current

#### 5.2 Update Claude Task Status

```typescript
await TaskUpdate({
  taskId: currentTask.id,
  status: 'completed'
})

console.log(`✅ Claude Task ${currentTask.id} marked complete`)
```

#### 5.2.1 Persist Progress Locally

```typescript
// Update local progress file for persistence across sessions
const epicId = currentTask.metadata.epic
const progressFile = `.claude/epics/${epicId}/progress.json`

// Load existing progress
let progress = { completedIssues: [], lastUpdated: null }
try {
  const existing = Read(progressFile)
  progress = JSON.parse(existing)
} catch (e) {
  // First completion - will create new file
}

// Add this task if not already tracked
if (!progress.completedIssues.includes(linearIssueId)) {
  progress.completedIssues.push(linearIssueId)
  progress.lastUpdated = new Date().toISOString()

  // Ensure directory exists and write progress
  Bash(`mkdir -p .claude/epics/${epicId}`)
  Write(progressFile, JSON.stringify(progress, null, 2))

  console.log(`💾 Progress saved: ${progress.completedIssues.length} tasks completed`)
}
```

#### 5.3 Update Linear Issue Status

```typescript
// Determine if epic or sub-task
const isEpic = linearDetails.children?.length > 0

// Update status
await mcp__linear__update_issue({
  id: linearIssueId,
  state: isEpic ? 'In Review' : 'Done'
})

console.log(`✅ Linear issue ${linearIdentifier} updated to ${isEpic ? 'In Review' : 'Done'}`)
```

#### 5.4 Create Completion Comment on Linear

```typescript
await mcp__linear__create_comment({
  issueId: linearIssueId,
  body: `
✅ Completed via /clive:build

**Files Modified:**
${listModifiedFiles()}

**Key Decisions:**
${extractKeyDecisions(scratchpad)}

**Learnings Documented:**
- Scratchpad: ${scratchpadPath}
- Global patterns: ${listGlobalPatternsDocumented()}

**Claude Task:** ${currentTask.id}
`
})
```

#### 5.5 Create Git Commit

```bash
# Stage modified files
git add [files...]

# Create commit with structured message
git commit -m "$(cat <<'EOF'
feat(${component}): ${taskTitle}

Implements: ${linearIdentifier}

${acceptanceCriteria}

Files modified:
${filesModified}

Key decisions:
${keyDecisions}
EOF
)"

echo "✅ Changes committed"
```

#### 5.6 Persist All Context Before Clearing

**CRITICAL: Before clearing context, ensure ALL learnings are persisted.**

```typescript
// Verify all context is saved to persistent files:
// 1. Scratchpad has current iteration documented
// 2. Global learnings updated (if applicable)
// 3. Progress file updated with completed task
// 4. Git commit created

console.log(`
📝 Persisting context before clear:
   - Scratchpad: ${scratchpadPath} ✅
   - Progress: .claude/epics/${epicId}/progress.json ✅
   - Learnings: .claude/learnings/*.md ✅
   - Git commit: Created ✅
`)
```

#### 5.7 Output Completion and Start Fresh

```bash
echo "<promise>TASK_COMPLETE</promise>"
```

#### 5.8 Clear Context and Continue to Next Task

**CRITICAL: You MUST call `/new` then `/clive:build` to continue the build loop.**

This two-step process:
1. **`/new`** - Clears conversation context completely (frees memory)
2. **`/clive:build`** - Starts fresh build iteration with clean state

**Your response MUST end with these two commands on separate lines:**

```
/new
/clive:build
```

**Why both commands are required:**
- `/new` clears the conversation context (memory management)
- `/clive:build` loads fresh context from persisted files (scratchpad, learnings, progress)
- All knowledge is preserved in files, not in conversation context
- This prevents memory bloat on long build sessions

**DO NOT** try to continue in the same context - always clear and restart.

## Global Learnings System

The global learnings system captures knowledge across all epics and tasks. This helps future agents avoid repeated mistakes and reuse successful patterns.

**Three Categories:**

1. **Error Patterns** (`.claude/learnings/error-patterns.md`)
   - Recurring errors and their solutions
   - Cross-epic knowledge base
   - Pattern: Symptom → Root Cause → Solution → Prevention

2. **Success Patterns** (`.claude/learnings/success-patterns.md`)
   - Reusable techniques that work well
   - Effective approaches and workflows
   - Pattern: Use Case → Implementation → Benefits → Examples

3. **Gotchas** (`.claude/learnings/gotchas.md`)
   - Codebase quirks and non-obvious behaviors
   - Surprises that took time to figure out
   - Pattern: What Happens → Why → How to Handle

For complete documentation guidelines, see `references/learnings-system.md`

## Skill References

Load these on demand when you need detailed workflow guidance:

- `references/skill-feature.md` - Feature implementation workflow (4 phases)
- `references/skill-bugfix.md` - Bug fix workflow with root cause analysis
- `references/skill-refactor.md` - Refactoring workflow with behavior preservation
- `references/skill-unit-tests.md` - Unit testing workflow
- `references/learnings-system.md` - Complete global learnings documentation

## Critical Rules

1. **ONE TASK AT A TIME** - Execute one task, then STOP
2. **MARK IN PROGRESS IMMEDIATELY** - Update both Claude Task and Linear issue
3. **FOLLOW SKILL WORKFLOW** - Load and follow the appropriate skill reference
4. **DOCUMENT LEARNINGS** - Scratchpad updates are MANDATORY
5. **VALIDATE BEFORE COMPLETION** - Check scratchpad was updated
6. **MARK DONE AFTER COMPLETION** - Update both Claude Task and Linear issue
7. **COMMIT CHANGES** - Create git commit with structured message

## Exit Conditions

**Task Complete → Clear & Continue:**
- Task successfully completed
- Scratchpad updated with full iteration details
- Global learnings updated (if applicable)
- Progress file updated
- Statuses updated in both Claude Tasks and Linear
- Git commit created
- Output: `<promise>TASK_COMPLETE</promise>`
- **ACTION: Call `/new` then `/clive:build` to continue**

**All Tasks Complete → Stop:**
- No more pending, unblocked tasks
- All work in epic is done
- Output: `<promise>ALL_TASKS_COMPLETE</promise>`
- **ACTION: Stop. Do NOT call `/new` or `/clive:build`.**
- Inform user: "All tasks complete! Use `/clive:plan` to plan new work."

**Error → Stop:**
- Validation failed
- Required documentation missing
- Task cannot be completed
- **ACTION: Stop. Do NOT call `/new` or `/clive:build`.**
- Report error to user with details.

## Context Files

**Per Epic:**
- `.claude/epics/{epic-id}/scratchpad.md` - Epic-specific learnings
- `.claude/epics/{epic-id}/progress.txt` - Iteration log
- `.claude/epics/{epic-id}/linear_issue_id.txt` - Parent Linear issue ID

**Global:**
- `.claude/learnings/error-patterns.md` - Cross-epic error knowledge
- `.claude/learnings/success-patterns.md` - Cross-epic success patterns
- `.claude/learnings/gotchas.md` - Cross-epic codebase quirks
- `.claude/.build-iteration` - Current iteration number
- `.claude/.build-max-iterations` - Maximum iterations (default: 50)

## Remember

You are executing ONE TASK at a time. Your job is to:

1. ✅ Fetch the next pending Claude Task (linked to Linear)
2. ✅ Read global learnings and epic context
3. ✅ Follow the appropriate skill workflow
4. ✅ Implement the solution with tests
5. ✅ Document learnings to scratchpad (MANDATORY)
6. ✅ Document to global learnings (if pattern is reusable)
7. ✅ Update progress file
8. ✅ Validate all documentation exists
9. ✅ Update both Claude Task and Linear issue status
10. ✅ Create git commit
11. ✅ Output completion marker
12. ✅ **CALL `/new` THEN `/clive:build` TO CONTINUE**

## CRITICAL: Clear Context Between Tasks

After completing each task, you MUST:
1. Persist ALL context to files (scratchpad, learnings, progress)
2. Call `/new` to clear conversation context
3. Call `/clive:build` to continue with fresh state

**Why this matters:**
- Conversation context consumes memory
- Long sessions will slow down or fail
- Files persist across context clears
- Each task starts clean but informed (via files)

**Example end of task:**
```
✅ Task TRI-2120 completed
💾 Progress saved: 3/8 tasks done
📝 Scratchpad updated: Iteration 3 documented
🧠 Learnings: Added error pattern for Effect-TS pipe handling

<promise>TASK_COMPLETE</promise>

🔄 Clearing context and continuing to next task...

/new
/clive:build
```

**STOP conditions (do NOT call `/new` or `/clive:build`):**
- All tasks complete: `<promise>ALL_TASKS_COMPLETE</promise>`
- Unrecoverable error
- User interruption (Ctrl+C)
