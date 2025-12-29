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
# Example: Finding tests for src/services/auth.py (or .ts, .go, .rs, etc.)
# Extract base filename (auth) from path - adjust extension for your language
BASENAME=$(basename src/services/auth.py .py)

# 1. Co-located tests (same directory as source file)
# Works for any language: *test* and *spec* patterns match common test naming conventions
find src/services -name "\${BASENAME}*test*" -o -name "\${BASENAME}*spec*" 2>/dev/null

# 2. Tests in __tests__ subdirectory
find . -path "*/__tests__/*\${BASENAME}*test*" -o -path "*/__tests__/*\${BASENAME}*spec*" 2>/dev/null

# 3. Tests in tests/ or test/ directories
find . ( -path "*/tests/*" -o -path "*/test/*" ) -name "*\${BASENAME}*test*" -o -name "*\${BASENAME}*spec*" 2>/dev/null

# 4. Any location with matching filename pattern
find . -name "*\${BASENAME}*test*" -o -name "*\${BASENAME}*spec*" 2>/dev/null | head -10

# 5. Check conventional location directly
cat src/services/__tests__/\${BASENAME}*spec* 2>/dev/null || echo "NO_TESTS_FOUND"
\`\`\`

**Step 1.5: Analyze Git Diff for Changed Files**

**CRITICAL**: If a file has been edited, you MUST read the git diff to fully understand what changed. The diff shows:
- What code was added, removed, or modified
- Which functions/methods changed
- What lines were affected
- Context around changes

\`\`\`bash
# For uncommitted changes (working directory) - works for any file type
git diff -- path/to/changed/file

# For committed changes (compare with previous commit)
git diff HEAD~1 -- path/to/changed/file

# For branch changes (compare with base branch, e.g., main)
git diff main...HEAD -- path/to/changed/file

# For uncommitted changes including staged
git diff HEAD -- path/to/changed/file
\`\`\`

**What to look for in the diff:**
- **Function signatures changed**: Parameters added/removed/reordered, return types changed
- **Functions renamed**: Old name → new name
- **New functions added**: Entirely new code blocks
- **Code removed**: Deleted functions or logic
- **Logic modified**: Changed conditionals, error handling, business rules
- **Imports changed**: New dependencies added or removed
- **Class/interface changes**: Properties added/removed, method signatures changed

**Use the diff to:**
1. Identify exactly which functions/methods changed
2. Understand the scope of changes (minor vs. major refactor)
3. Determine which existing tests will break
4. Identify what new test coverage is needed
5. See context around changes (what code was nearby)

**Step 2: Analyze Changes and Determine Impact**

If tests exist, categorize the changes:

**A. API Signature Changes** (tests MUST be updated):
- Function parameter changes (added, removed, reordered, type changed)
- Return type changes
- Function/method renamed
- Class constructor changes
- Component prop changes

Example (framework-agnostic):
\`\`\`
// BEFORE
function processUser(userId) { }

// AFTER  
function processUser(userId, options) { }
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

// AFTER (now returns object/dict)
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

Example format in Problem Summary:
\`\`\`markdown
## Problem Summary

3 testing issues identified:

1. **Existing tests require updates** - \`processUser\` signature changed (added \`options\` parameter, lines 45-60). 8 test cases in \`auth.spec.*\` (or \`test_auth.*\`) must be updated to pass new parameter.

2. **New tests needed** - New validation logic added (lines 62-75) with no test coverage. Need 3 new test cases for validation edge cases.

3. **Mock updates required** - \`UserService\` interface changed (renamed \`getData\` to \`fetchData\`). All mocks in test files must be updated.
\`\`\`

**Why This Matters:**

- **Prevents test failures**: Updates catch breaking changes before they cause CI failures
- **Maintains coverage**: Existing tests remain effective after code changes
- **Reduces maintenance**: Keeps tests synchronized with implementation
- **Faster iterations**: Update existing tests is often faster than writing from scratch
</test_update_detection>`,
  );

