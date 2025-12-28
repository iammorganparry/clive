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

For each changed file, check if tests already exist:
\`\`\`bash
# Find test file for src/services/auth.ts
find . -path "*/__tests__/*" -name "*auth*.spec.ts" -o -name "*auth*.test.ts"

# Or check conventional location
cat src/services/__tests__/auth.spec.ts 2>/dev/null || echo "NO_TESTS_FOUND"
\`\`\`

**Step 2: Analyze Changes and Determine Impact**

If tests exist, categorize the changes:

**A. API Signature Changes** (tests MUST be updated):
- Function parameter changes (added, removed, reordered, type changed)
- Return type changes
- Function/method renamed
- Class constructor changes
- Component prop changes

Example:
\`\`\`typescript
// BEFORE
function processUser(userId: string) { }

// AFTER
function processUser(userId: string, options: ProcessOptions) { }
// → Tests calling processUser() must be updated to pass options
\`\`\`

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
1. Read the existing test file
2. Identify which test cases are affected by changes
3. Use \`replaceInFile\` to update specific test cases
4. Update function calls, assertions, or mocks as needed
5. Run tests to verify updates work

**For new tests:**
1. Use \`replaceInFile\` to add new test cases to existing test file
2. Follow the pattern of existing tests in the file
3. Add one test case at a time, verify each passes

**Common Update Patterns:**

**1. Parameter Addition:**
\`\`\`typescript
// BEFORE in test
expect(processUser('user-123')).resolves.toBe(result);

// AFTER (add new parameter)
expect(processUser('user-123', { validate: true })).resolves.toBe(result);
\`\`\`

**2. Return Type Change:**
\`\`\`typescript
// BEFORE
expect(result).toBe('success');

// AFTER (now returns object)
expect(result).toEqual({ status: 'success', data: expect.any(Object) });
\`\`\`

**3. Mock Interface Change:**
\`\`\`typescript
// BEFORE
const mockService = { getData: vi.fn() };

// AFTER (method renamed)
const mockService = { fetchData: vi.fn() };
\`\`\`

**4. Function Rename:**
\`\`\`typescript
// BEFORE
import { processUser } from './auth';

// AFTER
import { authenticateUser } from './auth';
\`\`\`

**In Your Proposal:**

Clearly distinguish in your plan between:
- **Tests requiring updates**: List which existing tests need changes and why
- **New tests needed**: List what new test cases should be added

Example format in Problem Summary:
\`\`\`markdown
## Problem Summary

3 testing issues identified:

1. **Existing tests require updates** - \`processUser\` signature changed (added \`options\` parameter, lines 45-60). 8 test cases in \`auth.spec.ts\` must be updated to pass new parameter.

2. **New tests needed** - New validation logic added (lines 62-75) with no test coverage. Need 3 new test cases for validation edge cases.

3. **Mock updates required** - \`UserService\` interface changed (renamed \`getData\` to \`fetchData\`). All mocks in \`auth.spec.ts\` must be updated.
\`\`\`

**Why This Matters:**

- **Prevents test failures**: Updates catch breaking changes before they cause CI failures
- **Maintains coverage**: Existing tests remain effective after code changes
- **Reduces maintenance**: Keeps tests synchronized with implementation
- **Faster iterations**: Update existing tests is often faster than writing from scratch
</test_update_detection>`,
  );

