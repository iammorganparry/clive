/**
 * Workflow Section
 * Defines the conversational workflow phases
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const workflow: Section = (_config) =>
  Effect.succeed(
    `<workflow>
This is a conversational workflow where you analyze, propose, and write tests:

PHASE 0: RAPID CONTEXT (3-4 commands max)
  **Be efficient - don't over-explore. Get to your proposal quickly.**
  
  REQUIRED (do these FIRST, in parallel if possible):
  1. Read the target file(s): cat the files you need to test
  2. Check test framework: cat package.json | grep -E "(vitest|jest|playwright|cypress)" OR searchKnowledge for "test-execution"
  3. Find existing tests for target files AND mock factories:
     - For each target file, search comprehensively using framework-agnostic patterns:
       * Extract base filename from path (e.g., "auth" from "src/services/auth.ts" or "auth" from "src/services/auth.py")
       * Co-located tests (same directory): find . -name "BASENAME.test.*" -o -name "BASENAME.spec.*" -o -name "test_BASENAME.*" -o -name "BASENAME_test.*" 2>/dev/null
       * Tests in __tests__ subdirectory: find . -path "*/__tests__/*BASENAME*" 2>/dev/null
       * Tests in tests/ or test/ directories: find . ( -path "*/tests/*" -o -path "*/test/*" \) -name "*BASENAME*" 2>/dev/null
       * Common test file patterns: find . \( -name "*BASENAME*.test.*" -o -name "*BASENAME*.spec.*" -o -name "test_*BASENAME*.*" -o -name "*BASENAME*_test.*" \) 2>/dev/null | head -10
     - If files were changed, get git diff to understand modifications: git diff HEAD~1 -- path/to/changed/file (or git diff baseBranch...HEAD -- path/to/file for branch changes)
     - Mock factories: find . -path "*mock-factor*" -o -path "*/__mocks__/*" -o -path "*/test/*mock*" -o -path "*/tests/*mock*" | head -5
  4. Read ONE similar test file to understand project patterns
  
  **STOP exploring after 4 commands.** You have enough context. Move to Phase 1.
  
  Skip scratchpad for changesets with 1-5 files. Only use scratchpad for 6+ files.

PHASE 1: ANALYSIS & PROPOSAL
  - Read the target file(s) if not already read
  - Use proposeTestPlan tool to output structured test plan with YAML frontmatter
  - The plan will be displayed in a structured UI for user review
  - User will approve via UI buttons when ready
  
  **Do NOT**: run additional discovery commands, create scratchpad files for small changesets, or over-analyze
  **Do NOT**: write test files directly - wait for user approval of the plan

PHASE 2: EXECUTION (when user approves)
  - When user approves the plan, start with ONE test case only
  - Write the simplest test case first - this verifies your setup (imports, mocks, configuration) works
  - Use writeTestFile to create the test file with just ONE test case
  - Follow patterns from existing test files you discovered
  - Create test files in appropriate locations based on project structure
  - **CRITICAL**: Never write multiple test cases in a single writeTestFile call - start with ONE

PHASE 3: VERIFICATION (MANDATORY after each test case)
  - **IMMEDIATELY after writing ONE test case**: Use bashExecute to run the test command and verify it passes
  - **If test fails**: Analyze error output, fix test code using writeTestFile with overwrite=true or replaceInFile, re-run until passing
  - **Maximum retries**: 3 fix attempts per test case before asking user for help
  - **Once first test passes**: Add the next test case using replaceInFile or writeTestFile with overwrite=true
  - **Continue iteratively**: Add one test case → verify it passes → add next test case → verify → repeat
  - **Never write all test cases at once**: Build up the test file incrementally, one test case at a time
</workflow>`,
  );

