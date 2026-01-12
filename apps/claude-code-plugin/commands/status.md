---
description: Check the status of the test plan and loop progress
allowed-tools: Bash, Read
---

# Test Status

Check the current state of test planning and implementation.

## Available Test Plans

```bash
echo "=== Available Test Plans ==="
echo ""

# List all test plan files
if ls .claude/test-plan-*.md 1>/dev/null 2>&1; then
    for plan in .claude/test-plan-*.md; do
        if [ -f "$plan" ]; then
            # Get branch name from filename
            branch=$(basename "$plan" .md | sed 's/test-plan-//')

            # Count suites
            total=$(grep -c '### Suite' "$plan" 2>/dev/null || echo "0")
            complete=$(grep -c '\- \[x\] \*\*Status:\*\* complete' "$plan" 2>/dev/null || echo "0")
            failed=$(grep -c '\- \[x\] \*\*Status:\*\* failed' "$plan" 2>/dev/null || echo "0")
            pending=$(grep -c '\- \[ \] \*\*Status:\*\* pending' "$plan" 2>/dev/null || echo "0")
            in_progress=$(grep -c '\- \[ \] \*\*Status:\*\* in_progress' "$plan" 2>/dev/null || echo "0")

            echo "  $plan"
            echo "    Branch: $branch"
            echo "    Suites: $total total ($complete complete, $failed failed, $in_progress in progress, $pending pending)"
            echo ""
        fi
    done
else
    echo "  No test plans found."
    echo ""
    echo "  Run '/clive plan' to create a test plan."
fi

# Show latest symlink
if [ -L ".claude/test-plan-latest.md" ]; then
    latest=$(readlink .claude/test-plan-latest.md)
    echo "Latest plan: .claude/$latest"
    echo ""
fi
```

## Active Test Loop

```bash
echo "=== Loop Status ==="
echo ""

# Check if a test loop is active
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
    echo "No active test loop."
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

    # Show task tree for current test plan
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
| `/clive plan [branch]` | Create a test plan for changed files |
| `/clive test [plan-path]` | Implement tests from a plan (one suite at a time) |
| `/clive cancel` | Cancel the active test loop |
| `/clive status` | Show this status (current command) |

## Usage Examples

```bash
# Create a new test plan
/clive plan

# Create a plan comparing against develop branch
/clive plan develop

# Run tests using the latest plan
/clive test

# Run tests using a specific plan
/clive test .claude/test-plan-feature-auth.md

# Check status
/clive status

# Cancel an active loop
/clive cancel
```
