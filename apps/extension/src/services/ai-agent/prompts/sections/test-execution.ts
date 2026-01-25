/**
 * Test Execution Section
 * Instructions for running and verifying tests
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const testExecution: Section = (_config) =>
  Effect.succeed(
    `<test_execution>
**Running Tests to Verify Implementation**

**CRITICAL: Before running ANY test, search knowledge base for test-execution patterns**

Before running tests, you MUST:
1. Search knowledge base for test-execution patterns matching the test type (unit, integration, E2E)
2. Use the documented command from knowledge base if available
3. If not found in knowledge base, fall back to analyzing package.json and config files
4. Verify the command exists before executing

After writing test files, use bashExecute to run test commands and verify they pass:

1. **Unit tests**: Run directly without special setup
   - First: searchKnowledge("test-execution unit") to find documented commands
   - Use documented command from knowledge base, or fallback: \\\`npx vitest run src/components/Button.test.tsx\\\`
   - No Docker or sandbox needed
   - Commands execute from workspace root automatically

2. **Integration/E2E tests**: MUST use sandbox environment
   - First: searchKnowledge("test-execution integration") or searchKnowledge("test-execution e2e")
   - See \\\`<sandbox_execution>\\\` section below for required Docker sandbox setup
   - NEVER run integration/E2E tests without sandbox setup first
   - Tests run against local Docker services, NOT production

**Running individual tests** (for complex setup scenarios):
- Vitest/Jest: Use \\\`--grep "test name"\\\` or \\\`-t "test name"\\\` flag
  Example: \\\`npx vitest run src/components/Button.test.tsx -t "should render"\\\`
- Playwright: Use \\\`--grep "test name"\\\` flag
  Example: \\\`npx playwright test tests/e2e/login.spec.ts --grep "should login"\\\`
- Cypress: Use \\\`--spec\\\` with specific file path, or modify test to use \\\`it()\\\`
  Example: \\\`npx cypress run --spec cypress/e2e/login.cy.ts\\\`

**Test command examples** (all paths relative to workspace root):
- Full suite: \\\`npx vitest run src/components/Button.test.tsx\\\`
- Single test: \\\`npx vitest run src/components/Button.test.tsx -t "should render"\\\`
- With npm: \\\`npm run test -- src/components/Button.test.tsx\\\`
- Playwright: \\\`npx playwright test tests/e2e/login.spec.ts --grep "should login"\\\`

**Interpreting test results**:
- Exit code 0 = test passed, proceed to next suite
- Exit code non-zero = test failed, analyze error output, fix and re-run
- Check stdout and stderr output for error details
</test_execution>`,
  );
