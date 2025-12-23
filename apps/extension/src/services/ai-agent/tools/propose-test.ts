import { tool } from "ai";
import { z } from "zod";
import type { ProposeTestInput, ProposeTestOutput } from "../types.js";
import { processProposeTestApproval } from "../hitl-utils.js";

/**
 * Factory function to create proposeTestTool with approval callback
 * The execute function waits for user approval before returning
 */
export const createProposeTestTool = (
  waitForApproval?: (
    toolCallId: string,
    input: ProposeTestInput,
  ) => Promise<boolean>,
  approvalRegistry?: Set<string>,
) =>
  tool({
    description:
      "Propose a Cypress test file to be created or updated. This requires user approval before proceeding.",
    inputSchema: z.object({
      sourceFile: z
        .string()
        .describe(
          "The source React component file path that this test will cover",
        ),
      targetTestPath: z
        .string()
        .describe(
          "The proposed target path for the Cypress test file (relative to workspace root)",
        ),
      description: z
        .string()
        .describe(
          "A brief description of what this test will cover (e.g., 'Tests login form interactions and validation')",
        ),
      isUpdate: z
        .boolean()
        .describe(
          "Whether this will update an existing test file (true) or create a new one (false)",
        ),
      // E2E-specific fields
      navigationPath: z
        .string()
        .optional()
        .describe(
          "The URL/route to navigate to in the test (e.g., '/login', '/dashboard'). This is critical for E2E tests - always identify the navigation path.",
        ),
      pageContext: z
        .string()
        .optional()
        .describe(
          "The page component that contains this feature (e.g., 'LoginPage', 'DashboardPage'). Helps understand the application context.",
        ),
      prerequisites: z
        .array(z.string())
        .optional()
        .describe(
          "Prerequisites needed before the test can run (e.g., ['user must be logged in', 'test data must exist']). Critical for E2E test setup.",
        ),
      relatedTests: z
        .array(z.string())
        .optional()
        .describe(
          "Paths to existing test files that may be impacted by this change. Found via semantic search or file discovery.",
        ),
      userFlow: z
        .string()
        .optional()
        .describe(
          "Description of the complete E2E user journey being tested (e.g., 'User logs in, navigates to dashboard, views their profile'). Think about the full user experience, not just the component.",
        ),
      testCases: z
        .array(
          z.object({
            name: z
              .string()
              .describe(
                "Descriptive test case name (e.g., 'should login with valid credentials', 'should display validation error for empty email')",
              ),
            userActions: z
              .array(z.string())
              .describe(
                "Step-by-step user actions for this test case (e.g., ['Navigate to /login', 'Enter email in email field', 'Enter password in password field', 'Click submit button'])",
              ),
            assertions: z
              .array(z.string())
              .describe(
                "Expected outcomes to verify (e.g., ['User is redirected to /dashboard', 'Welcome message is displayed', 'User session is created'])",
              ),
            category: z
              .enum(["happy_path", "error", "edge_case", "accessibility"])
              .describe(
                "Category of this test case: 'happy_path' for normal flows, 'error' for error handling, 'edge_case' for boundary conditions, 'accessibility' for a11y tests",
              ),
          }),
        )
        .optional()
        .describe(
          "Structured test scenarios that will be generated. Each test case should include specific user actions, expected assertions, and category. This provides a comprehensive implementation plan showing exactly what will be tested.",
        ),
    }),
    execute: async (input: ProposeTestInput): Promise<ProposeTestOutput> => {
      // If no approval callback, auto-approve (for backward compatibility)
      if (!waitForApproval) {
        return processProposeTestApproval(input, true);
      }

      // Generate tool call ID
      const toolCallId = `propose-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Wait for approval
      const approved = await waitForApproval(toolCallId, input);

      // Process approval and return result
      const result = processProposeTestApproval(input, approved);

      // Register approved ID in registry if approved
      if (approved && approvalRegistry && result.success) {
        approvalRegistry.add(result.id);
      }

      return result;
    },
  });

/**
 * Default proposeTestTool without approval (for backward compatibility)
 * Use createProposeTestTool with waitForApproval for HITL
 */
export const proposeTestTool = createProposeTestTool();
