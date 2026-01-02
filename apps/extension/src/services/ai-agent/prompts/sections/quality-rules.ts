/**
 * Quality Rules Section
 * Mandatory test quality requirements
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const qualityRules: Section = (_config) =>
  Effect.succeed(
    `<test_quality_rules>
**MANDATORY Test Quality Requirements**

1. **NO PLACEHOLDER TESTS**:
   - NEVER write tests that assert trivial truths: \\\`expect(true).toBe(true)\\\`
   - NEVER write empty test bodies: \\\`it('should work', () => {})\\\`
   - NEVER skip tests with \\\`.todo()\\\` or \\\`.skip()\\\` unless explicitly requested
   - Every test MUST verify actual behavior from the source code
   - If you cannot determine what to assert, READ the source code again

2. **TYPE SAFETY (TypeScript/Typed Languages)**:
   - ALWAYS match function signatures exactly as they appear in source code
   - NEVER guess parameter types - read the function definition first
   - Use proper typing for mocks: \\\`vi.fn<Parameters, ReturnType>()\\\`
   - Ensure mock return values match expected types
   - If a function returns \\\`Promise<T>\\\`, mock must return \\\`Promise<T>\\\`
   - Import types from source files when needed

3. **NO FABRICATED ARGUMENTS**:
   - ALWAYS read the function signature before writing test calls
   - NEVER invent parameter names or types that don't exist
   - Copy exact parameter structures from source code
   - For objects, use only documented/typed properties
   - If unsure about an argument, use \\\`cat\\\` to read the source file

4. **VERIFY BEFORE WRITING**:
   - Read the function/component source code BEFORE writing tests
   - Check existing test files for patterns and type usage
   - Confirm imports and module paths exist in the codebase
   - Match exact export names (default vs named exports)

**Examples of FORBIDDEN patterns:**

\\\`\\\`\\\`typescript
// BAD: Placeholder test
it('should work', () => {
  expect(true).toBe(true);
});

// BAD: Fabricated arguments
myFunction({ unknownProp: 'value' }); // unknownProp doesn't exist

// BAD: Wrong types
const result = await myAsyncFn(); // forgot to handle Promise
expect(result.data).toBe('x'); // result might be undefined
\\\`\\\`\\\`

**Examples of REQUIRED patterns:**

\\\`\\\`\\\`typescript
// GOOD: Tests actual behavior
it('should return user data when valid ID provided', () => {
  const result = getUserById('123');
  expect(result).toEqual({ id: '123', name: 'Test User' });
});

// GOOD: Type-safe mocks
vi.mock('./api', () => ({
  fetchUser: vi.fn<[string], Promise<User>>(),
}));

// GOOD: Exact signature match
// Source: function createUser(name: string, email: string): User
createUser('John', 'john@example.com'); // matches signature exactly
\\\`\\\`\\\`

5. **DRY TEST CODE**:
   - Test code MUST follow the same DRY principles as production code
   - ALWAYS check for existing mock factories before creating mocks
   - NEVER duplicate mock code - import from centralized factories
   - If a mock doesn't exist, add it to the factory (don't create inline)
   - Follow existing naming conventions for mocks (e.g., \\\`createMockXXX\\\`)
   - Use existing test helpers and utilities
   - Extract shared test setup, teardown, and assertion helpers into reusable utilities
   - Look for opportunities to create test utilities when patterns repeat across multiple tests

**Mock Factory Examples:**

\\\`\\\`\\\`typescript
// GOOD: Using centralized mock factory
import { createVSCodeMock } from "../__tests__/mock-factories";
const vscode = createVSCodeMock({
  workspaceFolders: [{ uri: { fsPath: "/test" } }],
});

// BAD: Inline mock duplication
const vscode = {
  workspace: { workspaceFolders: [{ uri: { fsPath: "/test" } }] },
  // ... duplicating factory code
};
\\\`\\\`\\\`
</test_quality_rules>`,
  );
