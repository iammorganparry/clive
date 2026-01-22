---
name: docs
description: Write or update documentation
category: docs
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__list_issues, mcp__linear__update_issue, mcp__linear__get_issue, mcp__linear__create_comment
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Documentation Skill

You write or update documentation **ONE TASK AT A TIME**. Each invocation handles exactly one documentation task.

**Pattern:** Read context -> Understand subject -> Write docs -> Verify accuracy -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **MARK IN PROGRESS IMMEDIATELY** - Update tracker status to "In Progress" before writing documentation.
3. **ONE TASK ONLY** - Document ONE topic, then STOP.
4. **MARK DONE AT COMPLETION** - Update tracker status to "Done" after documentation complete.
5. **BOTH STATUS TRANSITIONS REQUIRED** - Must call status update at START and at COMPLETION.
6. **ACCURACY FIRST** - Verify code matches what you document.

---

## Step 0: Verify Task Information

**Before writing documentation, ensure you have task details:**

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
Get documentation scope and requirements from the plan.

### 0.5.3 Understand the Subject
Read the code/feature being documented:
```bash
cat path/to/source.ts
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

## Step 2: Write Documentation

### 2.1 Documentation Types

**API Documentation:**
```markdown
## `functionName(param1, param2)`

Description of what the function does.

### Parameters

| Name | Type | Description |
|------|------|-------------|
| param1 | string | Description |
| param2 | number | Description |

### Returns

`ReturnType` - Description

### Example

\`\`\`typescript
const result = functionName("value", 42);
\`\`\`
```

**README / Getting Started:**
```markdown
# Project Name

Brief description.

## Installation

\`\`\`bash
npm install project-name
\`\`\`

## Quick Start

\`\`\`typescript
import { something } from 'project-name';
// Example usage
\`\`\`

## Features

- Feature 1
- Feature 2
```

**Architecture Documentation:**
```markdown
# Architecture

## Overview

High-level description of the system.

## Components

### Component A
Description and responsibilities.

### Component B
Description and responsibilities.

## Data Flow

Describe how data moves through the system.
```

### 2.2 Quality Rules

- **Accurate** - Verify all code examples work
- **Complete** - Cover all important aspects
- **Clear** - Use simple language, avoid jargon
- **Examples** - Include working code examples
- **Up to date** - Match current code, not old versions

---

## Step 3: Verify Documentation Accuracy

### Test Code Examples
```bash
# If examples can be run, verify they work
npm run build
```

### Cross-Reference with Code
Ensure:
- Function signatures match actual code
- Parameter types are correct
- Return types are accurate
- Examples use correct API

---

## Discovered Work Protocol

**During documentation, you may discover work outside the current task's scope:**

- Bugs in the code you're documenting
- Missing or broken tests
- Code that needs refactoring
- Additional documentation needs
- Outdated dependencies

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
- **Continue with your current documentation task** - do not switch focus
- The new task will be picked up in a future iteration

---

## Step 4: Mark Task Complete (REQUIRED - DO NOT SKIP)

**Before outputting TASK_COMPLETE marker, you MUST:**

1. Verify documentation is accurate and complete
2. Confirm all code examples work
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
git commit -m "docs: [brief description of documentation added/updated]

Task: [TASK_ID or task name]
Skill: docs"
```

**Note:** Local commits only - do NOT push. Push at session end or user request.

---

## Step 4.6: Update Scratchpad (REQUIRED)

**Before outputting the completion marker, update the scratchpad for the next agent:**

```bash
cat >> .claude/scratchpad.md << 'SCRATCHPAD'

## [Task Title]
**Completed:** [timestamp]

### Documentation Added
- [What was documented]

### Files Modified
- [Doc files created/modified]

### Notes for Next Agent
- [Related docs that may need updating]
- [Code areas that lack documentation]

SCRATCHPAD
```

---

## Step 5: Output Completion Marker

**Final checklist before outputting marker:**

- [ ] Documentation is accurate and complete
- [ ] Tracker status updated to "Done" (mcp__linear__update_issue or bd close called successfully)
- [ ] Git commit created
- [ ] Scratchpad updated

```
Task "[name]" complete. Documentation written and verified.
<promise>TASK_COMPLETE</promise>
```

**STOP IMMEDIATELY after outputting the marker.**

---

## Common Pitfalls

- **Outdated examples** - Always verify code examples work
- **Missing context** - Explain why, not just what
- **Too technical** - Write for your audience
- **Incomplete** - Cover edge cases and errors
- **No examples** - Working examples are essential
