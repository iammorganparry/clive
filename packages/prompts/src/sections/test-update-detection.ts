/**
 * Test Update Detection Section
 * Instructions for detecting when existing tests need updates vs. new tests
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const testUpdateDetection: Section = (_config) =>
  Effect.succeed(
    `<test_update_detection>
**CRITICAL: Detect When Existing Tests Need Updates**

When analyzing code changes, you MUST determine whether existing tests need updates or new tests should be added.

**Step 1: Check for Existing Tests**

For each changed file, comprehensively search for existing tests using multiple patterns:
\`\`\`bash
# Example: Finding tests for src/services/auth.ts (adjust extension for your language)
BASENAME=$(basename src/services/auth.ts .ts)

# 1. Co-located tests (same directory as source file)
find src/services -name "\${BASENAME}*test*" -o -name "\${BASENAME}*spec*" 2>/dev/null

# 2. Tests in __tests__ subdirectory
find . -path "*/__tests__/*\${BASENAME}*test*" -o -path "*/__tests__/*\${BASENAME}*spec*" 2>/dev/null

# 3. Tests in tests/ or test/ directories
find . \\( -path "*/tests/*" -o -path "*/test/*" \\) -name "*\${BASENAME}*" 2>/dev/null | head -10

# 4. Check conventional location directly
cat src/services/__tests__/\${BASENAME}*spec* 2>/dev/null || echo "NO_TESTS_FOUND"
\`\`\`

**Step 1.5: Analyze Git Diff for Changed Files**

**CRITICAL**: If a file has been edited, you MUST read the git diff to fully understand what changed:
\`\`\`bash
# For uncommitted changes
git diff -- path/to/changed/file

# For branch changes (compare with base branch)
git diff main...HEAD -- path/to/changed/file
\`\`\`

**What to look for in the diff:**
- **Function signatures changed**: Parameters added/removed/reordered, return types changed
- **Functions renamed**: Old name → new name
- **New functions added**: Entirely new code blocks
- **Code removed**: Deleted functions or logic
- **Logic modified**: Changed conditionals, error handling, business rules
- **Imports changed**: New dependencies added or removed

**Step 2: Analyze Changes and Determine Impact**

If tests exist, categorize the changes:

**A. API Signature Changes** (tests MUST be updated):
- Function parameter changes (added, removed, reordered, type changed)
- Return type changes
- Function/method renamed
- Class constructor changes
- Component prop changes

**B. Behavior Changes** (tests may need updates or additions):
- Changed business logic
- Modified error handling
- New conditional paths
- Changed validation rules

**C. Dependency Changes** (mocks may need updates):
- New imported dependencies
- Removed dependencies
- Changed dependency usage

**D. New Features** (new tests should be added):
- New functions/methods added
- New conditional branches
- New error cases
- New edge cases

**Step 3: Plan Updates vs. New Tests**

**UPDATE existing tests when:**
- API signatures changed (parameters, return types)
- Function/component renamed
- Existing behavior modified
- Mock interfaces changed due to dependency updates
- Tests will fail due to code changes

**ADD new tests when:**
- New functions/methods added
- New conditional paths/branches added
- New error handling added
- New edge cases introduced
- Existing tests remain valid but coverage is incomplete

**Step 4: Execution Strategy**

**For test updates:**
1. Read the existing test file with line numbers
2. Identify which test cases are affected by changes
3. Use targeted edits with specific line numbers to update test cases
4. Update function calls, assertions, or mocks as needed
5. Run tests to verify updates work

**For new tests:**
1. Use targeted edits to add new test cases at specific line positions
2. Follow the pattern of existing tests in the file
3. Add one test case at a time, verify each passes

**Common Update Patterns:**

**1. Parameter Addition:**
\`\`\`
// BEFORE in test
expect(processUser('user-123')).resolves.toBe(result);

// AFTER (add new parameter)
expect(processUser('user-123', { validate: true })).resolves.toBe(result);
\`\`\`

**2. Return Type Change:**
\`\`\`
// BEFORE
expect(result).toBe('success');

// AFTER (now returns object)
expect(result).toEqual({ status: 'success', data: expect.any(Object) });
\`\`\`

**3. Mock Interface Change:**
\`\`\`
// BEFORE
const mockService = { getData: mockFn() };

// AFTER (method renamed)
const mockService = { fetchData: mockFn() };
\`\`\`

**4. Function Rename:**
\`\`\`
// BEFORE
import { processUser } from './auth';

// AFTER
import { authenticateUser } from './auth';
\`\`\`

**In Your Proposal:**

Clearly distinguish in your plan between:
- **Tests requiring updates**: List which existing tests need changes and why
- **New tests needed**: List what new test cases should be added

**Why This Matters:**

- **Prevents test failures**: Updates catch breaking changes before they cause CI failures
- **Maintains coverage**: Existing tests remain effective after code changes
- **Reduces maintenance**: Keeps tests synchronized with implementation
- **Faster iterations**: Updating existing tests is often faster than writing from scratch
</test_update_detection>`,
  );
