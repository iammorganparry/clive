/**
 * Verification Rules Section
 * Rules for iterative test verification
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const verification: Section = (_config) =>
  Effect.succeed(
    `<verification_rules>
**STOP AFTER EACH TEST CASE**

After EVERY test case addition:
1. **IMMEDIATELY run test** → Run the test command for the specific file
2. **Check result**:
   - PASS (exit code 0) → Proceed to add the next test case
   - FAIL (exit code non-0) → Fix with targeted edits, re-run
3. **Max 3 fix attempts** → then ask user for help

**DO NOT add another test case until the current one passes**

**CRITICAL: Every test case MUST pass before adding the next one**

1. **After writing ONE test case**:
   - IMMEDIATELY run the test command to verify it passes
   - Do NOT add the next test case until current one passes
   - **For integration/E2E tests**: Follow \`<sandbox_execution>\` workflow BEFORE running the test command

2. **If test fails**:
   - Analyze the error output (check stdout and stderr)
   - Fix the test code using targeted edits
   - Re-run the test with the same command
   - **For integration/E2E tests**: Ensure sandbox is still running before re-running
   - Maximum 3 fix attempts per test case before asking user for help

3. **Complex setup detection** (ALWAYS requires one-test-at-a-time verification):
   - 3+ mock dependencies
   - External service mocking (APIs, databases)
   - Complex state setup (auth, fixtures)
   - **When you detect these**: Start with ONE test case, verify it passes, then add the next

4. **Running individual tests**:
   - Vitest/Jest: Use \`--grep "test name"\` or \`-t "test name"\` in the command
   - Playwright: Use \`--grep "test name"\` in the command
   - Cypress: Use \`--spec\` with the test file path

5. **Test case progression** (iterative build-up):
   - Write test case 1 → verify it passes
   - Add test case 2 → verify both pass
   - Add test case 3 → verify all three pass
   - Continue until all planned test cases are implemented
   - Never write multiple test cases before verifying the previous ones pass

6. **All paths are relative to workspace root**:
   - Test file paths: \`src/components/Button.test.tsx\` (not absolute paths)
   - Commands run from workspace root automatically

7. **Sandbox setup for integration/E2E tests**:
   - ALWAYS follow \`<sandbox_execution>\` workflow before running integration/E2E tests
   - Unit tests do NOT require sandbox setup
   - If Docker is unavailable, inform user that integration/E2E tests cannot run

**Remember**: The goal is to catch setup/mocking issues early. Writing one test case at a time ensures you discover configuration problems immediately, not after investing time in many tests that all fail for the same reason.
</verification_rules>`,
  );
