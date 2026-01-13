---
description: Check the status of work plans and build loop progress
allowed-tools: Bash, Read
---

# Work Status

Check the current state of work planning and execution.

## Available Work Plans

```bash
echo "=== Available Work Plans ==="
echo ""

# List all work plan files (new naming)
found_plans=false
if ls .claude/work-plan-*.md 1>/dev/null 2>&1; then
    for plan in .claude/work-plan-*.md; do
        if [ -f "$plan" ]; then
            found_plans=true
            # Get branch name from filename
            branch=$(basename "$plan" .md | sed 's/work-plan-//')

            # Count tasks
            total=$(grep -c '### Task' "$plan" 2>/dev/null || echo "0")
            complete=$(grep -c '\- \[x\] \*\*Status:\*\* complete' "$plan" 2>/dev/null || echo "0")
            failed=$(grep -c '\- \[x\] \*\*Status:\*\* failed' "$plan" 2>/dev/null || echo "0")
            pending=$(grep -c '\- \[ \] \*\*Status:\*\* pending' "$plan" 2>/dev/null || echo "0")
            in_progress=$(grep -c '\- \[ \] \*\*Status:\*\* in_progress' "$plan" 2>/dev/null || echo "0")

            echo "  $plan"
            echo "    Branch: $branch"
            echo "    Tasks: $total total ($complete complete, $failed failed, $in_progress in progress, $pending pending)"
            echo ""
        fi
    done
fi

# Also check legacy test-plan files (backwards compatibility)
if ls .claude/test-plan-*.md 1>/dev/null 2>&1; then
    for plan in .claude/test-plan-*.md; do
        if [ -f "$plan" ]; then
            found_plans=true
            branch=$(basename "$plan" .md | sed 's/test-plan-//')

            total=$(grep -c '### Suite\|### Task' "$plan" 2>/dev/null || echo "0")
            complete=$(grep -c '\- \[x\] \*\*Status:\*\* complete' "$plan" 2>/dev/null || echo "0")
            pending=$(grep -c '\- \[ \] \*\*Status:\*\* pending' "$plan" 2>/dev/null || echo "0")
            in_progress=$(grep -c '\- \[ \] \*\*Status:\*\* in_progress' "$plan" 2>/dev/null || echo "0")

            echo "  $plan (legacy)"
            echo "    Branch: $branch"
            echo "    Tasks: $total total ($complete complete, $in_progress in progress, $pending pending)"
            echo ""
        fi
    done
fi

if [ "$found_plans" = false ]; then
    echo "  No work plans found."
    echo ""
    echo "  Run '/clive plan' to create a work plan."
fi

# Show latest symlink
if [ -L ".claude/work-plan-latest.md" ]; then
    latest=$(readlink .claude/work-plan-latest.md)
    echo "Latest plan: .claude/$latest"
    echo ""
elif [ -L ".claude/test-plan-latest.md" ]; then
    latest=$(readlink .claude/test-plan-latest.md)
    echo "Latest plan (legacy): .claude/$latest"
    echo ""
fi
```

## Active Build Loop

```bash
echo "=== Loop Status ==="
echo ""

# Check if a build loop is active
if [ -f ".claude/.test-plan-path" ]; then
    active_plan=$(cat .claude/.test-plan-path)
    echo "Active plan: $active_plan"

    if [ -f ".claude/.test-loop-state" ]; then
        iteration=$(cat .claude/.test-loop-state)
        max_iter="${CLIVE_MAX_ITERATIONS:-50}"
        echo "Current iteration: $iteration / $max_iter"
    fi
    echo ""
else
    echo "No active build loop."
    echo ""
fi

# Check for cancellation flag
if [ -f ".claude/.cancel-test-loop" ]; then
    echo "WARNING: Cancellation pending - next iteration will stop"
    echo ""
fi
```

## Beads Task Status

```bash
echo "=== Beads Task Status ==="
echo ""

# Check if beads is available
if command -v bd &> /dev/null && [ -d ".beads" ]; then
    echo "Beads tracking: enabled"
    echo ""

    # Show summary
    total=$(bd list --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
    pending=$(bd list --status pending --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
    in_progress=$(bd list --status in_progress --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
    complete=$(bd list --status complete --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")

    echo "  Total tasks: $total"
    echo "  Pending: $pending"
    echo "  In progress: $in_progress"
    echo "  Complete: $complete"
    echo ""

    # Show ready tasks (no blockers)
    echo "  Ready to work on:"
    bd ready 2>/dev/null | head -5 || echo "  (none)"
    echo ""

    # Show task tree
    echo "  Task hierarchy:"
    bd list --tree 2>/dev/null | head -15 || echo "  (no hierarchy)"
    echo ""
elif command -v bd &> /dev/null; then
    echo "Beads available but not initialized in this repo."
    echo "Run 'bd init' or use '/clive plan' to auto-initialize."
    echo ""
else
    echo "Beads not installed."
    echo "Install with: npm install -g @beads/bd"
    echo "(Optional - clive works without beads)"
    echo ""
fi
```

## Recent Claude Code Plans

```bash
echo "=== Recent Claude Code Plans (last 24h) ==="
echo ""

# Find recently modified Claude Code plans
# Check BOTH repo-local and system-level plans
recent_plans=""

# Repo-local plans (higher priority)
if [ -d ".claude/plans" ]; then
    repo_plans=$(find .claude/plans -name "*.md" -mtime -1 2>/dev/null | head -5)
    if [ -n "$repo_plans" ]; then
        echo "  --- Repo-local plans (.claude/plans/) ---"
        for plan in $repo_plans; do
            title=$(head -1 "$plan" | sed 's/^# //')
            echo "  $(basename "$plan"): $title"
        done
        echo ""
    fi
fi

# System-level plans
system_plans=$(find ~/.claude/plans -name "*.md" -mtime -1 2>/dev/null | head -5)
if [ -n "$system_plans" ]; then
    echo "  --- System plans (~/.claude/plans/) ---"
    for plan in $system_plans; do
        title=$(head -1 "$plan" | sed 's/^# //')
        echo "  $(basename "$plan"): $title"
    done
    echo ""
fi

if [ -z "$repo_plans" ] && [ -z "$system_plans" ]; then
    echo "  No recent plans found."
fi

echo "  These may contain context for your current work."
echo ""
```

## Available Commands

| Command | Description |
|---------|-------------|
| `/clive plan [request]` | Create a work plan with category detection |
| `/clive build [options]` | Execute work plan with skill-based dispatch |
| `/clive cancel` | Cancel the active build loop |
| `/clive status` | Show this status (current command) |

## Usage Examples

```bash
# Create a new work plan
/clive plan

# Create a plan for a specific request
/clive plan "add tests for auth module"
/clive plan "fix the login bug"
/clive plan "refactor the API client"

# Run build using the latest plan
/clive build

# Run a single iteration
/clive build --once

# Force a specific skill
/clive build --skill unit-tests

# Check status
/clive status

# Cancel an active loop
/clive cancel
```
