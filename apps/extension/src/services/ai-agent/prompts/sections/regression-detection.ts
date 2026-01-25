/**
 * Regression Detection Section
 * Instructions for detecting regressions in existing tests related to the changeset
 */

import { Effect } from "effect";
import { getToolName } from "../tool-names.js";
import type { Section } from "../types.js";

export const regressionDetection: Section = (config) => {
  const proposeTestPlan = getToolName("proposeTestPlan", config);

  return Effect.succeed(
    `<regression_detection>
**OPT-IN: Regression Detection for Related Tests**

After reading the changeset files, you SHOULD find existing tests related to the changeset and offer to check for regressions.

**Step 1: Find Related Test Files**
For each file in the changeset, search for existing tests that may be affected:

\`\`\`bash
# Extract base filename without extension (e.g., auth-service from auth-service.ts)
BASENAME=$(basename <changed-file> | sed 's/.[^.]*$//')

# 1. Direct test files for the changed file
find . -name "*\${BASENAME}*test*" -o -name "*\${BASENAME}*spec*" 2>/dev/null

# 2. Tests in __tests__ directories
find . -path "*/__tests__/*\${BASENAME}*" 2>/dev/null

# 3. Check which test files import the changed file
grep -rl "from.*<changed-file-path>" --include="*.test.*" --include="*.spec.*" 2>/dev/null
grep -rl "import.*<changed-file-path>" --include="*.test.*" --include="*.spec.*" 2>/dev/null
\`\`\`

Build a list of all related test files. If no related tests are found, skip regression detection.

**Step 2: Ask the User**
If related tests were found, ask the user:

"I found [N] existing test file(s) related to your changeset:
- [list test files]

Would you like me to run these tests to check for regressions? This helps identify:
- Tests that need updating due to your changes (expected regressions)  
- Potential side effects that may need investigation (unexpected regressions)"

**If User Accepts - Proceed with Steps 3-5:**

**Step 3: Run Related Tests Only**
- Use bashExecute with extended timeout (180000ms)
- Run ONLY the related test files identified in Step 1
- Command patterns:
  * npx vitest run <test-file-1> <test-file-2> ...
  * npx jest <test-file-1> <test-file-2> ...
  * npm test -- <test-file-1> <test-file-2> ...

**Step 4: Analyze and Classify Failures**
For each failing test:
- **Expected Regression**: Test directly imports or tests a changed file
  - The test file imports from a file in the changeset
  - The test is specifically testing functionality in a changed file
  - **Suggested Action**: update_test (update test to match new behavior)
- **Unexpected Regression**: Failure is not obviously related to changes
  - May indicate a side effect or unintended consequence
  - **Suggested Action**: investigate or fix_code

**Step 5: Document in Plan**
Include regressionAnalysis in ${proposeTestPlan} with:
- relatedTestFiles: List of test files that were run
- testsRun, passed, failed counts
- List of failures with classification and suggested action
- Summary of regression status

**If No Related Tests Found or User Declines:**
- Skip regression detection entirely
- Do NOT include regressionAnalysis in ${proposeTestPlan}
- Proceed directly to pattern discovery and test planning
</regression_detection>`,
  );
};
