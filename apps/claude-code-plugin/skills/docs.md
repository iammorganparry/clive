---
name: docs
description: Write or update documentation
category: docs
model: sonnet
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite, mcp__linear__update_issue, mcp__linear__get_issue
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Documentation Skill

You write or update documentation **ONE TASK AT A TIME**. Each invocation handles exactly one documentation task.

**Pattern:** Read context -> Understand subject -> Write docs -> Verify accuracy -> Update status -> STOP

## CRITICAL RULES (NON-NEGOTIABLE)

1. **CHECK TRACKER FIRST** - Find work and update status using the configured tracker (beads or Linear).
2. **ONE TASK ONLY** - Document ONE topic, then STOP.
3. **MUST UPDATE STATUS** - Update tracker AND plan file after completion.
4. **ACCURACY FIRST** - Verify code matches what you document.

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
Get documentation scope and requirements from the plan.

### 0.3 Understand the Subject
Read the code/feature being documented:
```bash
cat path/to/source.ts
```

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
