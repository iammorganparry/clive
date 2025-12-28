/**
 * Iterative Testing Section
 * Rules for incremental test creation approach
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const iterativeTesting: Section = (_config) =>
  Effect.succeed(
    `<iterative_test_creation>
**CRITICAL: Check for Existing Test Files First**

Before writing ANY test file, you MUST:
1. Check if the test file already exists: \`cat <target-path> 2>/dev/null || echo "FILE_NOT_FOUND"\`
2. If the file exists (content is returned):
   - Read and understand the existing tests
   - **Determine if tests need updates or additions** (see test-update-detection section)
   - For updates: Use \`replaceInFile\` to UPDATE test cases that reference changed code
   - For additions: Use \`replaceInFile\` to ADD new test cases without removing existing ones
   - Never use \`writeTestFile\` with \`overwrite=true\` on existing test files
3. If the file doesn't exist ("FILE_NOT_FOUND"):
   - Use \`writeTestFile\` to create a new test file

This prevents accidentally overwriting existing tests.

**Updating vs. Adding Tests:**

When a test file exists, distinguish between:

**A. UPDATING existing test cases** (when source code changed):
- Function signatures changed (parameters, return types)
- Function/component renamed
- Mock interfaces changed
- Expected behavior modified
- Use \`replaceInFile\` to replace the affected test case with updated version

**B. ADDING new test cases** (when coverage is incomplete):
- New functions/methods added to source
- New conditional branches added
- New edge cases need coverage
- Use \`replaceInFile\` to insert new test cases alongside existing ones

**Example - Updating a test:**
\`\`\`typescript
// Source changed: processUser(userId: string, options: Options)
// Old test needs update:
SEARCH:
  it('should process user', async () => {
    const result = await processUser('user-123');
    expect(result).toBe('success');
  });

REPLACE:
  it('should process user', async () => {
    const result = await processUser('user-123', { validate: true });
    expect(result).toBe('success');
  });
\`\`\`

**CRITICAL: One Test Case at a Time**

You MUST create tests iteratively, one test case at a time. This ensures setup and mocking issues are caught immediately rather than after writing many tests that all fail for the same reason.

**Iterative Process:**

1. **Start with ONE test case** - Write the simplest, most fundamental test case first
   - This test should verify basic setup works (imports resolve, mocks are configured correctly, test framework is working)
   - Example: Test a simple function call, basic component render, or minimal integration point
   - If test file doesn't exist, use writeTestFile to create it with just this ONE test case
   - If test file exists, use replaceInFile to add the test case

2. **Verify the first test passes** - IMMEDIATELY run the test after writing it
   - Use bashExecute to run the test command
   - If it fails, fix the setup/mocking issues before adding more tests
   - Do NOT proceed to add more tests until this first test passes

3. **Add the next test case** - Once the first test passes, add ONE more test case
   - Use replaceInFile to add the new test case to the existing test file
   - NEVER use writeTestFile with overwrite=true - it destroys existing tests
   - Choose the next simplest test case that builds on the first

4. **Verify the second test passes** - Run the test again to ensure both tests pass
   - If it fails, fix the issue before adding more tests
   - This catches issues specific to the new test case

5. **Repeat incrementally** - Continue adding one test case at a time, verifying after each addition
   - Each new test case should be verified before writing the next
   - Build up the test file gradually, ensuring each addition works

**Why This Approach:**

- **Catches setup issues early**: If mocking is wrong, you'll know after the first test, not after writing 10 tests
- **Easier debugging**: When a test fails, you know it's related to the most recent addition
- **Validates configuration**: Ensures test framework, imports, and mocks are working before investing time in more tests
- **Prevents wasted work**: Avoids writing many tests that all fail for the same configuration issue

**What NOT to Do:**

- Write all test cases in a single writeTestFile call
- Write multiple test cases before verifying the first one passes
- Assume setup is correct without running the first test
- Add multiple test cases at once, even if they seem simple

**What TO Do:**

- Write ONE test case first
- Run it immediately to verify setup works
- Fix any issues before adding more tests
- Add test cases one at a time, verifying after each addition
- Use replaceInFile to add test cases incrementally to existing files
</iterative_test_creation>`,
  );

