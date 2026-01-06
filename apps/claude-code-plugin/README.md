# Clive - Claude Code Plugin

AI-powered test planning and execution using the Ralph Wiggum loop pattern.

## Quick Start

```bash
# 1. Load the plugin
claude --plugin-dir ./apps/claude-code-plugin

# 2. Create a test plan for your current changes
/clive plan

# 3. Review the generated plan at .claude/test-plan-[branch].md

# 4. Implement tests one suite at a time
/clive test

# 5. Continue until all suites are complete
/clive test
/clive test
# ... repeat until done

# 6. Check progress at any time
/clive status
```

## Installation

```bash
# From this repository
claude --plugin-dir ./apps/claude-code-plugin

# Or install globally (coming soon)
# claude plugins install clive
```

## Commands

### `/clive plan [branch | request]`

Analyzes files and creates a comprehensive test plan. Supports three modes:

```bash
# Mode A: Plan tests for uncommitted/branch changes
/clive plan

# Mode B: Plan tests for changes since a specific branch
/clive plan develop

# Mode C: Plan tests based on a custom request
/clive plan add tests for the authentication module
/clive plan improve coverage for src/utils/
/clive plan test error handling in the API client
```

**Mode detection:** The agent automatically detects whether your argument is a valid git branch name or a custom request.

**What it does:**
1. **Discovers Claude Code context** - Reads recent plans from `~/.claude/plans/` to understand what you were implementing
2. **Generates predictable file names** - Creates `.claude/test-plan-[branch].md` based on your current branch
3. **Identifies target files** - Via git diff (Mode A/B) or by parsing your custom request (Mode C)
4. **Reads and analyzes** each target file
5. **Asks clarifying questions** when intent is unclear
6. **Recommends refactors** for hard-to-test code
7. **Creates a detailed test plan** with mock dependencies and test cases

### `/clive test [plan-path]`

Implements tests from the approved plan, one suite at a time.

```bash
# Use the latest plan
/clive test

# Use a specific plan file
/clive test .claude/test-plan-feature-auth.md
```

**The Ralph Wiggum Pattern:**
- Works on ONE test suite per invocation
- Tracks progress in the plan file
- User runs `/clive test` again to continue
- Continues until all suites are complete or max iterations reached

**Why one suite at a time?**
- Prevents runaway execution
- Allows user oversight between suites
- Makes debugging easier
- Progress is always visible

### `/clive cancel`

Cancels the active test loop.

```bash
/clive cancel
```

### `/clive status`

Shows all available test plans, loop progress, and recent Claude Code context.

```bash
/clive status
```

## Key Features

### Claude Code Context Integration

The planning agent automatically checks `~/.claude/plans/` for recent plans from your Claude Code sessions. This provides context about:
- What feature you were implementing
- Architectural decisions made
- Files that were modified
- Any testing notes from the original plan

### Proactive Questioning

The planning agent **asks clarifying questions** when:
- Change intent is ambiguous
- Multiple testing approaches are valid
- Scope is unclear
- Expected behavior can't be determined from code

### Testability Recommendations

The agent identifies and recommends refactors for:
- **Hard-coded dependencies** → Dependency injection
- **God functions/classes** → Split into smaller units
- **Tight coupling** → Interface extraction
- **Global state** → Explicit state passing
- **Mixed side effects** → Separate pure logic

### Predictable Plan File Names

Plans are named based on your branch:
- `feature/auth` → `.claude/test-plan-feature-auth.md`
- `fix/bug-123` → `.claude/test-plan-fix-bug-123.md`
- `main` → `.claude/test-plan-main.md`

A symlink `.claude/test-plan-latest.md` always points to the most recent plan.

## The Ralph Wiggum Loop

This plugin implements the "Ralph Wiggum" approach to AI coding:

> "Iteration over perfection" - Don't aim for perfect on the first try. Keep iterating until success.

**How it works:**

1. **Planning Phase** (`/clive plan`)
   - Discovers context from Claude Code plans
   - Thorough code analysis
   - Asks clarifying questions
   - Recommends refactors for testability
   - Creates comprehensive test plan
   - User reviews and approves

2. **Execution Phase** (`/clive test`)
   - Implements ONE test suite
   - Verifies tests pass
   - Updates plan with progress
   - User runs again for next suite

3. **Completion**
   - All suites marked complete/failed
   - Final summary provided

**Key Features:**
- **Progress tracking** via branch-based plan files
- **Multiple plan support** - work on different branches simultaneously
- **Clear stop conditions** - 5 automatic stop triggers (see below)
- **Iteration limits** (default: 50, configurable via `CLIVE_MAX_ITERATIONS`)
- **Cancellation** via `/clive cancel`
- **Resume capability** - pick up where you left off

### Stop Conditions

The test loop automatically stops when ANY of these conditions are met:

