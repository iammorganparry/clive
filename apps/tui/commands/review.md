---
description: Verify completed work, test in browser, and create tasks for gaps
model: opus
allowed-tools: Bash, Read, Glob, Grep, Skill, mcp__linear__*, mcp__plugin_playwright_playwright__*
denied-tools: Write, Edit, TodoWrite, Task, EnterPlanMode, ExitPlanMode
---

# Review Mode Command

This command launches the review skill to systematically verify completed work against requirements, test functionality in the browser, and create tasks for discovered issues.

## Usage

When this command is invoked, it loads the review skill from `skills/review.md` which handles the full review workflow.

The review skill:
1. Loads context from session-context.json and Linear
2. Reviews code against acceptance criteria
3. Runs quality checks (typecheck, lint, build)
4. Tests in browser using saved credentials
5. Creates tasks for any gaps discovered
6. Outputs a comprehensive report

## Session Context

The TUI writes session context to `.claude/session-context.json` including:
- `mode`: "review"
- `reviewCredentials`: Object with baseUrl, email, password, skipAuth
- `issue`: Parent epic details if selected

Review credentials are also saved to `.claude/review-config.json` for reuse.

## Completion

The review skill outputs `<promise>REVIEW_COMPLETE</promise>` when finished.
