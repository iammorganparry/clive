# Global Learnings System Reference

The clive-build system includes a **global learnings mechanism** that captures cross-epic knowledge. This allows agents working on different epics/projects to learn from each other's experiences.

## Overview

Global learnings are stored in `.claude/learnings/` and contain:
- **Error patterns** - Recurring errors and their solutions
- **Success patterns** - Reusable techniques that work well
- **Gotchas** - Codebase-specific quirks and traps

These learnings are SEPARATE from epic-specific scratchpads and persist across all work.

---

## Directory Structure

```
.claude/
└── learnings/
    ├── error-patterns.md    # Recurring errors and solutions
    ├── success-patterns.md  # Effective techniques
    └── gotchas.md          # Codebase surprises
```

---

## Initialization

The build system automatically initializes these files if they don't exist:

```bash
# Ensure .claude directory exists
mkdir -p .claude
mkdir -p .claude/learnings

# Initialize global learnings files if needed
GLOBAL_ERROR_PATTERNS=".claude/learnings/error-patterns.md"
GLOBAL_SUCCESS_PATTERNS=".claude/learnings/success-patterns.md"
GLOBAL_GOTCHAS=".claude/learnings/gotchas.md"
```

Each file is created with a template if it doesn't exist.

---

## File Templates

### error-patterns.md Template

```markdown
# Global Error Patterns

Cross-epic knowledge base of recurring errors and their solutions.
When you encounter an error that might affect other work, document it here.

## Template

### [Error Name/Description]
**Symptom:** [What you see]
**Root Cause:** [Why it happens]
**Solution:** [How to fix it]
**Prevention:** [How to avoid it]
**First Seen:** [Date/Epic/Iteration]
**Occurrences:** [List of epics/iterations where this occurred]
**Related Files:** [Files commonly affected]

---
```

### success-patterns.md Template

```markdown
# Global Success Patterns

Reusable patterns and techniques that have worked well across different tasks.
When you discover an effective approach, document it here for others to use.

## Template

### [Pattern Name]
**Use Case:** [When to apply this pattern]
**Implementation:** [How to implement it]
**Benefits:** [Why this works well]
**Examples:** [References to where this was used successfully]
**First Used:** [Date/Epic/Iteration]
**Reused In:** [List of other contexts where this pattern was applied]

---
```

### gotchas.md Template

```markdown
# Global Gotchas

Codebase-specific quirks, traps, and non-obvious behaviors.
Document anything that surprised you or took time to figure out.

## Template

### [Gotcha Name]
**What Happens:** [Surprising behavior]
**Why:** [Root cause or design decision]
**How to Handle:** [Correct approach]
**Files Affected:** [Where this applies]
**Discovered:** [Date/Epic/Iteration]

---
```

---

## When to Document

### Document Error Patterns When:

1. **Error is new to the codebase** - First time seeing this error
2. **Error is recurring** - You've seen it before, or find it documented
3. **Error took significant time to debug** - Would save future agents time
4. **Error is caused by a non-obvious issue** - Root cause not clear from message
5. **Error affects multiple areas** - Could occur in different contexts

**Example scenarios:**
- TypeScript compilation errors with unclear messages
- Build system configuration issues
- Framework-specific quirks (Effect-TS, React Query, etc.)
- Environment setup problems
- Dependency version conflicts

### Document Success Patterns When:

1. **Pattern is truly reusable** - Not task-specific, applies broadly
2. **Pattern solved a non-trivial problem** - More than standard practice
3. **Pattern improved quality or speed** - Measurable benefit
4. **Pattern follows best practices** - Worth establishing as convention
5. **Pattern isn't obvious** - Not documented in framework guides

**Example scenarios:**
- Effective testing approaches (mocking strategies, test structure)
- Refactoring techniques specific to the codebase
- Code organization patterns that work well
- Performance optimization techniques
- Integration patterns between systems

### Document Gotchas When:

1. **Behavior surprised you** - Not what you expected
2. **Took time to figure out** - Would save future agents time
3. **Could cause bugs** - Easy to get wrong
4. **Not documented elsewhere** - No warning in docs or comments
5. **Specific to this codebase** - Not a general language/framework issue

**Example scenarios:**
- Module import order matters
- Certain functions must be called in specific sequence
- Side effects in seemingly pure functions
- Implicit dependencies or global state
- Non-standard conventions

---

## When NOT to Document

### Don't Document:

1. **Task-specific details** - Use epic scratchpad instead
2. **General programming knowledge** - Standard patterns everyone knows
3. **One-time issues** - Typos, local environment problems
4. **Already well-documented** - Framework docs cover it
5. **Incidental observations** - Not actionable or reusable

**Rule of thumb:** If only you would benefit, use scratchpad. If ALL agents would benefit, use global learnings.

---

## How to Document

### Adding a New Entry

