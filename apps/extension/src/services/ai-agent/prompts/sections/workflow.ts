/**
 * Workflow Section
 * Defines the conversational workflow phases
 */

import { Effect } from "effect";
import type { Section } from "../types.js";
import { getToolName } from "../tool-names.js";

export const workflow: Section = (config) => {
  const isActMode = config.mode === "act";

  // Get dynamic tool names based on AI provider
  const proposeTestPlan = getToolName("proposeTestPlan", config);
  const completeTask = getToolName("completeTask", config);
  const searchKnowledge = getToolName("searchKnowledge", config);

  if (isActMode) {
    // Act mode: Focus on execution of approved plan
    return Effect.succeed(
      `<workflow>
You are in execution mode with an approved test plan. Your focus is implementing tests for the current suite.

**CRITICAL: NO RE-PLANNING**
  - You have ALL context from the planning phase (mocks, patterns, dependencies)
  - DO NOT run extensive discovery commands
  - DO NOT propose a new test plan
  - DO NOT restart or go back to planning
  - If information seems missing, work with what you have and note gaps for the user
  - Only read files directly relevant to implementation (target file, specific mock factories)

**LIMITED CONTEXT GATHERING** (if absolutely necessary):
  - Read the target file(s) you're testing if not already in context
  - Check if test file exists: cat <target-path> 2>/dev/null || echo "FILE_NOT_FOUND"
  - Read specific mock factory files that were identified in the plan
  - **Maximum 2-3 focused commands** - you should already have all patterns and dependencies from planning

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

**USE PLAN CONTEXT**:
  - Reference mockDependencies identified in planning phase
  - Use discoveredPatterns (mock factory paths, test patterns)
  - Follow testStrategy for externalDependencies (sandbox, mock, skip)
  - Do NOT rediscover what was already found in planning
${config.planFilePath ? `  - **Plan file available**: Read the approved test plan at \`${config.planFilePath}\` for full context if needed` : ""}

**NATURAL CONVERSATION**:
  - If the user asks a question or makes a comment, respond naturally and helpfully
  - After answering, continue with the current test suite
  - You don't need to re-propose or restart - just keep working on the task at hand

**COMPLETION**:
  - When all tests for the current suite are written and passing, use the ${completeTask} tool
  - The system will automatically advance to the next queued suite if there is one
</workflow>`,
    );
  }

  // Plan mode: Discovery and proposal flow
  return Effect.succeed(
    `<workflow>
You are in planning mode. Your goal is to analyze code and propose a comprehensive test strategy.

**THOROUGH CONTEXT GATHERING** (MANDATORY):
  You MUST gather all information needed for act mode execution. This is your ONLY opportunity to discover context.
  
  Essential steps (execute thoroughly):
  1. **Read the target file(s)**: cat the files you need to test
     - Identify all imports and dependencies
     - Note external services (DB, APIs, file system)
  
  2. **Find and offer regression detection** (after reading target files):
     - Search for existing test files related to the changeset
     - If related tests found, ask the user if they want to check for regressions
     - If accepted:
       * Run ONLY the related test files (not the full suite)
       * Analyze any failures against changeset files
       * Classify as expected (changeset-related) or unexpected (side effect)
       * Include regressionAnalysis in ${proposeTestPlan}
     - If no related tests found or user declines:
       * Skip regression detection
       * Proceed to pattern discovery
  
  3. **Identify test framework and patterns**:
     - Check test framework: cat package.json | grep -E "(vitest|jest|playwright|cypress)" OR ${searchKnowledge} for "test-execution"
     - Find similar test files: find . -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | head -10
     - Read at least 1-2 similar test files to understand patterns
  
  4. **Discover ALL mock factories** (MANDATORY):
     - Search comprehensively: find . -path "*mock-factor*" -o -path "*/__mocks__/*" 2>/dev/null
     - List contents: ls -la __tests__/mock-factories/ 2>/dev/null || true
     - Read existing mock factory files to understand patterns
     - Document EVERY mock factory path you find
  
  5. **Identify external dependencies**:
     - Database connections: grep -r "createClient\\|new.*Client\\|connect\\|supabase" --include="*.ts" --include="*.tsx" | head -10
     - API calls: grep -r "fetch\\|axios\\|http" --include="*.ts" --include="*.tsx" | head -10
     - File system operations: grep -r "fs\\.\\|readFile\\|writeFile" --include="*.ts" | head -5
     - Check for Docker/sandbox setup: ls docker-compose.yml .env.test 2>/dev/null
  
  6. **Map dependencies to mocks**:
     - For each dependency in target file, determine mock strategy
     - Check if mock factory already exists
     - Document which mocks need to be created vs reused
  
  **Take the time you need** - thorough discovery prevents failures in act mode.

**ANALYSIS & PROPOSAL**:
  - Analyze all gathered information
  - Use ${proposeTestPlan} tool ONCE with ALL required fields populated:
    * IMPORTANT: Only call this tool ONE time per planning session
    * If you need to revise, respond in natural language - the user can request changes
    * mockDependencies: List EVERY dependency that needs mocking
    * discoveredPatterns: Document test framework, mock factory paths, and patterns
    * externalDependencies: List databases, APIs, and other external services
  - The plan will be displayed in a structured UI for user review
  - User will approve via UI buttons when ready

  **Critical Requirements**:
  - You MUST populate mockDependencies, discoveredPatterns fields in ${proposeTestPlan}
  - Do NOT skip discovery steps - act mode depends on this context
  - Write test files ONLY after user approval

**NATURAL CONVERSATION**:
  - If the user asks questions or provides feedback, respond naturally
  - Revise your proposal based on their input
  - You can iterate on the plan through conversation before they approve
</workflow>`,
  );
};
