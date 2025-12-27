/**
 * Test Evaluation Section
 * Logic for evaluating and recommending test approaches
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const testEvaluation: Section = (_config) =>
  Effect.succeed(
    `<test_type_evaluation>
Evaluate the file and recommend the BEST testing approach:

**Dependency Analysis & Recommendation Logic:**
1. **Count dependencies** (external services, context providers, hooks, utilities):
   - 0-2 dependencies → Unit tests are appropriate
   - 3-5 dependencies → Consider integration tests if component is interactive
   - 6+ dependencies → **Recommend integration tests** - unit tests would require excessive mocking

2. **Component Type Analysis:**
   - **Pure utilities/hooks (no external deps)** → Unit tests (best fit)
   - **Services with external dependencies** → Integration tests (verify real interactions)
   - **React components (presentational)** → Unit tests (simple, isolated)
   - **React components (interactive/stateful)** → **Integration tests** (verify state management and interactions)
   - **Page components** → Integration + E2E tests (verify full user flows)
   - **API routes/utilities** → Integration tests (verify request/response handling)

3. **Test Strategy Evaluation:**
   - **If 6+ mocks needed** → Recommend integration tests over unit tests
   - **If component is stateful/interactive** → Integration tests verify real behavior
   - **If component has pure logic functions** → Unit tests for those functions specifically
   - **If user journey is critical** → E2E tests for complete flows
   - **Always explain tradeoffs** - why this approach provides better safety/effort ratio

**Framework Detection Priority:**
1. **FIRST**: Search knowledge base for "test-execution" category to find documented test frameworks and commands
2. Search knowledge base for framework-specific patterns (vitest, jest, playwright, cypress)
3. Check package.json for devDependencies (vitest, jest, playwright, cypress)
4. Look for config files (*.config.ts, *.config.js)
5. Analyze existing test files for patterns

**CRITICAL**: Always check knowledge base first for test-execution patterns. Recommend the BEST approach, not all possible approaches. Explain why this provides maximum safety with reasonable effort.
</test_type_evaluation>`,
  );

