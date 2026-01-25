# Clive Skills - Quick Start Guide

## Installation

Skills are already installed at `~/.claude/skills/`:
- ✅ `clive-plan/` - Agile planning with Linear integration
- ✅ `clive-build/` - Task execution with learnings capture

## Basic Usage

### 1. Plan New Work

```bash
claude /clive:plan "add user authentication"
```

**What happens:**
1. Claude interviews you (one question at a time)
2. Claude researches your codebase
3. Claude generates a plan with user stories
4. You approve the plan
5. Claude creates Linear issues + Claude Tasks

**Output:**
- Plan saved to `.claude/plans/{slug}.md`
- Issues created in Linear
- Tasks created in Claude Tasks (linked to Linear)

### 2. Execute Tasks

```bash
claude /clive:build
```

**What happens:**
1. Fetches next pending task from Claude Tasks
2. Loads global learnings and context
3. Implements the solution following the appropriate skill workflow
4. Documents learnings to scratchpad (MANDATORY)
5. Updates Linear + Claude Tasks
6. Commits code

**Run repeatedly until all tasks complete.**

### 3. Check Progress

```bash
# View all Claude Tasks
claude /tasks

# View Linear issues
linear list --assignee me

# Read accumulated learnings
cat .claude/learnings/error-patterns.md
cat .claude/learnings/success-patterns.md
cat .claude/learnings/gotchas.md
```

## Configuration

Create `~/.clive/config.json`:

```json
{
  "issue_tracker": "linear",
  "linear": {
    "team_id": "your-linear-team-uuid"
  }
}
```

Get your Linear team ID by running `claude` and asking: "What's my Linear team ID?"

## File Structure

After using the skills, you'll see:

```
.claude/
├── learnings/                   # Global learnings (all epics)
│   ├── error-patterns.md        # Recurring errors and solutions
│   ├── success-patterns.md      # Reusable techniques
│   └── gotchas.md               # Codebase quirks
├── epics/
│   └── {epic-id}/               # Per-epic context
│       ├── scratchpad.md        # Iteration learnings
│       ├── progress.txt         # Iteration log
│       └── linear_issue_id.txt  # Parent issue
└── plans/
    └── {feature-slug}.md        # Planning docs
```

## Complete Example

```bash
# 1. Plan a feature
claude /clive:plan "add Google OAuth login"
# ... answer interview questions ...
# ... review and approve plan ...
# ✅ Created 1 epic + 3 tasks

# 2. Execute tasks one by one
claude /clive:build
# ✅ Task 1 complete (User can authenticate with Google OAuth)

claude /clive:build
# ✅ Task 2 complete (User profile populated from Google data)

claude /clive:build
# ✅ Task 3 complete (Session management works)

claude /clive:build
# ✅ All tasks complete!

# 3. Check results
git log -3                       # See commits
linear issue TRI-123             # See Linear issue
cat .claude/epics/*/scratchpad.md  # See learnings
```

## Key Features

### /clive:plan
- 4-phase stakeholder interview
- Codebase research (finds similar patterns)
- User stories with acceptance criteria
- Creates Linear issues + Claude Tasks
- Links them via metadata

### /clive:build
- Fetches next task from Claude Tasks
- Loads global learnings automatically
- Uses progressive disclosure (4 skill types)
- MANDATORY scratchpad documentation
- Updates both Linear and Claude Tasks
- Creates structured git commits

## Benefits

**Knowledge Accumulation:**
- Learnings from Task 1 visible to Task 2
- Error patterns documented globally
- Success patterns reused automatically

**Bidirectional Sync:**
- Linear = source of truth
- Claude Tasks = execution tracking
- Both update automatically

**Enforced Quality:**
- Scratchpad validation blocks completion
- Structured templates ensure consistency
- Git commits link back to issues

## Troubleshooting

**"Linear MCP is not authenticated"**
```bash
claude
> "Authenticate with Linear"
```

**"No pending tasks"**
```bash
# Plan new work first
claude /clive:plan "next feature"
```

**"Scratchpad not updated"**
- Scratchpad updates are MANDATORY
- Use the structured template provided
- See docs/clive-skills.md for template

## Learn More

- **Full Documentation:** `docs/clive-skills.md`
- **Skill Files:** `~/.claude/skills/clive-*/`
- **Reference Workflows:** `~/.claude/skills/clive-build/references/`

## Quick Reference Card

| Command | Purpose | Model |
|---------|---------|-------|
| `/clive:plan "feature"` | Plan new work | Opus |
| `/clive:build` | Execute next task | Sonnet |
| `/tasks` | View progress | - |

| File | Purpose |
|------|---------|
| `.claude/plans/*.md` | Planning docs |
| `.claude/learnings/*.md` | Global knowledge |
| `.claude/epics/*/scratchpad.md` | Epic learnings |

**Remember:** Run `/clive:build` repeatedly until you see `<promise>ALL_TASKS_COMPLETE</promise>`
