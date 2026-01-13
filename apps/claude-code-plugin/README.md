# Clive - Claude Code Plugin

AI-powered work planning and execution using the Ralph Wiggum loop pattern with skill-based dispatch.

## Quick Start

```bash
# 1. Load the plugin
claude --plugin-dir ./apps/claude-code-plugin

# 2. Create a work plan with category detection
/clive plan "add tests for auth module"   # Detects: test/unit-tests
/clive plan "fix the login bug"           # Detects: bugfix/bugfix
/clive plan "refactor the API client"     # Detects: refactor/refactor

# 3. Review the generated plan at .claude/work-plan-[branch].md

# 4. Execute work tasks with automatic skill selection
/clive build

# 5. Loop runs automatically until all tasks are complete
# Use /clive cancel to stop early if needed

# 6. Check progress at any time
/clive status
```

## Installation

```bash
# From this repository
claude --plugin-dir ./apps/claude-code-plugin

# Or install globally via CLI
./apps/cli/install.sh
clive plan "your request"
```

## Commands

### `/clive plan [branch | request]`

Analyzes files and creates a work plan with category detection and skill assignment.

```bash
# Mode A: Plan for uncommitted/branch changes
/clive plan

# Mode B: Plan for changes since a specific branch
/clive plan develop

# Mode C: Plan based on a custom request
/clive plan add tests for the authentication module
/clive plan fix the login bug in session handling
/clive plan refactor the API client for better testability
```

**Category Detection:**

| Category | Keywords | Default Skill |
|----------|----------|---------------|
| test | test, coverage, spec, unit, integration, e2e | unit-tests |
| bugfix | fix, bug, issue, broken, crash, error | bugfix |
| refactor | refactor, clean, extract, restructure | refactor |
| docs | doc, readme, comment, documentation | docs |
| feature | (default) | feature |

### `/clive build [options]`

Executes work tasks from the plan with automatic skill selection.

```bash
# Use the latest plan
/clive build

# Run single iteration (for testing)
/clive build --once

# Force a specific skill
/clive build --skill unit-tests

# Set iteration limit
/clive build --max-iterations 100
```

**Options:**
- `--once` - Run single iteration
- `--max-iterations N` - Set max iterations (default: 50)
- `--fresh` - Clear progress file before starting
- `--skill SKILL` - Override skill detection
- `-i, --interactive` - Keep stdin open for manual interaction

### `/clive test [options]` (deprecated)

Alias for `/clive build`. Maintained for backwards compatibility.

### `/clive cancel`

Cancels the active build loop.

### `/clive status`

Shows all available work plans, loop progress, beads task status, and recent Claude Code context.

## Skills System

Skills define how specific types of work are executed. Each task in a plan has an assigned skill that determines execution approach.

### Available Skills

| Skill | Category | Description |
|-------|----------|-------------|
| `unit-tests` | test | Implement unit tests using project test framework |
| `integration-tests` | test | Implement integration tests with real dependencies |
| `e2e-tests` | test | Implement end-to-end tests with browser automation |
| `feature` | feature | Implement new features according to plan |
| `refactor` | refactor | Restructure code without changing behavior |
| `bugfix` | bugfix | Fix bugs with root cause analysis |
| `docs` | docs | Write or update documentation |

### How Skills Work

1. **Planning phase**: `plan.md` detects category and assigns skills to tasks
2. **Beads integration**: Skills are stored as task labels (`skill:unit-tests`)
3. **Build execution**: `build.sh` reads skill from task and loads appropriate skill file
4. **Skill execution**: Claude follows skill-specific instructions for the task type

## Key Features

### Category Detection

The planner automatically detects work type from request keywords:

```bash
/clive plan "add tests for user validation"     # → test/unit-tests
/clive plan "fix the login timeout bug"          # → bugfix/bugfix
/clive plan "refactor the API client"            # → refactor/refactor
/clive plan "document the deployment process"    # → docs/docs
/clive plan "implement user settings"            # → feature/feature
```

### Skill-Based Dispatch

Each skill provides:
- **Execution instructions** - How to approach the work
- **Completion criteria** - What "done" looks like
- **Verification steps** - How to validate completion
- **Common pitfalls** - Skill-specific gotchas

### Beads Task Integration

When beads (`bd`) is available:
- Tasks are tracked with skill labels
- `bd ready` shows tasks ready to work on
- `bd close` marks tasks complete
- Progress survives across sessions

