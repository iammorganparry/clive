# Clive Skills: /clive:plan and /clive:build

## Overview

Two Claude Code skills that provide agile planning and task execution capabilities directly from the terminal, integrated with Linear and Claude's native Tasks system.

**Created:** 2026-01-23
**Location:** `~/.claude/skills/`

## Skills

### 1. `/clive:plan` - Agile Planning

**Purpose:** Agile project management and planning with Linear + Claude Tasks integration.

**Location:** `~/.claude/skills/clive-plan/`

**What it does:**
- Conducts structured 4-phase stakeholder interviews
- Researches codebase for patterns and examples
- Generates user stories with acceptance criteria
- Creates issues in Linear
- Creates corresponding Claude Tasks for execution tracking
- Saves comprehensive plan to `.claude/plans/{slug}.md`

**Usage:**
```bash
claude /clive:plan "add user authentication with OAuth"
```

**Workflow:**
1. **Interview** - Asks questions one at a time to understand requirements
2. **Research** - Explores codebase to find similar implementations
3. **Generate Plan** - Creates plan with user stories and technical notes
4. **Get Approval** - Presents plan and waits for user confirmation
5. **Create Issues** - Creates Linear issues + Claude Tasks, links them via metadata

**Output:**
- Plan file: `.claude/plans/{feature-slug}.md`
- Linear issues (epic + tasks)
- Claude Tasks (linked to Linear via metadata)
- Summary with IDs and next steps

**Model:** Opus (for comprehensive planning and research)

### 2. `/clive:build` - Task Execution

**Purpose:** Execute tasks with automatic knowledge capture and Linear sync.

**Location:** `~/.claude/skills/clive-build/`

**What it does:**
- Fetches next pending Claude Task (linked to Linear)
- Loads global learnings and epic context
- Executes using appropriate skill workflow (feature/bugfix/refactor/tests)
- Documents learnings to scratchpad (MANDATORY)
- Updates both Claude Task and Linear issue status
- Creates git commits
- Captures knowledge for future iterations

**Usage:**
```bash
claude /clive:build
```

**Workflow:**
1. **Fetch Next Task** - Uses `TaskList()` to find pending tasks
2. **Read Context** - Loads global learnings + epic scratchpad
3. **Execute Task** - Follows appropriate skill workflow (loaded from references/)
4. **Document Learnings** - Updates scratchpad with structured template
5. **Validate and Complete** - Checks documentation, updates statuses, commits

**Progressive Disclosure:**

The skill loads detailed workflows on demand from `references/`:

- `skill-feature.md` (649 lines) - Feature implementation with 4 phases
- `skill-bugfix.md` (555 lines) - Bug fix with root cause analysis
- `skill-refactor.md` (625 lines) - Refactoring with behavior preservation
- `skill-unit-tests.md` (477 lines) - Unit testing workflow
- `learnings-system.md` (366 lines) - Global learnings documentation

**Model:** Sonnet (for efficient task execution)

## Architecture

### Claude Tasks + Linear Integration

**Key Principle:** Linear is the source of truth, Claude Tasks are execution wrappers.

```
Linear Issues (source of truth)
       ↓
Claude Tasks (execution tracking)
       ↓
/clive:build (agent execution)
       ↓
Updates both systems
```

**Task Metadata Schema:**

```typescript
interface CliveTaskMetadata {
  // Linear integration
  linearIssueId: string        // UUID
  linearIdentifier: string     // e.g., "TRI-123"
  linearTeamId: string         // Team UUID

  // Execution context
  skill: 'feature' | 'bugfix' | 'refactor' | 'unit-tests'
  epic?: string                // Epic/parent ID
  complexity?: number          // 1-10

  // Learnings tracking
  scratchpadPath: string       // Path to epic scratchpad
}
```

### Global Learnings System

Knowledge base that accumulates across all epics and tasks.

