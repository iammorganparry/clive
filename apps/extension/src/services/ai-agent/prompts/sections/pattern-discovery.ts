/**
 * Pattern Discovery Section
 * Instructions for researching existing test patterns and mock factories
 */

import { Effect } from "effect";
import type { Section } from "../types.js";
import { getToolName } from "../tool-names.js";

export const patternDiscovery: Section = (config) => {
  const proposeTestPlan = getToolName("proposeTestPlan", config);

  return Effect.succeed(
    `<pattern_discovery>
**MANDATORY CHECKLIST: Complete Before Proposing Tests**

This is a REQUIRED checklist for plan mode. You MUST complete all steps and document findings in ${proposeTestPlan}.

**1. FIND SIMILAR TEST FILES** (MANDATORY):
   - **Unit tests**: Search comprehensively using multiple patterns:
     * Co-located tests: \\\`find src \\( -name "*.test.*" -o -name "*.spec.*" \\) | head -10\\\`
     * Tests in __tests__: \\\`find . -path "*/__tests__/*" | head -10\\\`
     * Tests in tests/ directories: \\\`find . \\( -path "*/tests/*" -o -path "*/test/*" \\) | head -10\\\`
   - **Integration tests**: Search for files with "integration" in path or filename
   - **E2E tests**: Search in \\\`e2e/\\\`, \\\`cypress/\\\`, \\\`playwright/\\\`, \\\`tests/e2e/\\\` directories
   - **Document**: List paths of 2-3 similar test files in discoveredPatterns.testPatterns

**2. READ SIMILAR TEST FILES** (MANDATORY):
   - Read at least 1-2 similar test files completely
   - Document patterns found:
     * Import patterns and module paths
     * Test structure (describe/it, test suites)
     * Setup/teardown patterns (beforeEach, afterEach, beforeAll)
     * Mock setup and dependency injection
     * Assertion patterns and helpers
   - **Document**: Add patterns to discoveredPatterns.testPatterns

**3. DISCOVER ALL MOCK FACTORIES** (MANDATORY):
   - Search comprehensively:
     * \\\`find . -path "*mock-factor*" -o -path "*/__mocks__/*"\\\`
     * \\\`ls -la __tests__/mock-factories/ test/helpers/ 2>/dev/null\\\`
   - List all mock factory files found
   - Read existing mock factory files to understand patterns
   - **Document**: Add ALL paths to discoveredPatterns.mockFactoryPaths
   - **Map**: For each dependency, check if mock factory exists and document in mockDependencies

**4. IDENTIFY DATABASE/CONNECTION PATTERNS** (MANDATORY):
   - **Database connections**:
     * Search: \\\`grep -r "createClient\\|new.*Client\\|connect.*database\\|supabase" --include="*.ts" --include="*.tsx" src | head -15\\\`
     * Check for: PostgreSQL, MySQL, MongoDB, Supabase, Prisma clients
     * Document connection initialization patterns
   - **Database test patterns**:
     * Search: \\\`grep -r "beforeAll\\|beforeEach" --include="*.test.*" --include="*.spec.*" | grep -i "database\\|db\\|client" | head -10\\\`
     * Check for setup/teardown patterns with DB
     * Look for test database configuration
   - **Document**: Add to externalDependencies with type="database"

**5. IDENTIFY API/EXTERNAL SERVICE PATTERNS** (MANDATORY):
   - **API calls**:
     * Search: \\\`grep -r "fetch\\|axios\\|http\\.get\\|http\\.post" --include="*.ts" --include="*.tsx" src | head -15\\\`
     * Check for REST APIs, GraphQL, external services
   - **File system operations**:
     * Search: \\\`grep -r "fs\\.\\|readFile\\|writeFile\\|existsSync" --include="*.ts" | head -10\\\`
   - **Network operations**:
     * Search: \\\`grep -r "WebSocket\\|socket\\.io\\|net\\.connect" --include="*.ts" | head -10\\\`
   - **Document**: Add to externalDependencies with appropriate type

**6. CHECK TEST ENVIRONMENT SETUP** (MANDATORY):
   - Check for Docker/sandbox: \\\`ls docker-compose.yml .env.test .clive/.env.test 2>/dev/null\\\`
   - Check for test database: \\\`cat .env.test 2>/dev/null | grep DATABASE\\\`
   - Check for test configuration files
   - **Document**: Note sandbox requirements in externalDependencies.testStrategy

**7. MAP DEPENDENCIES TO MOCK STRATEGIES** (MANDATORY):
   - For EACH dependency in target files:
     * Check if mock factory already exists (from step 3)
     * Determine mock strategy: "factory" (use/create), "inline" (simple), "spy" (wrap real)
     * Document in mockDependencies array
   - For EACH external dependency (from steps 4-5):
     * Determine test strategy: "sandbox" (Docker), "mock" (fake), "skip" (not testing)
     * Document in externalDependencies array

**Mock Factory Pattern (Reference):**

\\\`\\\`\\\`typescript
// GOOD: Centralized mock factory with overrides
function createMockService(overrides = {}) {
  return {
    method1: overrides.method1 ?? vi.fn().mockResolvedValue("default"),
    method2: overrides.method2 ?? vi.fn(),
    ...overrides
  };
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
};
// This should be in a factory instead!
\\\`\\\`\\\`

**CRITICAL: Act Mode Depends on This**

- Act mode will NOT rediscover this information
- All mock strategies, patterns, and dependencies must be documented NOW
- Incomplete discovery leads to failures in act mode
- Take the time to complete this checklist thoroughly

**Why This Matters:**

- **DRY Principle**: One source of truth for each mock
- **Consistency**: All tests use the same mocking patterns
- **Maintainability**: Changes to mocks happen in one place
- **Discoverability**: Future developers find existing mocks easily
- **Prevents Re-planning**: Act mode has everything it needs
</pattern_discovery>`,
  );
};