### Playwright MCP Integration (E2E Debugging)

Included **Playwright MCP** provides live browser access for debugging e2e test failures:

| Tool | Purpose |
|------|---------|
| `browser_navigate` | Go to URLs |
| `browser_snapshot` | Get DOM/accessibility tree |
| `browser_take_screenshot` | Capture visual state |
| `browser_console_messages` | See JS console output |
| `browser_network_requests` | Inspect API calls |

## Work Plan Format

Plans use this structure:

```markdown
# Work Plan

Generated: 2024-01-15
Branch: feature/auth
Mode: custom-request
Request: add tests for authentication module

## Discovery Summary

**Category:** test
**Default Skill:** unit-tests
**Test Framework:** vitest
**Build System:** npm

---

## Tasks

### Task 1: User Authentication Tests
- [ ] **Status:** pending
- **Category:** test
- **Skill:** unit-tests
- **Target:** `src/auth/__tests__/auth.spec.ts`
- **Details:**
  - Test valid credentials
  - Test invalid password
  - Test network errors

## Beads Integration

**Beads available:** yes
**Epic:** bd-abc123 (feature-auth Work Plan - 2024-01-15)
**Tasks:**
| Task | Skill | Beads ID | Status |
|------|-------|----------|--------|
| User Authentication Tests | unit-tests | bd-abc123.1 | pending |
```

## The Ralph Wiggum Loop

> "Iteration over perfection" - Don't aim for perfect on the first try. Keep iterating until success.

**How it works:**

1. **Planning Phase** (`/clive plan`)
   - Detects work category from request
   - Assigns skills to each task
   - Creates beads tasks with skill labels
   - User reviews and approves

2. **Execution Phase** (`/clive build`)
   - Reads skill from next ready task
   - Loads skill file for execution instructions
   - Implements ONE task
   - Updates status in beads AND plan file
   - Automatically continues to next task

3. **Completion**
   - All tasks marked complete/blocked
   - Final summary provided

### Stop Conditions

The build loop stops when ANY of these are met:

| # | Condition | Trigger |
|---|-----------|---------|
| 1 | **All Complete** | `<promise>ALL_TASKS_COMPLETE</promise>` in output |
| 2 | **User Cancellation** | `/clive cancel` command |
| 3 | **Max Iterations** | Reaches `--max-iterations` (default: 50) |
| 4 | **Plan Not Found** | Plan file missing |
| 5 | **Task Blocked** | Task marked `blocked` |
| 6 | **No Remaining Work** | Zero pending + zero in_progress |

## File Structure

```
.claude/
├── work-plan-[branch].md      # Work plan for specific branch
├── work-plan-latest.md        # Symlink to most recent plan
├── .test-plan-path            # Current plan path (for stop-hook)
├── .test-loop-state           # Current iteration count
└── .cancel-test-loop          # Cancellation flag (temporary)

apps/claude-code-plugin/
├── commands/
│   ├── plan.md                # Planning agent prompt
│   ├── status.md              # Status command
│   └── cancel.md              # Cancel command
├── skills/
│   ├── unit-tests.md          # Unit testing skill
│   ├── integration-tests.md   # Integration testing skill
│   ├── e2e-tests.md           # E2E testing skill
│   ├── feature.md             # Feature implementation skill
│   ├── refactor.md            # Refactoring skill
│   ├── bugfix.md              # Bug fixing skill
│   └── docs.md                # Documentation skill
└── hooks/
    └── stop-hook.sh           # Loop continuation logic
```

## Command Reference

| Command | Description |
|---------|-------------|
| `/clive plan` | Create work plan from git changes |
| `/clive plan <branch>` | Create plan comparing against branch |
| `/clive plan <request>` | Create plan from custom request |
| `/clive build` | Execute next task from plan |
| `/clive build --once` | Run single iteration |
| `/clive build --skill SKILL` | Force specific skill |
| `/clive cancel` | Cancel active build loop |
| `/clive status` | Show plans and progress |

## Troubleshooting

### "No plan found"
Run `/clive plan` first:
```bash
/clive plan "your work request"
```

### Wrong skill being used
Force specific skill:
```bash
/clive build --skill unit-tests
```

### Loop won't stop
Use cancel command:
```bash
/clive cancel
```

### Max iterations reached
Increase the limit:
```bash
/clive build --max-iterations 200
```

## License

MIT
