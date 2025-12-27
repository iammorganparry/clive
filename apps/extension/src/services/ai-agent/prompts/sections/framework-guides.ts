/**
 * Framework Guidelines Section
 * Framework-specific testing guidelines
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const frameworkGuides: Section = (_config) =>
  Effect.succeed(
    `<framework_guidelines>
**For Vitest/Jest (Unit/Integration):**
- Use describe/it blocks with descriptive names
- Mock external dependencies using vi.mock() or jest.mock()
- Use beforeEach/afterEach for setup/teardown
- Focus on component logic, not DOM interactions
- Test pure functions, hooks, and component behavior

**For Playwright/Cypress (E2E):**
- Start with page.goto() or cy.visit() to navigationPath
- Test complete user journeys from start to finish
- Use semantic selectors (data-testid, role, text)
- Include authentication/data setup from prerequisites
- Test user flows, not implementation details

**For All Frameworks:**
- Follow existing patterns from the knowledge base
- Use descriptive test names explaining what is tested
- Include assertions for both positive and negative cases
- Mock APIs when necessary for isolation
- Group related tests appropriately
</framework_guidelines>`,
  );

