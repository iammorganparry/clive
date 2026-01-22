# Clive Skills

Skills define how to execute specific types of work in the Clive build loop. Each skill is a markdown file with execution instructions for Claude.

## How Skills Work

1. **Beads tasks carry skill metadata** via labels: `skill:unit-tests`
2. **build.sh reads the skill** from the next ready task
3. **Skill file is loaded** and included in the prompt to Claude
4. **Claude executes** using the skill-specific instructions

## Skill File Format

```yaml
---
name: skill-name
description: What this skill does
category: test|feature|refactor|bugfix|docs|chore
model: sonnet|opus
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, TodoWrite
completion-marker: <promise>TASK_COMPLETE</promise>
all-complete-marker: <promise>ALL_TASKS_COMPLETE</promise>
---

# Skill Name

[Execution instructions for Claude...]
```

## Available Skills

| Skill | Category | Description |
|-------|----------|-------------|
| `unit-tests` | test | Implement unit tests using project test framework |
| `integration-tests` | test | Implement integration tests with real dependencies |
| `e2e-tests` | test | Implement end-to-end tests with browser automation |
| `feature` | feature | Implement new features according to plan |
| `refactor` | refactor | Restructure code without changing behavior |
| `bugfix` | bugfix | Fix bugs with root cause analysis |
| `docs` | docs | Write or update documentation |

## Creating Custom Skills

1. Create a new `.md` file in this directory
2. Add the YAML frontmatter with required fields
3. Write execution instructions following the pattern of existing skills
4. Reference in plan.md when assigning skills to tasks

## Key Principles

- **One task per iteration** - Each skill execution handles ONE task
- **Must update status** - Skills must update beads and plan file on completion
- **Verification required** - Skills should verify work before marking complete
- **Self-contained** - Each skill file has all instructions needed for execution
