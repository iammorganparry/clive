# Build Mode Agent Loop Enhancements - Implementation Summary

## Overview

This document summarizes the comprehensive enhancements made to the build mode agent loop system to improve learning accumulation, knowledge sharing, and agent effectiveness.

## ✅ Completed Enhancements

### 1. Structured Scratchpad Template (Phase 1) ✅

**File:** `apps/tui/scripts/build-iteration.sh` (lines 458-489)

**Changes:**
- Enhanced scratchpad template with structured sections:
  - ✅ What Worked
  - ❌ What Didn't Work / Blockers
  - 🧠 Key Decisions & Rationale
  - 📝 Files Modified
  - ⚠️ Gotchas for Next Agent
  - 🎯 Success Patterns
  - 📊 Metrics
- Added verification marker requirement
- Changed from "Required" to "MANDATORY - VERIFICATION REQUIRED"

**Benefits:**
- Consistent knowledge capture across iterations
- Explicit sections for successes and failures
- Better context carryover between tasks

### 2. Global Learnings System (Phase 4 Enhanced) ✅

**File:** `apps/tui/scripts/build-iteration.sh` (lines 128-182, 303-349)

**New Infrastructure:**
Created three global learning files in `.claude/learnings/`:
1. **error-patterns.md** - Cross-epic error documentation
2. **success-patterns.md** - Reusable techniques and patterns
3. **gotchas.md** - Codebase-specific quirks and traps

**Prompt Injection:**
- Global learnings shown at top of agent prompt (before epic-specific context)
- Displays counts of documented patterns
- Shows relevant excerpts (limited to prevent prompt bloat)
- Guides agents to check learnings before starting work

**Benefits:**
- Knowledge persists across different epics
- Prevents repeated debugging of same issues
- Accumulates institutional knowledge over time
- Helps agents avoid known pitfalls

### 3. Task Context Extraction (Phase 3) ✅

**File:** `apps/tui/scripts/build-iteration.sh` (lines 318-371)

**Changes:**
- **Beads:** Extracts full task details including description via `bd show --format json`
- **Linear:** Extracts task details from cached tasks file including:
  - Task identifier (e.g., TRI-1234)
  - Full description
  - Acceptance criteria (auto-extracted)
  - Definition of done (auto-extracted)

**Benefits:**
- Agents see full requirements immediately
- No need for additional tool calls to fetch task details
- Faster task startup
- Clear expectations from the beginning

### 4. Scratchpad Validation (Phase 2) ✅

**Files Modified:**
- `apps/tui/skills/feature.md` (Section 4.5)
- `apps/tui/skills/bugfix.md` (Section 6.3)
- `apps/tui/skills/refactor.md` (Section 3.7)
- `apps/tui/skills/unit-tests.md` (Section 3.5)

**Implementation:**
- Added mandatory validation step before task completion
- Bash script checks for iteration entry in scratchpad
- Fails task completion if scratchpad not updated
- Includes checklist of required sections

**Benefits:**
- Enforces learning documentation
- Prevents completion without knowledge capture
- Builds reliable context for future agents

### 5. Post-Task Reflection (Phase 5) ✅

**Files Modified:**
- `apps/tui/skills/feature.md` (Section 4.6)
- `apps/tui/skills/bugfix.md` (Section 6.4)
- `apps/tui/skills/refactor.md` (Section 3.8)
- `apps/tui/skills/unit-tests.md` (Section 3.6)

**Implementation:**
- Mandatory reflection questions tailored to each skill type
- Structured reflection template appended to scratchpad
- Covers effectiveness, efficiency, patterns, improvements, and learnings

**Skill-Specific Reflections:**
- **Feature:** Focus on implementation effectiveness and pattern discovery
- **Bugfix:** Focus on root cause clarity and debugging techniques
- **Refactor:** Focus on clarity improvement and maintainability
- **Unit Tests:** Focus on test quality and coverage

**Benefits:**
- Captures tacit knowledge from experience
- Identifies process improvements
- Provides meta-cognitive insights
- Helps agents learn from each iteration

### 6. Error & Pattern Documentation (Phase 4 Enhanced) ✅

**Files Modified:**
- `apps/tui/skills/feature.md` (Section 2.5)
- `apps/tui/skills/bugfix.md` (Section 4.3)
- `apps/tui/skills/refactor.md` (Section 2.3)
- `apps/tui/skills/unit-tests.md` (Section 2.6)

