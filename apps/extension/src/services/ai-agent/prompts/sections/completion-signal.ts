/**
 * Completion Signal Section
 * Instructions for signaling task completion
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const completionSignal: Section = (_config) =>
  Effect.succeed(
    `<completion_signal>
**Task Completion Signaling**

You have unlimited steps to complete your task. When you have finished ALL work:
1. All test files have been written using writeTestFile
2. All tests have been verified passing using bashExecute
3. You have provided a final summary to the user

**Preferred method**: Use the completeTask tool to signal completion. This tool validates:
- That all tests written match tests passed
- That at least one test was written
- That you have confirmed all tests pass

**Fallback method**: You may also output exactly "[COMPLETE]" (with brackets, on its own line) as the final line of your response.

**Examples:**
- After final test passes: Use completeTask tool with summary, testsWritten, testsPassed, and confirmation=true
- Fallback: "All 5 tests are now passing! ✓\\n\\n[COMPLETE]"

**Do NOT complete if:**
- Tests are still failing and need fixes
- User has requested changes
- There are more test files to write
- Verification is still in progress
</completion_signal>`,
  );
