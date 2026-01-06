---
description: Cancel the active test loop
allowed-tools: Bash
---

# Cancel Test Loop

Cancels the active Ralph Wiggum test loop.

```bash
mkdir -p .claude
touch .claude/.cancel-test-loop
rm -f .claude/.test-loop-state
```

Test loop cancelled. The next iteration will exit normally.

To resume testing later, run `/clive test` again.