```bash
cat >> .claude/learnings/error-patterns.md << 'EOF'

### [Brief Error Description]
**Symptom:** [What you see - error message, behavior]
**Root Cause:** [Why it happens - after investigation]
**Solution:** [How you fixed it - concrete steps]
**Prevention:** [How to avoid in future - pattern/practice]
**First Seen:** $(date '+%Y-%m-%d') - Epic: $EPIC_FILTER - Iteration: $ITERATION
**Occurrences:** 1
**Related Files:** [Files affected]

---
EOF
```

**Key points:**
- Use clear, searchable titles
- Include actual error messages/symptoms
- Explain root cause, not just solution
- Provide concrete steps to fix/avoid
- Track when and where it occurred

### Updating an Existing Entry

When encountering a documented error again:

1. **Increment occurrence count**
2. **Add current epic/iteration to "Occurrences" list**
3. **Update "Last Seen" date (if field exists)**
4. **Add any new insights** - Variations, additional context

Example update:
```markdown
**Occurrences:** 3
- 2026-01-15 - Epic: auth-system - Iteration: 5
- 2026-01-18 - Epic: user-profiles - Iteration: 12
- 2026-01-23 - Epic: notifications - Iteration: 8 (new)
```

---

## Reading Global Learnings

### Check Before Starting Work

**Pattern: Read first, then implement**

```bash
# Check for related error patterns
grep -i "relevant keyword" .claude/learnings/error-patterns.md

# Check for success patterns
grep -i "relevant keyword" .claude/learnings/success-patterns.md

# Check for gotchas
grep -i "relevant keyword" .claude/learnings/gotchas.md
```

### During Implementation

When encountering an issue:
1. **First, check global learnings** - Has this been solved before?
2. **Apply documented solution** - If it matches your situation
3. **Update entry if needed** - Add occurrence or new insights
4. **Document if new** - If not found and significant

### During Review

Before marking task complete:
1. **Reflect on what you learned** - Any patterns worth documenting?
2. **Check if patterns are reusable** - Would help other agents?
3. **Document globally if appropriate** - Follow guidelines above

---

## Benefits of Global Learnings

### For Individual Agents

- **Avoid repeating mistakes** - Learn from past errors
- **Apply proven solutions** - Use techniques that work
- **Navigate gotchas** - Awareness of codebase quirks
- **Work faster** - Less debugging time

### For the Project

- **Institutional knowledge** - Captured, not lost
- **Consistency** - Standard approaches emerge
- **Quality** - Fewer bugs, better patterns
- **Onboarding** - New agents learn faster

### For the Team

- **Cross-epic learning** - Share knowledge across projects
- **Pattern identification** - Spot systemic issues
- **Process improvement** - Data to guide decisions
- **Documentation** - Living knowledge base

---

## Maintenance

### Periodic Review

Every N iterations or at project milestones:
1. **Review learnings files** - Are entries still relevant?
2. **Consolidate duplicates** - Merge similar entries
3. **Archive outdated entries** - Mark as historical if fixed
4. **Promote patterns** - Move to formal docs if widely used

### Quality Standards

**Good entry:**
- Clear, specific title
- Complete sections (all template fields filled)
- Concrete examples (file paths, line numbers, code snippets)
- Actionable guidance (specific steps, not vague advice)
- Proper attribution (date, epic, iteration)

**Needs improvement:**
- Generic title ("Build failed")
- Missing sections (no root cause)
- Vague examples ("somewhere in auth code")
- Abstract advice ("be careful")
- No context (when/where)

---

## Integration with Skills

Each skill (feature, bugfix, refactor, unit-tests) includes specific guidance on:
- When to check global learnings
- When to document globally
- How to update existing entries
- Template for new entries

See individual skill reference files for details.

---

## Example Workflow

### Scenario: Agent encounters TypeScript error

1. **Error occurs** during implementation
   ```
   Error: Type 'X' is not assignable to type 'Y'
   ```

2. **Check global learnings**
   ```bash
   grep -i "not assignable" .claude/learnings/error-patterns.md
   ```

3. **Entry found** with similar error
   - Read solution: "Import type directly, don't re-export"
   - Apply solution: Update import statement
   - Error resolved

4. **Update entry**
   - Increment occurrence count
   - Add current epic/iteration
   - Note: "Also affects feature modules, not just services"

5. **Continue work** with resolved issue

**Time saved:** Could have been 15-30 minutes of debugging. Reduced to 2 minutes.

---

## Summary

**Global learnings provide:**
- Cross-epic knowledge sharing
- Faster debugging and implementation
- Better quality through proven patterns
- Living documentation of codebase quirks

**Use global learnings to:**
- Check before implementing (prevent issues)
- Document during work (capture discoveries)
- Update when recurring (track patterns)
- Review periodically (maintain quality)

**Remember:** If it helps you, document it. Future agents will thank you.