**File Structure:**
```
.claude/
├── learnings/                   # Global (cross-epic) learnings
│   ├── error-patterns.md        # Recurring errors and solutions
│   ├── success-patterns.md      # Reusable techniques
│   └── gotchas.md               # Codebase quirks
├── epics/
│   └── {epic-id}/               # Per-epic context
│       ├── scratchpad.md        # Epic-specific learnings
│       ├── progress.txt         # Iteration log
│       └── linear_issue_id.txt  # Parent Linear issue
└── plans/
    └── {feature-slug}.md        # Comprehensive plans
```

**Three Categories:**

1. **Error Patterns** - Recurring errors, root causes, solutions
2. **Success Patterns** - Reusable techniques that work well
3. **Gotchas** - Codebase quirks and non-obvious behaviors

**Scratchpad Template:**

```markdown
---
## Iteration [N] - [Linear ID] [Task Title]
**Completed:** 2026-01-23 14:30
**Status:** Completed
**Claude Task ID:** task-123

### ✅ What Worked
- [Successful approach]

### ❌ What Didn't Work / Blockers
- [Failed approach and why]

### 🧠 Key Decisions & Rationale
- [Decision]: [Reasoning]

### 📝 Files Modified
- `path/to/file.ts` - [What changed]

### ⚠️ Gotchas for Next Agent
- [Tricky codebase parts]

### 🎯 Success Patterns
- [Reusable patterns]

### 📊 Metrics
- Tests: 15 passed / 15 total
- Build time: 3.2s
- Lines changed: +87 -12

### 🔄 Post-Task Reflection
**Most Effective:** [technique]
**Slowed By:** [bottleneck]
**Test Coverage:** adequate
**Reusable Pattern:** [pattern]
**Would Do Differently:** [improvement]
**Learned:** [insight]
```

## Workflow Example

### Complete Planning → Execution Flow

**1. Planning:**
```bash
# User runs planning skill
claude /clive:plan "add OAuth authentication"

# Claude conducts interview (4 phases)
# Claude researches codebase
# Claude generates plan
# Claude asks for approval
# Claude creates Linear issues + Claude Tasks

# Output:
# Created 1 epic + 5 tasks in Linear
# Created 6 Claude Tasks (linked)
# Plan saved to .claude/plans/oauth-authentication.md
```

**2. Execution:**
```bash
# User runs build skill (repeatedly)
claude /clive:build

# Iteration 1:
# - Fetches Task 1 from TaskList()
# - Loads global learnings
# - Executes feature workflow
# - Documents to scratchpad
# - Updates Linear + Claude Task
# - Commits code
# - Outputs: <promise>TASK_COMPLETE</promise>

# Iteration 2:
# - Fetches Task 2 from TaskList()
# - Sees Task 1's learnings in scratchpad
# - Reuses patterns from Task 1
# - ...continues...

# Iteration 6:
# - No more pending tasks
# - Outputs: <promise>ALL_TASKS_COMPLETE</promise>
```

**3. Progress Tracking:**
```bash
# User checks progress
claude /tasks

# Shows:
# - 5 completed tasks
# - 1 in progress
# - 0 pending
```

## Benefits

### vs. TUI Approach

**Simpler Interface:**
- Direct terminal commands vs TUI wrapper
- Works like native Claude Code skills
- No TUI state management needed

**Better Integration:**
- Uses Claude's native Tasks system
- Leverages built-in task UI
- Natural skill composition

**Easier Development:**
- Self-contained skills
- Standard packaging/distribution
- No TUI-specific code

### vs. Manual Workflow

**Automated Context:**
- Global learnings loaded automatically
- Epic scratchpad visible to all tasks
- No need to manually track context

**Enforced Documentation:**
- Scratchpad validation blocks completion
- Structured templates ensure consistency
- Knowledge accumulates over time

**Bidirectional Sync:**
- Linear issues update automatically
- Claude Tasks track progress
- Git commits link back to Linear

## File Statistics

