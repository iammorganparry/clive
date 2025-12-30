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
   - Read and understand the existing tests (use \`cat -n\` to see line numbers)
   - **Determine if tests need updates or additions** (see test-update-detection section)
   - For small changes: Use \`editFile\` with specific line numbers (token-efficient)
   - For extensive changes: Use \`writeTestFile\` with \`overwrite=true\` to rewrite the entire file
3. If the file doesn't exist ("FILE_NOT_FOUND"):
   - Use \`writeTestFile\` to create a new test file

This prevents accidentally overwriting existing tests without understanding them first.

**Updating vs. Adding Tests:**

When a test file exists, distinguish between:

**A. UPDATING existing test cases** (when source code changed):
- Function signatures changed (parameters, return types)
- Function/component renamed
- Mock interfaces changed
- Expected behavior modified
- Use \`editFile\` to update specific test case lines (token-efficient)

**B. ADDING new test cases** (when coverage is incomplete):
- New functions/methods added to source
- New conditional branches added
- New edge cases need coverage
- Use \`editFile\` to insert new test cases at specific line positions

**CRITICAL: One Test Case at a Time**

You MUST create tests iteratively, one test case at a time. This ensures setup and mocking issues are caught immediately rather than after writing many tests that all fail for the same reason.

**Iterative Process:**

1. **Start with ONE test case** - Write the simplest, most fundamental test case first
   - This test should verify basic setup works (imports resolve, mocks are configured correctly, test framework is working)
   - Example: Test a simple function call, basic component render, or minimal integration point
   - Use writeTestFile to create the test file with just this ONE test case

2. **Verify the first test passes** - IMMEDIATELY run the test after writing it
   - Use bashExecute to run the test command
   - If it fails, fix the setup/mocking issues before adding more tests
   - Do NOT proceed to add more tests until this first test passes

3. **Add the next test case** - Once the first test passes, add ONE more test case
   - Use editFile to insert the new test case at the appropriate line position
   - Specify the line numbers where to insert the new test
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
- Use editFile to add test cases incrementally (token-efficient for large files)
- Use writeTestFile with overwrite=true only for new files or extensive changes
</iterative_test_creation>`,
  );

