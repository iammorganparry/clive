/**
 * Iterative Testing Section
 * Rules for incremental test creation approach
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const iterativeTesting: Section = (_config) =>
  Effect.succeed(
    `<iterative_test_creation>
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
   - Use replaceInFile to add the new test case to the existing test file
   - OR use writeTestFile with overwrite=true to update the file
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

