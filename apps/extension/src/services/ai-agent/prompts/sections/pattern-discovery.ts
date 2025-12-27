/**
 * Pattern Discovery Section
 * Instructions for researching existing test patterns and mock factories
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const patternDiscovery: Section = (_config) =>
  Effect.succeed(
    `<pattern_discovery>
**MANDATORY: Research Before Writing**

Before writing ANY test file, you MUST:

1. **Find similar test files** (same test type):
   - Unit tests: \\\`find . -name "*.spec.ts" -o -name "*.test.ts" | head -5\\\`
   - Integration tests: Search for files containing "integration" in path
   - E2E tests: Search for files in \\\`e2e/\\\`, \\\`cypress/\\\`, \\\`playwright/\\\` directories
   
2. **Read 1-2 similar test files** to understand:
   - Import patterns and module paths
   - Test structure (describe/it organization)
   - Setup/teardown patterns (beforeEach, afterEach)
   - Mock setup and dependency injection
   - Assertion patterns and helpers

3. **Search for existing mock factories**:
   - Check \\\`__tests__/mock-factories/\\\` or \\\`test/helpers/\\\`
   - Search for \\\`createMock\\\` or \\\`MockFactory\\\` patterns: \\\`find . -path "*mock-factor*" -o -path "*/__mocks__/*" | head -5\\\`
   - Look for shared test utilities and helper files

4. **REUSE existing mocks** - Never duplicate mock code:
   - Import from centralized mock factories
   - Use existing mock creation functions
   - If a mock doesn't exist, ADD it to the factory (see rule 5)
   - Example: \\\`import { createVSCodeMock } from "../__tests__/mock-factories"\\\`

5. **EXTEND mock factories** when new mocks are needed:
   - Add to existing factory file rather than creating inline
   - Follow the factory's naming conventions (e.g., \\\`createMockXXX\\\`)
   - Export the new mock for future reuse
   - Use configurable overrides pattern for flexibility

**Mock Factory Pattern (Reference):**

\\\`\\\`\\\`typescript
// GOOD: Centralized mock factory with overrides
export function createMockService(
  overrides?: Partial<ServiceInterface>
): ServiceInterface {
  return {
    method1: overrides?.method1 ?? vi.fn().mockResolvedValue("default"),
    method2: overrides?.method2 ?? vi.fn(),
  } as ServiceInterface;
}

// GOOD: Using the factory in tests
import { createMockService } from "../__tests__/mock-factories";
const mockService = createMockService({
  method1: vi.fn().mockResolvedValue("custom"),
});
\\\`\\\`\\\`

\\\`\\\`\\\`typescript
// BAD: Inline mock duplication
const mockService = {
  method1: vi.fn().mockResolvedValue("value"),
  method2: vi.fn(),
} as ServiceInterface;
// This should be in a factory instead!
\\\`\\\`\\\`

**Pattern Research Workflow:**

1. **Before writing tests**:
   - Run \\\`find\\\` commands to locate similar test files and mock factories
   - Read 1-2 similar test files to understand project conventions
   - Check if mock factories exist for dependencies you need to mock

2. **While writing tests**:
   - Import mocks from factories, don't recreate them
   - Follow the test structure patterns you discovered
   - Match the import style and organization you observed

3. **When you need a new mock**:
   - Don't create it inline in your test file
   - Add it to the appropriate mock factory file
   - Export it so future tests can reuse it
   - Follow the naming pattern: \\\`createMockXXX\\\`

**Why This Matters:**

- **DRY Principle**: One source of truth for each mock
- **Consistency**: All tests use the same mocking patterns
- **Maintainability**: Changes to mocks happen in one place
- **Discoverability**: Future developers find existing mocks easily
</pattern_discovery>`,
  );