```
Total Skills: 2
Total Lines: 3,895

clive-plan:
  SKILL.md: 707 lines (22KB)
  Total: 707 lines

clive-build:
  SKILL.md: 516 lines (15KB)
  references/skill-feature.md: 649 lines (19KB)
  references/skill-bugfix.md: 555 lines (16KB)
  references/skill-refactor.md: 625 lines (18KB)
  references/skill-unit-tests.md: 477 lines (14KB)
  references/learnings-system.md: 366 lines (10KB)
  Total: 3,188 lines
```

## Design Decisions

### Why Two Skills vs One?

**Separation of Concerns:**
- Planning requires exploration, research, iteration
- Execution requires focus, speed, pattern following
- Different tool permissions (plan can't write code)
- Different models (Opus for planning, Sonnet for execution)

### Why Progressive Disclosure for /clive:build?

**Token Efficiency:**
- Main SKILL.md: ~500 lines (workflow overview)
- Reference files: 300-650 lines each (loaded on demand)
- Saves ~1,500 lines of unused context per execution
- Four skill types mean 75% of skill content never needed

### Why Not Progressive Disclosure for /clive:plan?

**Cohesive Workflow:**
- All five phases always executed in order
- No optional paths or variants
- Interview → Research → Write → Approve → Create
- Better to have complete workflow visible than split

### Why Claude Tasks Integration?

**Native Features:**
- Built-in task management UI
- Automatic dependency tracking (blockedBy/blocks)
- Better progress visualization
- Cleaner API than custom tracking

**Linear as Source of Truth:**
- Claude Tasks = execution layer
- Linear = requirements/tracking
- Clear separation of concerns
- Bidirectional sync possible

## Installation

Skills are already installed at:
- `~/.claude/skills/clive-plan/`
- `~/.claude/skills/clive-build/`

To use in other projects or distribute, see "Packaging" section below.

## Usage

### Planning New Work

```bash
# Start planning session
claude /clive:plan "feature description"

# Claude will:
# 1. Interview you (4 phases)
# 2. Research codebase
# 3. Generate plan
# 4. Ask for approval
# 5. Create Linear issues + Claude Tasks

# Output includes:
# - Plan file path
# - Linear issue IDs
# - Claude Task IDs
# - Next steps
```

### Executing Tasks

```bash
# Execute next task
claude /clive:build

# Claude will:
# 1. Fetch next pending Claude Task
# 2. Load global learnings + epic context
# 3. Execute using appropriate skill
# 4. Document learnings
# 5. Update statuses
# 6. Commit code
# 7. Output: <promise>TASK_COMPLETE</promise>

# Run again for next task
claude /clive:build

# Continue until all complete
# Output: <promise>ALL_TASKS_COMPLETE</promise>
```

### Checking Progress

```bash
# View all tasks
claude /tasks

# View specific task
claude /task {task-id}

# View Linear issues
linear list --assignee me

# Read learnings
cat .claude/learnings/error-patterns.md
cat .claude/learnings/success-patterns.md
cat .claude/learnings/gotchas.md
```

## Configuration

### Linear Setup

Required configuration in `~/.clive/config.json`:

```json
{
  "issue_tracker": "linear",
  "linear": {
    "team_id": "your-team-uuid"
  }
}
```

Get team ID:
```bash
# Using Linear MCP
claude
> "What's my Linear team ID?"
```

### Environment Variables

Skills automatically use these if available:
- `LINEAR_TEAM_ID` - Linear team UUID
- `CLIVE_PLAN_FILE` - Override plan file path
- `CLIVE_TRACKER` - Override tracker (linear/beads)

## Packaging

### Create Distributable .skill Files

If skill-creator's package_skill.py is available:

```bash
cd ~/.claude/skills/

# Package clive-plan
python /path/to/skill-creator/scripts/package_skill.py clive-plan/
# Creates: clive-plan.skill

# Package clive-build
python /path/to/skill-creator/scripts/package_skill.py clive-build/
# Creates: clive-build.skill
```

### Install from Package

```bash
# Install .skill file
claude skill install clive-plan.skill
claude skill install clive-build.skill
```

## Verification

### Test /clive:plan

```bash
# Test planning workflow
claude /clive:plan "add simple feature"

# Verify:
# - Interview runs (4 phases)
# - Codebase research executes
# - Plan file created at .claude/plans/*.md
# - Linear issues created
# - Claude Tasks created
# - Metadata links Linear ↔ Claude Tasks
```

### Test /clive:build

```bash
# Test execution workflow
claude /clive:build

# Verify:
# - Fetches next task from TaskList()
# - Loads global learnings
# - Executes appropriate skill workflow
# - Scratchpad updated with structured template
# - Validation passes
# - Both systems updated (Linear + Claude Tasks)
# - Git commit created
# - Output: <promise>TASK_COMPLETE</promise>
```

### Test Full Integration

```bash
# 1. Plan a feature
claude /clive:plan "test integration feature"

# 2. Execute first task
claude /clive:build

# 3. Check learnings were captured
cat .claude/epics/*/scratchpad.md

# 4. Execute second task (should see first task's learnings)
claude /clive:build

# 5. Verify second task references first task's patterns

# 6. Continue until complete
claude /clive:build  # Repeat until ALL_TASKS_COMPLETE
```

## Troubleshooting

### Linear Authentication

**Problem:** "Linear MCP is not authenticated"

**Solution:**
```bash
# Authenticate with Linear MCP
claude
> "Authenticate with Linear"

# Follow authentication flow
# Then retry build
```

### Missing Scratchpad

**Problem:** "ERROR: Scratchpad not updated"

**Solution:**
- Scratchpad updates are MANDATORY
- Use the structured template from Step 4.1
- Validation blocks completion without proper documentation

### Task Not Found

**Problem:** "No pending tasks"

**Solution:**
```bash
# Check Claude Tasks
claude /tasks

# Check Linear issues
linear list --assignee me

# If no tasks exist, plan new work
claude /clive:plan "next feature"
```

### Skill Not Found

**Problem:** "Skill not found: clive:plan"

**Solution:**
```bash
# Check skill installation
ls ~/.claude/skills/clive-*

# Reinstall if needed
# (Copy skills from this repo)
```

## Migration from TUI

### Gradual Transition

**Option A: Keep Using TUI**
- Existing TUI commands still work
- No migration required
- Can use skills alongside TUI

**Option B: Use Skills**
- Install `/clive:plan` and `/clive:build`
- Use directly in terminal
- Benefits from Claude Tasks integration

**Option C: Hybrid**
- Use `/clive:plan` for planning
- Use TUI `/build` for execution (if preferred)
- Mix and match as needed

### Key Differences

| Feature | TUI | Skills |
|---------|-----|--------|
| Interface | TUI wrapper | Direct terminal |
| Task Tracking | Linear only | Claude Tasks + Linear |
| Learnings | File-based | File-based (same) |
| Scratchpad | Optional | Mandatory (validated) |
| Progressive Disclosure | No | Yes (build skill) |
| Model | Configurable | Opus (plan) + Sonnet (build) |

## Future Enhancements

### Planned Improvements

1. **Task Dependencies** - Leverage Claude Tasks `blockedBy`/`blocks`
2. **Epic Filtering** - Filter tasks by epic: `claude /clive:build --epic AUTH-123`
3. **Parallel Execution** - Run multiple tasks concurrently
4. **Learning Analytics** - Analyze patterns to suggest improvements
5. **Custom Skills** - Support project-specific skill workflows

### Feedback

File issues at: https://github.com/anthropics/claude-code/issues

Tag: `@clive-skills`

## Credits

**Created:** 2026-01-23
**Author:** Morgan Parry
**Based on:** Clive TUI build system
**Integrated with:** Claude Code Tasks, Linear MCP

## License

MIT (same as Clive project)

---

**Quick Start:**

```bash
# Plan new work
claude /clive:plan "your feature request"

# Execute tasks
claude /clive:build  # Repeat until complete

# Check progress
claude /tasks
```

**Remember:** Linear is source of truth, Claude Tasks are execution tracking. Both systems stay in sync automatically.
