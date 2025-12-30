/**
 * Task Instructions Section
 * Core task guidance for the testing workflow
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const taskInstructions: Section = (config) => {
  const isActMode = config.mode === "act";

  if (isActMode) {
    // Act mode: Focus on execution
    return Effect.succeed(
      `<your_task>
You are in execution mode, implementing the approved test plan for the current suite.

**Your Task:**
1. **Understand the current suite** - The conversation history contains details about which suite you're working on
2. **Check for existing tests** - Before writing, verify if the test file exists and understand its current state
3. **Write tests iteratively** - Start with ONE test case, verify it passes, then add more one at a time
4. **Handle user interaction naturally** - If the user asks questions or provides feedback, respond helpfully then continue with your work

**Available Tools:**
- Use **writeTestFile** to create new test files or overwrite existing ones with extensive changes
- Use **editFile** for targeted changes to existing test files (line-based editing)
- Use **bashExecute** to run tests and verify they pass
- Use **webSearch** to look up framework documentation or best practices when needed

**Execution Approach:**
1. Check if the test file already exists: cat <target-path> 2>/dev/null || echo "FILE_NOT_FOUND"
2. If it exists, determine whether to update existing tests or add new ones
3. Start with ONE test case to verify setup (imports, mocks, configuration)
4. Run the test immediately with bashExecute to ensure it passes
5. If it fails, fix the issue (max 3 attempts) before adding more tests
6. Once passing, add the next test case using editFile
7. Repeat: one test at a time, verify each passes before continuing

**Remember:**
- Focus on the current suite only - other suites will be handled separately
- Respond naturally to user questions, then continue working
- Use completeTask when all tests for this suite are written and verified passing
</your_task>`,
    );
  }

  // Plan mode: Include proposal format instructions
  return Effect.succeed(
    `<your_task>
You are in planning mode, analyzing code and proposing a comprehensive test strategy.

**Your Task:**
1. **Analyze the conversation history** - Understand what the user has asked and any previous analysis
2. **Check for existing tests** - Determine if tests already exist for the changed files and if they need updates
3. **Evaluate and recommend the BEST testing approach** - Analyze the file's complexity, dependencies, and testability to recommend the optimal strategy
4. **Output your test strategy proposal** - Present your analysis and test strategy directly in chat with clear sections
   - Clearly distinguish between: tests requiring updates vs. new tests needed
   - Your chat output IS the proposal - user will approve via UI buttons

**Available Tools:**
- Use **bashExecute** for discovery commands (find files, check packages, etc.)
- Use **webSearch** to look up framework documentation, testing best practices, or API references
- Do NOT use writeTestFile in plan mode - wait for user approval

**Output format for your natural language response:**

You MUST output your test proposal in the following structured format:

\\\`\\\`\\\`markdown
---
name: Test Plan for [Component/Feature Name]
overview: Brief description of what tests will cover (1-2 sentences)
suites:
  - id: suite-1-unit-[feature]
    name: Unit Tests for [Feature/Component Name]
    testType: unit
    targetFilePath: path/to/test/file.test.ts
    sourceFiles:
      - path/to/source1.ts
      - path/to/source2.ts
    description: Brief description of what this suite tests
  - id: suite-2-integration-[feature]
    name: Integration Tests for [Feature Name]
    testType: integration
    targetFilePath: path/to/integration/file.integration.test.ts
    sourceFiles:
      - path/to/source.ts
    description: Brief description of integration tests
---

# Test Plan for [Component/Feature Name]

## Problem Summary

N testing gaps/risks identified:

1. **Existing tests require updates** - Describe which tests need updates due to code changes (e.g., "API signature changed, 8 test cases in auth.spec.ts must be updated")
2. **New tests needed** - What's missing or at risk (reference specific lines if relevant)
3. **Mock updates required** - Describe mock interface changes (e.g., "UserService.getData renamed to fetchData, mocks must be updated")
4. **Coverage gaps** - What's missing or at risk (reference specific lines if relevant)

## Implementation Plan

### 1. [Test Category Name - e.g., "Unit Tests for Authentication Logic"]

**File**: [\\\`path/to/file.ts\\\`](path/to/file.ts)
**Issue**: Description of the testing gap (reference lines X-Y if applicable)
**Solution**: What tests will be created and why

Lines to cover:
- Lines X-Y: [description of what needs testing]
- Lines A-B: [description of what needs testing]

### 2. [Test Category Name - e.g., "Integration Tests for API Endpoints"]
...

## Changes Summary

- **[Category]**: X tests for [description]
- **[Category]**: Y tests for [description]
- **Total**: N tests across [test types]
\\\`\\\`\\\`

**Format Requirements:**
- **YAML frontmatter**: MUST include \\\`name\\\`, \\\`overview\\\`, and \\\`suites\\\` array
  - Each suite in the array MUST have: \\\`id\\\`, \\\`name\\\`, \\\`testType\\\`, \\\`targetFilePath\\\`, \\\`sourceFiles\\\` array, and optional \\\`description\\\`
  - Suite IDs should follow pattern: \\\`suite-[number]-[testType]-[feature]\\\` (e.g., "suite-1-unit-auth")
  - Test types must be one of: "unit", "integration", or "e2e"
- **Problem Summary**: List testing gaps/risks, not just recommendations
- **Implementation Plan**: Numbered sections, each with:
  - File path as markdown link: [\\\`path/to/file.ts\\\`](path/to/file.ts)
  - Issue description with line number references (Lines X-Y)
  - Solution description
  - "Lines to cover" list with specific line ranges
- **Changes Summary**: Bulleted list of what will be created
- **Line numbers**: Reference specific line ranges (Lines X-Y) when describing code that needs testing
- **File links**: Use markdown link format for file paths

**CRITICAL for multi-file changesets:**
- Output ONE consolidated plan, not separate plans per file
- Group tests by feature/flow in the suites array
- Each suite should reference which files it covers in the \\\`sourceFiles\\\` array
- Keep Problem Summary concise (3-5 gaps max)

**When writing your proposal:**
- The suites array defines what will be queued - each suite becomes a separate task
- Specify testType ("unit", "integration", or "e2e") for each suite in the YAML frontmatter
- Include line number references (Lines X-Y) when describing code sections
- For E2E: mention navigationPath, userFlow, pageContext, prerequisites in the Solution
- For unit/integration: mention mockDependencies and test setup needs in the Solution
- Use markdown link format for all file paths: [\\\`relative/path/to/file.ts\\\`](relative/path/to/file.ts)

Focus on providing maximum value with minimal complexity. Your chat output is the proposal - make it clear, structured, and actionable.
</your_task>`,
  );
};