| # | Condition | Trigger |
|---|-----------|---------|
| 1 | **All Complete** | All suites marked `complete` or `failed` |
| 2 | **User Cancellation** | `.claude/.cancel-test-loop` file exists (via `/clive cancel`) |
| 3 | **Max Iterations** | Iteration count reaches `CLIVE_MAX_ITERATIONS` (default: 50) |
| 4 | **Plan Not Found** | Plan file is missing or deleted |
| 5 | **No Remaining Work** | Zero pending + zero in_progress suites |

### Max Iterations

```bash
# Default: 50 iterations

# Configure via argument (recommended):
/clive test --max-iterations 100  # For large test suites
/clive test --max-iterations 20   # For faster feedback

# Or via environment variable (fallback):
export CLIVE_MAX_ITERATIONS=100
```

**Priority:** `--max-iterations` arg > `CLIVE_MAX_ITERATIONS` env > default (50)

## Test Plan Format

Test plans use this structure:

```markdown
# Test Plan

Generated: 2024-01-15
Branch: feature/auth
Mode: git-changes | branch-diff | custom-request
Request: N/A (or custom request text if Mode is custom-request)
Base: main
Target Files: 5
Claude Code Context: elegant-popping-glacier.md

## Discovery Summary

**Test Framework:** vitest
**Mock Patterns:** __tests__/mock-factories/
**Existing Test Examples:** src/services/__tests__/

## Refactor Recommendations

### 1. `src/services/auth.ts` - Dependency Injection
**Current Issue:** DatabaseClient instantiated directly
**Recommendation:** Accept as constructor parameter
**Impact:** Enables unit testing without real database

---

## Test Suites

### Suite 1: User Authentication
- [ ] **Status:** pending
- **Type:** unit
- **Target:** `src/auth/__tests__/auth.spec.ts`
- **Dependencies to Mock:**
  - DatabaseClient
  - EmailService
- **Test Cases:**
  - [ ] should authenticate valid credentials
  - [ ] should reject invalid password
  - [ ] should handle network errors
```

Status values:
- `pending` - Not started
- `in_progress` - Currently being implemented
- `complete` - Tests written and passing
- `failed` - Could not complete after 3 attempts

## Configuration

Environment variables:
- `CLIVE_MAX_ITERATIONS` - Maximum loop iterations (default: 50)

## File Structure

When using the plugin, these files are created in your project:

```
.claude/
├── test-plan-[branch].md      # Test plan for specific branch
├── test-plan-latest.md        # Symlink to most recent plan
├── .test-plan-path            # Current plan path (for stop-hook)
├── .test-loop-state           # Current iteration count
├── .test-max-iterations       # Custom max iterations (if set)
└── .cancel-test-loop          # Cancellation flag (temporary)
```

**Note:** Add `.claude/` to your `.gitignore` if you don't want to commit test plans.

## Philosophy

Based on the [Ralph Wiggum approach](https://dev.to/sivarampg/the-ralph-wiggum-approach-running-ai-coding-agents-for-hours-not-minutes-57c1):

1. **Failures are data** - Deterministically bad is predictable and informative
2. **Operator skill matters** - Success depends on good prompts and plans
3. **Persistence wins** - Keep iterating until success
4. **Visibility matters** - Track progress in files, not memory
5. **Context matters** - Leverage existing plans and session history

## Troubleshooting

### "No test plan found"
Run `/clive plan` first to create a test plan, or specify an existing plan:
```bash
/clive test .claude/test-plan-main.md
```

### Loop won't stop
The loop has 5 automatic stop conditions. If it's not stopping:
1. Check if all suites are marked `complete` or `failed` in the plan
2. Run `/clive cancel` to force stop
3. Delete `.claude/.test-loop-state` to reset iteration count

### Wrong plan being used
The test agent uses this priority to find plans:
1. Explicit argument: `/clive test .claude/test-plan-feature.md`
2. Latest symlink: `.claude/test-plan-latest.md`
3. Most recent plan file by modification time

### Max iterations reached too quickly
Increase the limit:
```bash
/clive test --max-iterations 200
```

### Plan not detecting my changes
For custom requests outside git changes:
```bash
/clive plan add tests for the user authentication flow
```

### Tests keep failing
The agent will mark a suite as `failed` after 3 attempts. Check:
1. The test file path in the plan is correct
2. Dependencies are properly mocked
3. The test framework is detected correctly

## Command Reference

| Command | Description |
|---------|-------------|
| `/clive plan` | Create test plan from git changes |
| `/clive plan <branch>` | Create test plan comparing against branch |
| `/clive plan <request>` | Create test plan from custom request |
| `/clive test` | Implement next test suite from plan |
| `/clive test <path>` | Use specific plan file |
| `/clive test --max-iterations N` | Set iteration limit |
| `/clive cancel` | Cancel active test loop |
| `/clive status` | Show plans and loop progress |

## License

MIT