**Implementation:**
- Instructions for documenting errors to global learnings
- Instructions for documenting success patterns
- Instructions for documenting gotchas
- Bash templates for appending to global files

**Benefits:**
- Systematic knowledge capture during work
- Prevents knowledge loss
- Builds searchable knowledge base
- Helps identify systemic issues

---

## File Changes Summary

### Modified Files

| File | Lines Changed | Enhancements |
|------|--------------|--------------|
| `apps/tui/scripts/build-iteration.sh` | ~150 lines | Global learnings setup, scratchpad template, task context extraction, error patterns |
| `apps/tui/skills/feature.md` | ~80 lines | Error docs, scratchpad validation, reflection, pattern docs |
| `apps/tui/skills/bugfix.md` | ~70 lines | Error docs, scratchpad validation, reflection, pattern docs |
| `apps/tui/skills/refactor.md` | ~70 lines | Pattern docs, scratchpad validation, reflection |
| `apps/tui/skills/unit-tests.md` | ~60 lines | Testing pattern docs, scratchpad validation, reflection |

### New Runtime Files

Created automatically per-project:
- `.claude/learnings/error-patterns.md` - Global error knowledge base
- `.claude/learnings/success-patterns.md` - Global success patterns
- `.claude/learnings/gotchas.md` - Global codebase gotchas

Existing files enhanced:
- `.claude/epics/{epic}/scratchpad.md` - Epic-specific context (now with structured template)
- `.claude/epics/{epic}/error-patterns.md` - Epic-specific error patterns (still exists)
- `.claude/epics/{epic}/progress.txt` - Iteration progress (unchanged)

---

## How It Works

### Agent Workflow (Enhanced)

1. **Startup:**
   - Agent reads global learnings (cross-epic knowledge)
   - Agent reads epic-specific scratchpad (recent context)
   - Agent sees full task details extracted in prompt

2. **During Work:**
   - Agent checks global learnings for known errors/patterns
   - Agent documents new errors/patterns to global learnings
   - Agent documents successes to global learnings
   - Agent uses structured scratchpad template for notes

3. **Before Completion:**
   - Agent validates scratchpad was updated (enforced)
   - Agent completes post-task reflection (enforced)
   - Agent verifies all sections filled out
   - Agent updates task status and commits

4. **Knowledge Flow:**
   ```
   Global Learnings (all epics)
         ↓
   Agent reads before starting
         ↓
   Agent works on task
         ↓
   Agent documents new learnings
         ↓
   Scratchpad + Global Files updated
         ↓
   Next agent benefits from learnings
   ```

---

## Success Metrics

### Quantitative (Expected)
- Scratchpad update rate: 100% (enforced by validation)
- Error pattern reuse: >30% of errors reference known patterns
- Task startup time: Reduced by ~20% (no need to fetch task details)
- Repeated errors: Decrease by ~40% over 10 iterations

### Qualitative (Expected)
- Agents reference previous learnings in output
- Decision rationale traceable in scratchpad
- Patterns emerge and are reused
- Knowledge compounds over iterations
- Institutional memory builds over time

---

## Usage Guide

### For Agents

**Starting a task:**
1. Read "Global Learnings" section at top of prompt
2. Check for relevant error patterns, success patterns, gotchas
3. Read epic-specific scratchpad for recent context
4. Note full task details (already extracted in prompt)

**During work:**
- Encountered an error? Check `.claude/learnings/error-patterns.md` first
- Found a solution? Document it in global error patterns
- Discovered a reusable technique? Add to success patterns
- Hit a codebase quirk? Document in gotchas

**Before completing:**
1. Update scratchpad using structured template (MANDATORY)
2. Complete post-task reflection (MANDATORY)
3. Verify scratchpad validation passes
4. Update task status and commit

### For Users

**Reviewing learnings:**
```bash
# View global error patterns
cat .claude/learnings/error-patterns.md

# View success patterns
cat .claude/learnings/success-patterns.md

# View codebase gotchas
cat .claude/learnings/gotchas.md

# View epic-specific scratchpad
cat .claude/epics/{epic-id}/scratchpad.md
```

**Clearing learnings (if needed):**
```bash
# Clear global learnings (use with caution)
rm -rf .claude/learnings/

# Clear epic-specific scratchpad
rm .claude/epics/{epic-id}/scratchpad.md

# Next build will recreate empty templates
```

---

## Examples

