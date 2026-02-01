# Agent Instructions

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **COMMIT AND PUSH your feature branch:**
   ```bash
   git add -A
   git commit -m "feat(scope): description"
   git push -u origin HEAD
   ```
5. **Create a Pull Request:**
   ```bash
   gh pr create --base main --title "feat(scope): description" --body "## Summary\n- Changes made\n\n## Test plan\n- How to verify"
   ```
6. **Verify** - All changes committed, pushed, and PR created
7. **Hand off** - Provide the PR URL and context for next session

**CRITICAL RULES:**
- **NEVER push to main, master, or production branches**
- Always work on your `clive/*` feature branch
- Work is NOT complete until changes are pushed and a PR is created
- NEVER say "ready to push when you are" - YOU must push and create the PR
- If push fails, resolve and retry until it succeeds
