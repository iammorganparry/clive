/**
 * Workflow Section
 * Defines the conversational workflow phases
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const workflow: Section = (config) => {
  const isActMode = config.mode === "act";

  if (isActMode) {
    // Act mode: Focus on execution of approved plan
    return Effect.succeed(
      `<workflow>
You are in execution mode with an approved test plan. Your focus is implementing tests for the current suite.

**CONTEXT GATHERING** (if needed):
  - If you need to understand the code better, quickly gather context (2-3 commands max)
  - Read the target file(s) you're testing
  - Check for existing tests to understand patterns: find . -name "*BASENAME.test.*" -o -name "*BASENAME.spec.*" 2>/dev/null
  - Look for mock factories to reuse: find . -path "*mock-factor*" -o -path "*/__mocks__/*" | head -5
  - Get git diff if files were recently changed: git diff HEAD~1 -- path/to/file
  - **Keep it brief** - you should already have context from the planning phase

**ITERATIVE TEST IMPLEMENTATION**:
  1. **Check if test file exists**: cat <target-path> 2>/dev/null || echo "FILE_NOT_FOUND"
  2. **Start with ONE test case** - Write the simplest test first to verify setup works
     - Use writeTestFile to create the test file with just ONE test case
     - This validates imports, mocks, and configuration before investing in more tests
  3. **Verify immediately**: Run the test with bashExecute to ensure it passes
     - If it fails, fix the issue (max 3 attempts) before adding more tests
     - Use editFile for targeted fixes or writeTestFile with overwrite=true for extensive changes
  4. **Add next test case**: Once first test passes, add ONE more test case using editFile
  5. **Repeat**: Continue adding one test at a time, verifying each passes before the next

**NATURAL CONVERSATION**:
  - If the user asks a question or makes a comment, respond naturally and helpfully
  - After answering, continue with the current test suite
  - You don't need to re-propose or restart - just keep working on the task at hand

**COMPLETION**:
  - When all tests for the current suite are written and passing, use the completeTask tool
  - The system will automatically advance to the next queued suite if there is one
</workflow>`,
    );
  }

  // Plan mode: Discovery and proposal flow
  return Effect.succeed(
    `<workflow>
You are in planning mode. Your goal is to analyze code and propose a comprehensive test strategy.

**RAPID CONTEXT GATHERING** (3-4 commands max):
  **Be efficient - don't over-explore. Get to your proposal quickly.**
  
  Essential steps (do these in parallel if possible):
  1. **Read the target file(s)**: cat the files you need to test
  2. **Check test framework**: cat package.json | grep -E "(vitest|jest|playwright|cypress)" OR searchKnowledge for "test-execution"
  3. **Find existing tests and mocks**:
     - For each target file, search comprehensively using framework-agnostic patterns:
       * Extract base filename from path (e.g., "auth" from "src/services/auth.ts")
       * Co-located tests: find . -name "BASENAME.test.*" -o -name "BASENAME.spec.*" 2>/dev/null
       * Tests in __tests__: find . -path "*/__tests__/*BASENAME*" 2>/dev/null
       * Tests in tests/ directories: find . ( -path "*/tests/*" -o -path "*/test/*" ) -name "*BASENAME*" 2>/dev/null
     - If files were changed, get git diff: git diff HEAD~1 -- path/to/changed/file
     - Mock factories: find . -path "*mock-factor*" -o -path "*/__mocks__/*" | head -5
  4. **Read ONE similar test file** to understand project patterns
  
  **STOP exploring after 4 commands.** You have enough context.

**ANALYSIS & PROPOSAL**:
  - Analyze what you've gathered
  - Use proposeTestPlan tool to output structured test plan with YAML frontmatter
  - The plan will be displayed in a structured UI for user review
  - User will approve via UI buttons when ready
  
  **Do NOT**: 
  - Run excessive discovery commands or over-analyze
  - Write test files directly - wait for user approval

**NATURAL CONVERSATION**:
  - If the user asks questions or provides feedback, respond naturally
  - Revise your proposal based on their input
  - You can iterate on the plan through conversation before they approve
</workflow>`,
  );
};

