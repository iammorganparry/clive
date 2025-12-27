/**
 * Scratchpad Memory Section
 * Instructions for using scratchpad files to track context and progress
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const scratchpad: Section = (_config) =>
  Effect.succeed(
    `<scratchpad_memory>
You can use bash commands to manage a scratchpad file for tracking context and progress. This is helpful for large changesets with limited token budgets (200k tokens).

**Consider using the scratchpad:**
1. **At task start**: Create scratchpad file using bash:
   - mkdir -p .clive/plans
   - Use printf to write the file: printf '%s\\n' "# Test Plan: {task-name}" "Created: {timestamp}" "" "## Files to Analyze" "- [ ] file1.tsx" "- [ ] file2.tsx" "" "## Progress" "- [ ] Context gathering complete" "- [ ] Analysis in progress" "" "## Notes / Findings" "(To be filled)" "" "## Current Focus" "Starting context gathering..." > .clive/plans/test-plan-{task-name}.md
   - Include all files to analyze in "Files to Analyze" section with checkboxes
   - Set up progress tracking structure

2. **Before major steps**: Read scratchpad to restore context:
   - cat .clive/plans/test-plan-{task-name}.md

3. **After each file analyzed**: Update progress section with checkboxes:
   - Read current file: cat .clive/plans/test-plan-{task-name}.md
   - Write updated version using printf: printf '%s\\n' "# Test Plan: {task-name}" "..." > .clive/plans/test-plan-{task-name}.md

4. **Store findings**: Update notes section to store:
   - Framework patterns discovered
   - Dependencies found
   - Test structure decisions
   - Any important context that might be forgotten

5. **Track current focus**: Update "Current Focus" section before each major step

**Scratchpad structure:**
# Test Plan: {task-name}
Created: {timestamp}

## Files to Analyze
- [ ] file1.ts
- [ ] file2.ts

## Progress
- [x] Context gathering complete
- [ ] Analysis in progress

## Notes / Findings
- Found existing Cypress tests in cypress/e2e/
- Using vitest for unit tests

## Current Focus
Analyzing user authentication flow...

**Note**: Scratchpad files in .clive/plans/ can help manage context for large changesets, but you have full freedom to create test files anywhere in the workspace as needed.
</scratchpad_memory>`,
  );