### Example: Global Error Pattern

```markdown
### TypeScript Build Fails with "Cannot find module" After Adding New Package

**Symptom:** `tsc --noEmit` fails with "Cannot find module 'new-package'" even though package is installed
**Root Cause:** TypeScript doesn't auto-detect new packages in monorepo workspaces
**Solution:**
1. Run `yarn install` in root
2. Run `yarn workspace @clive/ui build` to rebuild UI package
3. Then run `yarn typecheck` in extension workspace
**Prevention:** Always rebuild dependent packages after adding new dependencies
**First Seen:** 2026-01-23 - Epic: playwright-detection - Iteration: 3
**Occurrences:** 2 (also seen in Epic: test-recording on 2026-01-24)
**Related Files:** package.json, tsconfig.json
```

### Example: Success Pattern

```markdown
### Effect-TS Service Layer Composition

**Use Case:** When creating new services that depend on other services in the extension
**Implementation:**
1. Define service interface with Effect.Tag
2. Implement service with Effect.provide
3. Add to appropriate tier in layer-factory.ts
4. Use createCoreLayer() to compose dependencies
**Benefits:**
- Clean dependency injection
- Testable services
- Type-safe composition
- No circular dependency issues
**Examples:**
- src/services/playwright-detector.ts:42
- src/services/config-service.ts:28
**First Used:** 2026-01-23 - Epic: playwright-detection - Task: TRI-101
**Reused In:** Epic: test-recording (Task: TRI-105), Epic: codegen (Task: TRI-112)
```

### Example: Gotcha

```markdown
### VS Code Extension Context Not Available in Tests

**What Happens:** Extension tests fail with "vscode is undefined" when importing modules that use vscode API
**Why:** VS Code API is only available in extension runtime, not in Node test environment
**How to Handle:**
1. Use dependency injection for vscode context
2. Mock vscode imports in tests with `vi.mock('vscode')`
3. Or use integration tests that run in Extension Development Host
**Files Affected:** Any file importing from 'vscode' package
**Discovered:** 2026-01-23 - Epic: playwright-detection - Iteration: 5
```

---

## Maintenance

### Periodic Cleanup (Recommended)

**When learnings become stale:**
- Review error patterns - remove resolved systemic issues
- Review success patterns - consolidate similar patterns
- Review gotchas - remove if codebase changed

**Frequency:** Monthly or after major refactors

**Process:**
1. Read through each learning file
2. Mark outdated entries
3. Update or remove as needed
4. Consolidate duplicates

---

## Future Enhancements (Not Implemented)

### Considered but deferred:

1. **LLM-Based Summarization:** Auto-summarize scratchpad after N iterations
   - Deferred: Adds complexity and cost, structured format is sufficient

2. **Database-Backed Learnings:** Store learnings in SQLite for querying
   - Deferred: Filesystem is simpler, grep is sufficient

3. **Learning Similarity Detection:** Auto-detect similar errors/patterns
   - Deferred: Manual documentation more reliable

4. **Automated Pattern Extraction:** LLM extracts patterns from git history
   - Deferred: Human-documented patterns more valuable

---

## Testing Checklist

To verify enhancements are working:

- [ ] Start build with `/build`
- [ ] Complete Task A without scratchpad update → Verify blocked
- [ ] Complete Task A with scratchpad update → Verify succeeds
- [ ] Start Task B → Verify Task A learnings visible in prompt
- [ ] Document error in Task B → Check `.claude/learnings/error-patterns.md`
- [ ] Document success pattern → Check `.claude/learnings/success-patterns.md`
- [ ] Document gotcha → Check `.claude/learnings/gotchas.md`
- [ ] Complete Task B → Verify reflection in scratchpad
- [ ] Start Task C → Verify global learnings from Task B visible
- [ ] Verify task context extracted (no need for `mcp__linear__get_issue`)

---

## Conclusion

These enhancements transform the build loop from a simple task executor into a learning system that accumulates knowledge over time. Each agent benefits from the work of previous agents, preventing repeated mistakes and promoting successful patterns.

**Key Achievements:**
1. ✅ Enforced learning documentation (no completion without scratchpad)
2. ✅ Global knowledge base (cross-epic learnings)
3. ✅ Structured reflection (meta-cognitive improvement)
4. ✅ Better task context (full details upfront)
5. ✅ Systematic pattern documentation

The system now has institutional memory and continuous improvement built in.
